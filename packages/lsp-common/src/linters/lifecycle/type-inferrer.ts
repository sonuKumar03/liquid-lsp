import { DiagnosticSeverity, Range } from 'vscode-languageserver';
import type { Diagnostic } from 'vscode-languageserver';
import type { Liquid, Token, TagToken } from 'liquid-core';
import {
  isKnownLiquidFilter,
  getClosestFilter,
  parseOutputValue,
  LIQUID_FILTER_METAS,
} from 'liquid-core';
import { PropertyAccessToken, Tokenizer, LiteralToken, NumberToken, QuotedToken } from 'liquidjs';
import {
  MATH_FILTERS,
  STRING_FILTERS,
  jsonValueToLiquidType,
  unquoteString,
} from '../../shared/local-variable-types.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { resolveTypeForPath } from '../../hovers/hovers.js';
import type { LiquidType } from '../../shared/schema.js';
import type { VariableDeclaration } from 'key-pointer-schema';
import { supportsKeyPointerComputation } from 'key-pointer-schema';
import { DIAGNOSTIC_CODES } from '../../shared/diagnostic-codes.js';
import {
  type ActiveVar,
  type LinterVariableType,
  isOptionalType,
} from '../../shared/linter-types.js';

export function validateDropdownValue(
  doc: TextDocument,
  diagnostics: Diagnostic[],
  prev: ActiveVar | undefined,
  varName: string,
  expr: string,
  tokenBegin: number,
  tokenEnd: number,
): void {
  if (!prev || typeof prev.type !== 'object' || prev.type.kind !== 'dropdown')
    return;

  const cleanExpr = expr.trim();
  if (!/^"[^"]*"|'[^']*'$/.test(cleanExpr)) return;

  const strVal = cleanExpr.slice(1, -1);
  if (prev.type.options.includes(strVal)) return;

  diagnostics.push({
    severity: DiagnosticSeverity.Warning,
    range: Range.create(doc.positionAt(tokenBegin), doc.positionAt(tokenEnd)),
    message: `"${strVal}" is not one of the choices for "${varName}". Valid choices are: ${prev.type.options.map((o) => `"${o}"`).join(', ')}.`,
    code: DIAGNOSTIC_CODES.INVALID_DROPDOWN_VALUE,
    source: 'liquid-lsp-linter',
  });
}

export function validateNonComputableSchemaAssignment(
  doc: TextDocument,
  diagnostics: Diagnostic[],
  token: TagToken,
  varName: string,
  offsetInToken: number,
  schemaVariables?: Map<string, VariableDeclaration>,
): void {
  if (!schemaVariables?.has(varName)) {
    return;
  }

  const declaration = schemaVariables.get(varName);
  if (!declaration || supportsKeyPointerComputation(declaration.data_type)) {
    return;
  }

  const absPos = doc.positionAt(token.begin + offsetInToken);
  const start = {
    line: absPos.line,
    character: absPos.character,
  };
  const end = {
    line: start.line,
    character: start.character + varName.length,
  };

  diagnostics.push({
    severity: DiagnosticSeverity.Warning,
    range: Range.create(start, end),
    message: `"${varName}" is a database field of type "${declaration.data_type}" and cannot be set directly in the template.`,
    code: DIAGNOSTIC_CODES.COMPUTATION_ASSIGN_NOT_SUPPORTED,
    data: {
      field_name: varName,
      data_type: declaration.data_type,
    },
    source: 'liquid-lsp-linter',
  });
}

export function processParseAssignExpression(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
  engine: Liquid,
): LinterVariableType {
  const trimmedExpr = expr.trim();

  // Try raw JSON literal first
  if (
    (trimmedExpr.startsWith('[') && trimmedExpr.endsWith(']')) ||
    (trimmedExpr.startsWith('{') && trimmedExpr.endsWith('}'))
  ) {
    try {
      const parsedJson = JSON.parse(trimmedExpr);
      return jsonValueToLiquidType(parsedJson);
    } catch {
      // ignore
    }
  }

  // Try quoted JSON string literal
  const isQuoted =
    (trimmedExpr.startsWith("'") && trimmedExpr.endsWith("'")) ||
    (trimmedExpr.startsWith('"') && trimmedExpr.endsWith('"'));
  if (isQuoted) {
    try {
      const innerStr = unquoteString(trimmedExpr);
      const parsedJson = JSON.parse(innerStr);
      return jsonValueToLiquidType(parsedJson);
    } catch {
      // ignore
    }
  }

  const filterParts = expr.split('|');
  const pathPart = (filterParts[0] ?? '').trim();
  const parts = pathPart.split('.');
  const baseVarRaw = (parts[0] ?? '').trim();
  const baseVar = baseVarRaw.replace(/\[\s*[a-zA-Z0-9_-]+\s*\]/g, '');

  if (!baseVar) return 'unknown';

  let currentType: LinterVariableType = 'unknown';
  if (activeVars.has(baseVar)) {
    const v = activeVars.get(baseVar)!;
    v.hasBeenRead = true;
    currentType = v.type;
  } else if (/^""|''$/.test(baseVar) || /^"[^"]*"|'[^']*'$/.test(baseVar)) {
    currentType = 'string';
  } else if (/^(true|false)$/.test(baseVar)) {
    currentType = 'boolean';
  } else if (/^\d+(\.\d+)?$/.test(baseVar)) {
    currentType = 'number';
  }

  const equalIndex = token.getText().indexOf('=');
  let searchIndex = token.begin + (equalIndex !== -1 ? equalIndex + 1 : 0);

  for (let i = 1; i < parts.length; i++) {
    const fieldNameRaw = (parts[i] ?? '').trim();
    if (!fieldNameRaw) continue;

    if (currentType === 'unknown') {
      currentType = 'unknown';
      continue;
    }

    const fieldName = fieldNameRaw.replace(/\[\s*[a-zA-Z0-9_-]+\s*\]/g, '');
    const offsetInToken = token.getText().indexOf(fieldNameRaw, searchIndex - token.begin);
    const offset =
      offsetInToken !== -1 ? offsetInToken : token.getText().indexOf(fieldNameRaw);
    if (offsetInToken !== -1) {
      searchIndex = token.begin + offsetInToken + fieldNameRaw.length;
    }

    const start = doc.positionAt(token.begin + (offset !== -1 ? offset : 0));
    const end = doc.positionAt(
      token.begin +
        (offset !== -1 ? offset + fieldNameRaw.length : token.getText().length),
    );

    if (
      typeof currentType === 'object' &&
      currentType.kind !== 'branch_mismatch' &&
      currentType.optional === true
    ) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: { start, end },
        message: `"${fieldName}" might be missing because its parent is optional. Use a fallback value or check if the parent is defined.`,
        source: 'liquid-lsp-linter',
        code: 'liquid.linter.optional_access',
      });
    }

    if (typeof currentType === 'object' && currentType.kind !== 'branch_mismatch') {
      if (currentType.kind === 'composite') {
        const nextType = currentType.fields.get(fieldName);
        if (nextType) {
          const isParentOpt = currentType.optional === true;
          if (isParentOpt) {
            if (typeof nextType === 'string') {
              if (nextType === 'unknown') {
                currentType = 'unknown';
              } else {
                currentType = { kind: 'primitive', type: nextType, optional: true };
              }
            } else if (typeof nextType === 'object') {
              currentType = { ...nextType, optional: true };
            }
          } else {
            currentType = nextType;
          }
        } else if (currentType.open) {
          currentType = 'unknown';
        } else {
          const parentPath = parts.slice(0, i).join('.');
          const available = Array.from(currentType.fields.keys())
            .map((f) => `"${f}"`)
            .join(', ');
          const availStr = available ? ` Available fields are: ${available}.` : '';
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: `"${parentPath}" doesn't have a field called "${fieldName}".${availStr}`,
            source: 'liquid-lsp-linter',
          });
          currentType = 'unknown';
          break;
        }
      } else {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: { start, end },
          message: `You can't access "${fieldName}" because parent is not a container structure (it is a single value).`,
          source: 'liquid-lsp-linter',
        });
        currentType = 'unknown';
        break;
      }
    } else if (currentType === 'currency') {
      if (fieldName === 'amount') {
        currentType = 'number';
      } else if (fieldName === 'symbol') {
        currentType = 'string';
      } else {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: { start, end },
          message: `Currency values only have "amount" and "symbol". "${fieldName}" is not valid.`,
          source: 'liquid-lsp-linter',
        });
        currentType = 'unknown';
        break;
      }
    } else {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: { start, end },
        message: `You can't access "${fieldName}" on "${currentType}" because it is a single value, not a list or record.`,
        source: 'liquid-lsp-linter',
      });
      currentType = 'unknown';
      break;
    }
  }

  if (parts.length === 1 && !baseVarRaw.includes('[')) {
    if (typeof currentType === 'object' && currentType.kind === 'composite') {
      currentType = 'string';
    } else if (currentType === 'currency') {
      currentType = 'number';
    }
  }

  if (filterParts.length > 1) {
    currentType = applyFilterTypeWarnings(
      expr,
      token,
      doc,
      diagnostics,
      activeVars,
      currentType,
      engine,
    );
  }

  return currentType;
}

export function buildSpacedFilterExpr(expr: string): string {
  return expr
    .replace(/"[^"]*"/g, (m) => '"' + ' '.repeat(m.length - 2) + '"')
    .replace(/'[^']*'/g, (m) => "'" + ' '.repeat(m.length - 2) + "'");
}

export function validateFilterNameSyntax(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
): void {
  const spacedExpr = buildSpacedFilterExpr(expr);
  let pipeIdx = spacedExpr.indexOf('|');
  while (pipeIdx !== -1) {
    const afterPipe = expr.substring(pipeIdx + 1);
    const trimmedAfterPipe = afterPipe.trimStart();
    const leadingWhitespaceLen = afterPipe.length - trimmedAfterPipe.length;
    const filterNameStart = pipeIdx + 1 + leadingWhitespaceLen;

    const filterNameMatch = trimmedAfterPipe.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)/);
    if (!filterNameMatch) {
      const tokenText = token.getText();
      const exprOffsetInToken = tokenText.indexOf(expr);
      const errorStartOffset =
        token.begin +
        (exprOffsetInToken !== -1 ? exprOffsetInToken : 0) +
        filterNameStart;
      const quotedMatch = trimmedAfterPipe.match(/^("[^"]*"|'[^']*')/);
      const matchWord = quotedMatch ? quotedMatch : trimmedAfterPipe.match(/^[^\s|]*/);
      const highlightLen = Math.max(1, matchWord ? matchWord[0].length : 1);
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: doc.positionAt(errorStartOffset),
          end: doc.positionAt(errorStartOffset + highlightLen),
        },
        message: 'Expected filter name.',
        code: DIAGNOSTIC_CODES.EXPECTED_FILTER_NAME,
        source: 'liquid-lsp-linter',
      });
    } else {
      const filterName = filterNameMatch[1]!;
      if (!isKnownLiquidFilter(filterName)) {
        const tokenText = token.getText();
        const exprOffsetInToken = tokenText.indexOf(expr);
        const errorStartOffset =
          token.begin +
          (exprOffsetInToken !== -1 ? exprOffsetInToken : 0) +
          filterNameStart;
        const closestFilter = getClosestFilter(filterName);
        const message = closestFilter
          ? `Unknown filter "${filterName}". Did you mean "${closestFilter}"?`
          : `Unknown filter "${filterName}".`;
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: {
            start: doc.positionAt(errorStartOffset),
            end: doc.positionAt(errorStartOffset + filterName.length),
          },
          message,
          code: DIAGNOSTIC_CODES.UNKNOWN_FILTER,
          data: { filterName, suggestedFilter: closestFilter },
          source: 'liquid-lsp-linter',
        });
      }
    }
    pipeIdx = spacedExpr.indexOf('|', pipeIdx + 1);
  }
}

export function inferArgumentType(
  argToken: unknown,
  activeVars: Map<string, ActiveVar>,
): string {
  if (argToken && typeof argToken === 'object') {
    if (argToken instanceof LiteralToken) {
      const txt = argToken.getText();
      if (txt === 'true' || txt === 'false') return 'boolean';
    } else if (argToken instanceof NumberToken) {
      return 'number';
    } else if (argToken instanceof QuotedToken) {
      return 'string';
    } else if (argToken instanceof PropertyAccessToken) {
      const varName = argToken.getText();
      if (varName && activeVars.has(varName)) {
        const t = activeVars.get(varName)!.type;
        return typeof t === 'object' && t.kind === 'primitive'
          ? t.type
          : typeof t === 'string'
            ? t
            : 'unknown';
      }
    }
  }
  return 'unknown';
}

function isArgumentOptional(argToken: unknown, activeVars: Map<string, ActiveVar>): boolean {
  if (argToken && typeof argToken === 'object') {
    if (argToken instanceof PropertyAccessToken) {
      const path = argToken.getText();
      if (path) {
        const activeVarsTypes = new Map<string, LiquidType>();
        for (const [k, v] of activeVars.entries()) {
          const t = v.type;
          if (t && typeof t === 'object' && t.kind === 'branch_mismatch') {
            activeVarsTypes.set(k, t.types[0] || 'unknown');
          } else {
            activeVarsTypes.set(k, t);
          }
        }
        const resolved = resolveTypeForPath(path, activeVarsTypes);
        if (resolved && isOptionalType(resolved)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function applyFilterTypeWarnings(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
  currentType: LinterVariableType,
  engine: Liquid,
): LinterVariableType {
  const parsed = parseOutputValue(engine, expr);
  if (!parsed) return currentType;

  const tokenText = token.getText();
  const exprOffsetInToken = tokenText.indexOf(expr);
  const basePart = expr.split('|')[0]?.trim() ?? '';

  const isStringLiteral = /^"[^"]*"|'[^']*'$/.test(basePart);
  const unquotedBase = isStringLiteral ? basePart.slice(1, -1) : basePart;
  const isBaseNumeric = /^\s*-?\d+(\.\d+)?\s*$/.test(unquotedBase);

  let tempType = currentType;
  let isOptional = isOptionalType(currentType);

  for (const filter of parsed.filters) {
    const filterName = filter.name;
    const filterOffsetInToken = tokenText.indexOf(filterName, exprOffsetInToken);

    const start = doc.positionAt(
      token.begin + (filterOffsetInToken !== -1 ? filterOffsetInToken : 0),
    );
    const end = doc.positionAt(
      token.begin +
        (filterOffsetInToken !== -1
          ? filterOffsetInToken + filterName.length
          : tokenText.length),
    );

    if (tempType && typeof tempType === 'object' && tempType.kind === 'branch_mismatch') {
      const bm = tempType;
      for (let j = 0; j < bm.types.length; j++) {
        const t = bm.types[j]!;
        const l = bm.lines[j]!;
        const r = bm.ranges[j]!;
        const tStr =
          typeof t === 'object' && t.kind === 'primitive'
            ? t.type
            : typeof t === 'string'
              ? t
              : 'unknown';

        if (
          MATH_FILTERS.has(filterName) &&
          tStr !== 'number' &&
          tStr !== 'currency' &&
          tStr !== 'unknown'
        ) {
          const branchDesc = j === 0 ? 'if-branch' : 'else-branch';
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: `"${basePart}" is a string in the ${branchDesc} (line ${l + 1}) — math filter "${filterName}" will break at runtime.`,
            code: DIAGNOSTIC_CODES.BRANCH_TYPE_MISMATCH,
            data: {
              varName: basePart,
              mismatchLine: l,
              mismatchRange: r,
              expected: 'number',
              actual: tStr,
              ranges: bm.ranges,
            },
            source: 'liquid-lsp-linter',
          });
        } else if (STRING_FILTERS.has(filterName) && tStr !== 'string' && tStr !== 'unknown') {
          const branchDesc = j === 0 ? 'if-branch' : 'else-branch';
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: `"${basePart}" is a number in the ${branchDesc} (line ${l + 1}) — string filter "${filterName}" will break at runtime.`,
            code: DIAGNOSTIC_CODES.BRANCH_TYPE_MISMATCH,
            data: {
              varName: basePart,
              mismatchLine: l,
              mismatchRange: r,
              expected: 'string',
              actual: tStr,
              ranges: bm.ranges,
            },
            source: 'liquid-lsp-linter',
          });
        }
      }
      if (MATH_FILTERS.has(filterName)) {
        tempType = 'number';
      } else if (STRING_FILTERS.has(filterName)) {
        tempType = 'string';
      }
    } else {
      if (MATH_FILTERS.has(filterName)) {
        const isString =
          tempType === 'string' ||
          (typeof tempType === 'object' &&
            tempType.kind === 'primitive' &&
            tempType.type === 'string');
        const isOpt = isOptionalType(tempType);
        const isUnk = tempType === 'unknown';

        if (isString && isStringLiteral && !isBaseNumeric) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: { start, end },
            message: `String literal "${unquotedBase}" contains non-numeric characters and cannot be used in math operations.`,
            code: DIAGNOSTIC_CODES.NON_NUMERIC_COERCION,
            source: 'liquid-lsp-linter',
          });
        } else if (isString) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: { start, end },
            message: `"${filterName}" only works on numbers. The value is text, not a number.`,
            code: DIAGNOSTIC_CODES.NON_NUMERIC_COERCION,
            source: 'liquid-lsp-linter',
          });
        } else if (isOpt || isUnk) {
          const offset = exprOffsetInToken !== -1 ? exprOffsetInToken : 0;
          const insertPos = doc.positionAt(token.begin + offset + basePart.length);
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: { start, end },
            message: `"${basePart}" might be blank. Add a fallback value using "| default: 0".`,
            code: DIAGNOSTIC_CODES.COERCION_WARNING,
            data: {
              insertRange: { start: insertPos, end: insertPos },
              newText: ' | default: 0',
            },
            source: 'liquid-lsp-linter',
          });
        }

        tempType = 'number';
      } else if (STRING_FILTERS.has(filterName)) {
        const isNumber =
          tempType === 'number' ||
          tempType === 'currency' ||
          (typeof tempType === 'object' &&
            tempType.kind === 'primitive' &&
            (tempType.type === 'number' || tempType.type === 'currency'));
        if (isNumber) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: { start, end },
            message: `"${filterName}" only works on text. The value is a number, not text.`,
            code: DIAGNOSTIC_CODES.INVALID_FILTER_TYPE,
            source: 'liquid-lsp-linter',
          });
        }
        tempType = 'string';
      }
    }

    const filterMeta = LIQUID_FILTER_METAS.find((m) => m.name === filterName);
    if (filterMeta && filterMeta.argTypes) {
      let argIndex = 0;
      for (const arg of filter.args) {
        const isNamed = Array.isArray(arg);
        if (!isNamed) {
          const valToken = arg;
          const expectedType = filterMeta.argTypes[argIndex];
          if (expectedType && expectedType !== 'any') {
            const actualType = inferArgumentType(valToken, activeVars);
            if (actualType !== 'unknown' && actualType !== expectedType) {
              const argOffset = tokenText.indexOf(valToken.getText(), filterOffsetInToken);
              const argStart = doc.positionAt(token.begin + (argOffset !== -1 ? argOffset : 0));
              const argEnd = doc.positionAt(
                token.begin +
                  (argOffset !== -1 ? argOffset + valToken.getText().length : tokenText.length),
              );

              diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: Range.create(argStart, argEnd),
                message: `"${filterName}" expects a ${expectedType} argument, got a ${actualType} literal "${valToken.getText()}".`,
                code: DIAGNOSTIC_CODES.FILTER_ARGUMENT_TYPE_MISMATCH,
                source: 'liquid-lsp-linter',
              });
            }
          }
          argIndex++;
        }
      }
    }

    if (filterName === 'divided_by') {
      for (const arg of filter.args) {
        const valToken = Array.isArray(arg) ? arg[1] : arg;
        if (valToken) {
          const rawVal = valToken.getText().trim();
          if (rawVal === '0' || Number(rawVal) === 0) {
            const argOffset = tokenText.indexOf(valToken.getText(), filterOffsetInToken);
            const argStart = doc.positionAt(token.begin + (argOffset !== -1 ? argOffset : 0));
            const argEnd = doc.positionAt(
              token.begin +
                (argOffset !== -1 ? argOffset + valToken.getText().length : tokenText.length),
            );

            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: Range.create(argStart, argEnd),
              message: 'Division by zero is not allowed.',
              code: DIAGNOSTIC_CODES.DIVISION_BY_ZERO,
              source: 'liquid-lsp-linter',
            });
          }
        }
      }
    }

    if (filterName === 'date') {
      for (const arg of filter.args) {
        const valToken = Array.isArray(arg) ? arg[1] : arg;
        if (valToken && valToken instanceof QuotedToken) {
          const rawVal = valToken.getText() ?? '';
          const val = rawVal.slice(1, -1);
          if (val && !val.includes('%')) {
            const argOffset = tokenText.indexOf(rawVal, filterOffsetInToken);
            const argStart = doc.positionAt(token.begin + (argOffset !== -1 ? argOffset : 0));
            const argEnd = doc.positionAt(
              token.begin + (argOffset !== -1 ? argOffset + rawVal.length : tokenText.length),
            );

            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              range: Range.create(argStart, argEnd),
              message: `Date format string "${val}" doesn't contain any standard formatting placeholders (like %Y, %m, %d).`,
              code: DIAGNOSTIC_CODES.FILTER_ARGUMENT_TYPE_MISMATCH,
              source: 'liquid-lsp-linter',
            });
          }
        }
      }
    }

    let anyArgOptional = false;
    for (const arg of filter.args) {
      const valToken = Array.isArray(arg) ? arg[1] : arg;
      if (valToken && isArgumentOptional(valToken, activeVars)) {
        anyArgOptional = true;
        break;
      }
    }

    if (filterName === 'default') {
      isOptional = false;
      if (typeof tempType === 'object' && tempType.kind !== 'branch_mismatch') {
        tempType = { ...tempType, optional: false };
      }
    } else {
      isOptional = isOptional || anyArgOptional;
      if (isOptional) {
        if (typeof tempType === 'string') {
          if (tempType === 'unknown') {
            // Keep it unknown
          } else {
            tempType = { kind: 'primitive', type: tempType, optional: true };
          }
        } else if (typeof tempType === 'object' && tempType.kind !== 'branch_mismatch') {
          tempType = { ...tempType, optional: true };
        }
      }
    }
  }

  return tempType;
}

export function resolveBaseExpressionType(
  basePart: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
  engine: Liquid,
): LinterVariableType {
  let currentType: LinterVariableType = 'unknown';
  if (/^"[^"]*"|'[^']*'$/.test(basePart)) {
    currentType = 'string';
  } else if (/^(true|false)$/.test(basePart)) {
    currentType = 'boolean';
  } else if (/^\d+(\.\d+)?$/.test(basePart)) {
    currentType = 'number';
  } else if (/^[a-zA-Z0-9_-]+$/.test(basePart)) {
    const varName = basePart;
    if (activeVars.has(varName)) {
      const v = activeVars.get(varName)!;
      v.hasBeenRead = true;
      currentType = v.type;
    }
  } else if (basePart.includes('.')) {
    let isSimpleProp = false;
    try {
      const tokenizer = new Tokenizer(basePart, engine.options);
      const val = tokenizer.readValue();
      if (val instanceof PropertyAccessToken) {
        tokenizer.skipBlank();
        if (tokenizer.p === tokenizer.N) {
          isSimpleProp = true;
        }
      }
    } catch {
      // Ignore
    }

    if (isSimpleProp) {
      currentType = processParseAssignExpression(
        basePart,
        token,
        doc,
        diagnostics,
        activeVars,
        engine,
      );
    } else {
      const words = basePart.match(/[a-zA-Z_][a-zA-Z0-9_-]*/g) || [];
      const keywords = new Set([
        'true',
        'false',
        'nil',
        'null',
        'and',
        'or',
        'contains',
        'in',
      ]);
      for (const word of words) {
        if (!keywords.has(word) && activeVars.has(word)) {
          activeVars.get(word)!.hasBeenRead = true;
        }
      }
      if (/[=!<>+]/.test(basePart)) {
        currentType = 'boolean';
      }
    }
  } else {
    const words = basePart.match(/[a-zA-Z_][a-zA-Z0-9_-]*/g) || [];
    const keywords = new Set([
      'true',
      'false',
      'nil',
      'null',
      'and',
      'or',
      'contains',
      'in',
    ]);
    for (const word of words) {
      if (!keywords.has(word) && activeVars.has(word)) {
        activeVars.get(word)!.hasBeenRead = true;
      }
    }
    if (/[=!<>+]/.test(basePart)) {
      currentType = 'boolean';
    }
  }

  return currentType;
}

export function extractVariables(token: unknown, variables: string[]): void {
  if (token instanceof PropertyAccessToken) {
    if (token.props && token.props.length > 0) {
      const base = token.props[0];
      if (base) {
        variables.push(base.getText());
      }
      for (let i = 1; i < token.props.length; i++) {
        extractVariables(token.props[i], variables);
      }
    }
  }
}

export function markVariableUsage(
  value: string,
  activeVars: Map<string, ActiveVar>,
): void {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }

  const baseVar = trimmed
    .split('.')[0]
    ?.replace(/\[\s*.+\s*\]/g, '')
    .trim();
  if (baseVar && activeVars.has(baseVar)) {
    activeVars.get(baseVar)!.hasBeenRead = true;
  }
}

export function markVariablesReadFromExpression(
  expr: string,
  activeVars: Map<string, ActiveVar>,
  engine: Liquid,
): void {
  const parsed = parseOutputValue(engine, expr);
  if (!parsed) {
    return;
  }

  const vars: string[] = [];

  if (parsed.initial && parsed.initial.postfix) {
    for (const token of parsed.initial.postfix) {
      extractVariables(token, vars);
    }
  }

  for (const filter of parsed.filters) {
    for (const arg of filter.args) {
      const valueToken = Array.isArray(arg) ? arg[1] : arg;
      if (valueToken) {
        if (valueToken instanceof PropertyAccessToken) {
          extractVariables(valueToken, vars);
        }
      }
    }
  }

  for (const v of vars) {
    markVariableUsage(v, activeVars);
  }
}

export function processExpression(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
  engine: Liquid,
): LinterVariableType {
  validateFilterNameSyntax(expr, token, doc, diagnostics);
  markVariablesReadFromExpression(expr, activeVars, engine);

  const cleanExpr = expr.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  const parts = cleanExpr.split('|');
  const basePart = (parts[0] ?? '').trim();

  const currentType = resolveBaseExpressionType(
    basePart,
    token,
    doc,
    diagnostics,
    activeVars,
    engine,
  );

  return applyFilterTypeWarnings(
    expr,
    token,
    doc,
    diagnostics,
    activeVars,
    currentType,
    engine,
  );
}
