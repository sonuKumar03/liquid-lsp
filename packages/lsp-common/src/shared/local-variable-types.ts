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
} from 'liquidjs';
import { resolveTypeForPath } from '../hovers/hovers.js';
import type { LiquidType } from '../shared/schema.js';
import {
  parseAssignKeyValue,
  parseCaptureVariable,
  parseForLoopVariableWithOffsets,
} from 'liquid-core';
import { collectVariableNamesFromTokens } from '../shared/token-variables.js';

const ASSIGN_TAG_NAMES = new Set(['assign', 'assignVar', 'parseAssign']);

export const STRING_FILTERS = new Set([
  'upcase',
  'downcase',
  'append',
  'prepend',
  'replace',
  'slice',
  'strip',
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
  'size',
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
  if (filterName === 'toCurrency') {
    return 'currency';
  }
  if (STRING_FILTERS.has(filterName)) {
    return 'string';
  }
  if (MATH_FILTERS.has(filterName)) {
    return 'number';
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

export function inferTypeFromAssignValue(
  engine: Liquid,
  tagName: string,
  valueExpr: string,
  localTypes: Map<string, LiquidType>,
): LiquidType {
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
      resolvedType = 'string';
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
        resolvedType = 'string';
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
          if (
            resolved &&
            typeof resolved === 'object' &&
            resolved.kind === 'composite'
          ) {
            inferredType = resolved;
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
