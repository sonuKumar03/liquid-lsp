import {
  parseOutputValue,
  TagTokenClass,
  type Liquid,
  type Token,
} from 'liquid-core';
import {
  Tokenizer,
  LiteralToken,
  NumberToken,
  QuotedToken,
  PropertyAccessToken,
  evalQuotedToken,
} from 'liquidjs';
import { resolveTypeForPath } from '../hovers/hovers.js';
import type { LiquidType } from '../shared/schema.js';
import {
  parseAssignKeyValue,
  parseCaptureVariable,
  parseForLoopVariableWithOffsets,
} from 'liquid-core';
import { collectVariableNamesFromTokens } from '../shared/token-variables.js';

import { ASSIGN_TAG_NAMES } from './constants.js';

export const STRING_FILTERS = new Set([
  'upcase',
  'downcase',
  'append',
  'prepend',
  'replace',
  'slice',
  'strip',
  'strip_html',
  'truncate',
]);

export const MATH_FILTERS = new Set([
  'abs',
  'ceil',
  'floor',
  'round',
  'plus',
  'minus',
  'times',
  'divided_by',
  'modulo',
  'sumArray',
]);

export function inferLiteralType(value: string): LiquidType {
  try {
    const tokenizer = new Tokenizer(value);
    const token = tokenizer.readValue();
    if (token && tokenizer.p === tokenizer.N) {
      if (token instanceof LiteralToken) {
        const txt = token.getText();
        if (txt === 'true' || txt === 'false') {
          return 'boolean';
        }
      }
      if (token instanceof NumberToken) {
        return 'number';
      }
      if (token instanceof QuotedToken) {
        return 'string';
      }
    }
  } catch {
    // ignore
  }
  return 'unknown';
}

export function applyFilterTypeRules(
  filterName: string,
  currentType: LiquidType,
): LiquidType {
  if (filterName === 'split') {
    return { kind: 'array', elementType: 'string' };
  }
  if (filterName === 'first' || filterName === 'last') {
    if (typeof currentType === 'object' && currentType.kind === 'array') {
      return currentType.elementType;
    }
    return 'unknown';
  }
  if (filterName === 'toCurrency') {
    return 'currency';
  }
  if (STRING_FILTERS.has(filterName)) {
    return 'string';
  }
  if (MATH_FILTERS.has(filterName)) {
    return 'number';
  }
  if (filterName === 'toCurrency') {
    return 'currency';
  }
  if (filterName === 'concat' || filterName === 'uniq') {
    return { kind: 'array', elementType: 'unknown' };
  }
  return currentType;
}

function getExpressionText(
  expr: { postfix?: Token[] } | null | undefined,
): string {
  if (!expr || !expr.postfix || expr.postfix.length === 0) {
    return '';
  }
  let min = Infinity;
  let max = -Infinity;
  let input = '';
  for (const token of expr.postfix) {
    if (token.begin < min) {
      min = token.begin;
    }
    if (token.end > max) {
      max = token.end;
    }
    if (token.input) {
      input = token.input;
    }
  }
  if (min !== Infinity && max !== -Infinity && input) {
    return input.slice(min, max);
  }
  return '';
}

export function unquoteString(str: string): string {
  const quote = str[0];
  if (quote !== "'" && quote !== '"') return str;
  let result = '';
  for (let i = 1; i < str.length - 1; i++) {
    const char = str[i];
    if (char === '\\') {
      const nextChar = str[i + 1];
      if (nextChar === 'u') {
        const hex = str.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          result += String.fromCharCode(parseInt(hex, 16));
          i += 5;
        } else {
          result += char;
        }
      } else if (
        nextChar === quote ||
        nextChar === '\\' ||
        nextChar === '/' ||
        nextChar === 'b' ||
        nextChar === 'f' ||
        nextChar === 'n' ||
        nextChar === 'r' ||
        nextChar === 't'
      ) {
        if (nextChar === quote) result += quote;
        else if (nextChar === '\\') result += '\\';
        else if (nextChar === '/') result += '/';
        else if (nextChar === 'b') result += '\b';
        else if (nextChar === 'f') result += '\f';
        else if (nextChar === 'n') result += '\n';
        else if (nextChar === 'r') result += '\r';
        else if (nextChar === 't') result += '\t';
        i++;
      } else {
        result += char;
      }
    } else {
      result += char;
    }
  }
  return result;
}

export function jsonValueToLiquidType(val: unknown): LiquidType {
  if (val === null || val === undefined) {
    return 'unknown';
  }
  if (typeof val === 'boolean') {
    return 'boolean';
  }
  if (typeof val === 'number') {
    return 'number';
  }
  if (typeof val === 'string') {
    return 'string';
  }
  if (Array.isArray(val)) {
    if (val.length === 0) {
      return { kind: 'array', elementType: 'unknown' };
    }
    const typesSeen = new Set<string>();
    const fields = new Map<string, LiquidType>();
    let hasObject = false;
    for (const item of val) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        hasObject = true;
        for (const [k, v] of Object.entries(item)) {
          const itemType = jsonValueToLiquidType(v);
          if (itemType !== 'unknown') {
            fields.set(k, itemType);
          } else if (!fields.has(k)) {
            fields.set(k, 'unknown');
          }
        }
      } else if (item !== null && item !== undefined) {
        typesSeen.add(typeof item);
      }
    }
    if (hasObject) {
      return {
        kind: 'array',
        elementType: {
          kind: 'composite',
          fields,
        },
      };
    }
    if (typesSeen.size === 1) {
      const singleType = Array.from(typesSeen)[0]!;
      if (
        singleType === 'string' ||
        singleType === 'number' ||
        singleType === 'boolean'
      ) {
        return {
          kind: 'array',
          elementType: singleType,
        };
      }
    }
    return { kind: 'array', elementType: 'unknown' };
  }
  if (typeof val === 'object') {
    const fields = new Map<string, LiquidType>();
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      fields.set(k, jsonValueToLiquidType(v));
    }
    return {
      kind: 'composite',
      fields,
    };
  }
  return 'unknown';
}

export function inferTypeFromAssignValue(
  engine: Liquid,
  tagName: string,
  valueExpr: string,
  localTypes: Map<string, LiquidType>,
): LiquidType {
  if (tagName === 'parseAssign') {
    const trimmed = valueExpr.trim();
    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      try {
        const parsedJson = JSON.parse(trimmed);
        return jsonValueToLiquidType(parsedJson);
      } catch {
        // ignore, fall back
      }
    }
  }

  const parsed = parseOutputValue(engine, valueExpr);
  if (!parsed) {
    const trimmed = valueExpr.trim();
    const type = inferLiteralType(trimmed);
    if (type !== 'unknown') {
      return type;
    }
    try {
      const tokenizer = new Tokenizer(trimmed);
      const token = tokenizer.readValue();
      if (
        token &&
        tokenizer.p === tokenizer.N &&
        token instanceof PropertyAccessToken
      ) {
        return resolveTypeForPath(token.getText(), localTypes);
      }
    } catch {
      // ignore
    }
    return 'unknown';
  }

  let resolvedType: LiquidType = 'unknown';
  const initial = parsed.initial;
  if (initial.postfix && initial.postfix.length === 1) {
    const token = initial.postfix[0];
    if (token instanceof LiteralToken) {
      const txt = token.getText();
      if (txt === 'true' || txt === 'false') {
        resolvedType = 'boolean';
      }
    } else if (token instanceof NumberToken) {
      resolvedType = 'number';
    } else if (token instanceof QuotedToken) {
      if (tagName === 'parseAssign') {
        try {
          const rawVal = evalQuotedToken(token);
          if (typeof rawVal === 'string') {
            const parsedJson = JSON.parse(rawVal);
            resolvedType = jsonValueToLiquidType(parsedJson);
          } else {
            resolvedType = 'string';
          }
        } catch {
          resolvedType = 'string';
        }
      } else {
        resolvedType = 'string';
      }
    } else if (token instanceof PropertyAccessToken) {
      resolvedType = resolveTypeForPath(token.getText(), localTypes);
    }
  }

  for (const filterTemplate of parsed.filters) {
    resolvedType = applyFilterTypeRules(filterTemplate.name, resolvedType);
  }

  if (tagName === 'parseAssign' && parsed.filters.length === 0) {
    const basePart = getExpressionText(parsed.initial).trim();
    if (!basePart.includes('[')) {
      if (
        typeof resolvedType === 'object' &&
        resolvedType.kind === 'composite'
      ) {
        const isJsonLiteralString =
          (basePart.startsWith("'") && basePart.endsWith("'")) ||
          (basePart.startsWith('"') && basePart.endsWith('"'));
        if (!isJsonLiteralString) {
          resolvedType = 'string';
        }
      } else if (resolvedType === 'currency') {
        resolvedType = 'number';
      }
    }
  }

  return resolvedType;
}

/**
 * Extract variable types from tokenized tags (schema + local assignments).
 */
export function extractLocalVariableTypes(
  globalSchema?: Map<string, LiquidType>,
  tokens?: Token[],
  engine?: Liquid,
): Map<string, LiquidType> {
  const localTypes = new Map<string, LiquidType>();

  if (globalSchema) {
    for (const [k, v] of globalSchema.entries()) {
      localTypes.set(k, v);
    }
  }

  if (!tokens || !engine) {
    if (tokens) {
      for (const name of collectVariableNamesFromTokens(tokens)) {
        if (!localTypes.has(name)) {
          localTypes.set(name, 'unknown');
        }
      }
    }
    return localTypes;
  }

  for (const token of tokens) {
    if (!(token instanceof TagTokenClass)) {
      continue;
    }

    const tagName = token.name;
    const args = token.args;

    if (ASSIGN_TAG_NAMES.has(tagName)) {
      const parsed = parseAssignKeyValue(args);
      if (parsed) {
        localTypes.set(
          parsed.key,
          inferTypeFromAssignValue(engine, tagName, parsed.value, localTypes),
        );
      }
      continue;
    }

    if (tagName === 'capture') {
      const varName = parseCaptureVariable(args);
      if (varName) {
        localTypes.set(varName, 'string');
      }
      continue;
    }

    if (tagName === 'for') {
      const parsed = parseForLoopVariableWithOffsets(args);
      if (parsed) {
        let inferredType: LiquidType = 'unknown';
        const collectionExpr = parsed.collection;
        if (collectionExpr) {
          const resolved = resolveTypeForPath(collectionExpr, localTypes);
          if (resolved && typeof resolved === 'object') {
            if (resolved.kind === 'array') {
              inferredType = resolved.elementType;
            } else if (resolved.kind === 'composite') {
              inferredType = resolved;
            }
          }
        }
        localTypes.set(parsed.key, inferredType);
      }
    }
  }

  for (const name of collectVariableNamesFromTokens(tokens)) {
    if (!localTypes.has(name)) {
      localTypes.set(name, 'unknown');
    }
  }

  return localTypes;
}
