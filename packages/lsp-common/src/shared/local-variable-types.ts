import { lexical, parseOutputValue, TagTokenClass, type Liquid, type Token } from 'liquid-core';
import { resolveTypeForPath } from '../hovers/hovers.js';
import type { LiquidType } from '../shared/schema.js';
import {
  parseAssignKeyValue,
  parseCaptureVariable,
  parseForLoopVariable,
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
  if (lexical.isLiteral(value)) {
    const literal = lexical.parseLiteral(value);
    if (typeof literal === 'boolean') {
      return 'boolean';
    }
    if (typeof literal === 'number') {
      return 'number';
    }
    return 'string';
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

export function inferTypeFromAssignValue(
  engine: Liquid,
  tagName: string,
  valueExpr: string,
  localTypes: Map<string, LiquidType>,
): LiquidType {
  const parsed = parseOutputValue(engine, valueExpr);
  if (!parsed) {
    const trimmed = valueExpr.trim();
    if (lexical.isLiteral(trimmed)) {
      return inferLiteralType(trimmed);
    }
    if (lexical.isVariable(trimmed)) {
      return resolveTypeForPath(trimmed, localTypes);
    }
    return 'unknown';
  }

  const basePart = parsed.initial.trim();
  let resolvedType: LiquidType;
  if (lexical.isLiteral(basePart)) {
    resolvedType = inferLiteralType(basePart);
  } else {
    resolvedType = resolveTypeForPath(basePart, localTypes);
  }

  for (const filterTemplate of parsed.filters) {
    resolvedType = applyFilterTypeRules(filterTemplate.name, resolvedType);
  }

  if (
    tagName === 'parseAssign' &&
    parsed.filters.length === 0 &&
    !basePart.includes('[')
  ) {
    if (
      typeof resolvedType === 'object' &&
      resolvedType.kind === 'composite'
    ) {
      resolvedType = 'string';
    } else if (resolvedType === 'currency') {
      resolvedType = 'number';
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
      const varName = parseForLoopVariable(args);
      if (varName) {
        localTypes.set(varName, 'unknown');
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
