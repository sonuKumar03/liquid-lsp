import { DiagnosticSeverity, Range } from 'vscode-languageserver';
import type { Diagnostic } from 'vscode-languageserver';
import type { Liquid, Token, TopLevelToken, TagToken } from 'liquid-core';
import {
  TokenKind,
  TagTokenClass,
  tokenizeTopLevel,
  isKnownLiquidFilter,
  isConditionalTagLine,
  getClosestFilter,
  parseAssignKeyValueWithOffsets,
  parseCaptureVariableWithOffsets,
  parseForLoopVariableWithOffsets,
  parseOutputValue,
} from 'liquid-core';
import { PropertyAccessToken, Tokenizer } from 'liquidjs';
import {
  MATH_FILTERS,
  STRING_FILTERS,
} from '../shared/local-variable-types.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { LiquidType } from '../shared/schema.js';
import type { VariableDeclaration } from 'key-pointer-schema';
import { supportsKeyPointerComputation } from 'key-pointer-schema';
import { findVariableDeclarations } from '../shared/variable-declarations.js';
import { DIAGNOSTIC_CODES } from '../shared/diagnostic-codes.js';

type ActiveVar = {
  declRange: Range;
  line: number;
  hasBeenRead: boolean;
  type: LiquidType;
};

export function collectLifecycleDiagnostics(
  textDocument: TextDocument,
  diagnostics: Diagnostic[],
  liquidEngine: Liquid,
  globalSchema?: Map<string, LiquidType>,
  schemaVariables?: Map<string, VariableDeclaration>,
  precomputedTokens?: TopLevelToken[],
): void {
  const text = textDocument.getText();
  let tokens: TopLevelToken[];

  try {
    tokens =
      precomputedTokens !== undefined
        ? precomputedTokens
        : tokenizeTopLevel(text, liquidEngine);

    const activeVars = new Map<string, ActiveVar>();
    populateSchemaVars(activeVars, globalSchema);

    for (const token of tokens) {
      const line = textDocument.positionAt(token.begin).line;

      if (token instanceof TagTokenClass) {
        collectTagDiagnostics(
          textDocument,
          diagnostics,
          token,
          activeVars,
          line,
          liquidEngine,
          schemaVariables,
        );
      } else if (token.kind === TokenKind.Output) {
        const expr = token.getText().slice(2, -2).trim();
        processExpression(
          expr,
          token,
          textDocument,
          diagnostics,
          activeVars,
          liquidEngine,
        );
      }
    }
  } catch {
    return;
  }

  checkUnusedVariables(textDocument, diagnostics, tokens);
}

function populateSchemaVars(
  activeVars: Map<string, ActiveVar>,
  globalSchema?: Map<string, LiquidType>,
): void {
  if (!globalSchema) return;

  for (const [k, v] of globalSchema.entries()) {
    activeVars.set(k, {
      declRange: Range.create(0, 0, 0, 0),
      line: -1,
      hasBeenRead: true,
      type: v,
    });
  }
}

function collectTagDiagnostics(
  doc: TextDocument,
  diagnostics: Diagnostic[],
  token: TagToken,
  activeVars: Map<string, ActiveVar>,
  line: number,
  engine: Liquid,
  schemaVariables?: Map<string, VariableDeclaration>,
): void {
  const tokenText = token.getText();
  const name = token.name;

  if (name === 'assign' || name === 'assignVar' || name === 'parseAssign') {
    const parsed = parseAssignKeyValueWithOffsets(token.args);
    if (parsed) {
      const varName = parsed.key;
      const expr = parsed.value;
      const prev = activeVars.get(varName);
      const argsOffset = tokenText.indexOf(token.args);
      const absOffset = (argsOffset >= 0 ? argsOffset : 0) + parsed.keyStart;

      validateNonComputableSchemaAssignment(
        doc,
        diagnostics,
        token,
        varName,
        absOffset,
        schemaVariables,
      );

      const inferredType =
        name === 'parseAssign'
          ? processParseAssignExpression(
              expr,
              token,
              doc,
              diagnostics,
              activeVars,
            )
          : processExpression(
              expr,
              token,
              doc,
              diagnostics,
              activeVars,
              engine,
            );
      redefineIfNeeded(diagnostics, activeVars, varName);
      activeVars.set(
        varName,
        createDecl(varName, line, token, absOffset, inferredType, doc),
      );
      validateDropdownValue(
        doc,
        diagnostics,
        prev,
        varName,
        expr,
        token.begin,
        token.end,
      );
    }
  } else if (name === 'capture') {
    const parsed = parseCaptureVariableWithOffsets(token.args);
    if (parsed) {
      const varName = parsed.key;
      const argsOffset = tokenText.indexOf(token.args);
      const absOffset = (argsOffset >= 0 ? argsOffset : 0) + parsed.keyStart;

      redefineIfNeeded(diagnostics, activeVars, varName);
      activeVars.set(
        varName,
        createDecl(varName, line, token, absOffset, 'string', doc),
      );
    }
  } else if (name === 'for') {
    const parsed = parseForLoopVariableWithOffsets(token.args);
    if (parsed) {
      const varName = parsed.key;
      const collectionExpr = parsed.collection;
      const argsOffset = tokenText.indexOf(token.args);
      const absOffset = (argsOffset >= 0 ? argsOffset : 0) + parsed.keyStart;

      if (collectionExpr) {
        processExpression(
          collectionExpr,
          token,
          doc,
          diagnostics,
          activeVars,
          engine,
        );
      }
      activeVars.set(
        varName,
        createDecl(varName, line, token, absOffset, 'unknown', doc),
      );
    }
  } else if (isConditionalTagLine(name)) {
    processExpression(token.args, token, doc, diagnostics, activeVars, engine);
  }
}

function createDecl(
  varName: string,
  line: number,
  token: TagToken,
  offsetInToken: number,
  type: LiquidType,
  doc: TextDocument,
): ActiveVar {
  const absPos = doc.positionAt(token.begin + offsetInToken);
  const start = { line: absPos.line, character: absPos.character };
  const end = { line: absPos.line, character: absPos.character + varName.length };
  return {
    declRange: Range.create(start, end),
    line,
    hasBeenRead: false,
    type,
  };
}

function redefineIfNeeded(
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
  varName: string,
): void {
  const prev = activeVars.get(varName);
  if (prev && !prev.hasBeenRead && prev.line !== -1) {
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: prev.declRange,
      message: `Variable "${varName}" is overwritten here but its value was never read.`,
      source: 'liquid-lsp-linter',
    });
  }
}

function validateDropdownValue(
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
    message: `Value "${strVal}" is not a valid option for dropdown variable "${varName}". Valid options are: ${prev.type.options.map((o) => `"${o}"`).join(', ')}.`,
    source: 'liquid-lsp-linter',
  });
}

function validateNonComputableSchemaAssignment(
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
    message: `Variable "${varName}" has key-pointer type "${declaration.data_type}", which does not support liquid computation assignments.`,
    code: DIAGNOSTIC_CODES.COMPUTATION_ASSIGN_NOT_SUPPORTED,
    data: {
      field_name: varName,
      data_type: declaration.data_type,
    },
    source: 'liquid-lsp-linter',
  });
}

function processParseAssignExpression(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
): LiquidType {
  const filterParts = expr.split('|');
  const pathPart = (filterParts[0] ?? '').trim();
  const parts = pathPart.split('.');
  const baseVarRaw = (parts[0] ?? '').trim();
  const baseVar = baseVarRaw.replace(/\[\s*[a-zA-Z0-9_-]+\s*\]/g, '');

  if (!baseVar) return 'unknown';

  let currentType: LiquidType = 'unknown';
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

    const fieldName = fieldNameRaw.replace(/\[\s*[a-zA-Z0-9_-]+\s*\]/g, '');
    const offsetInToken = token
      .getText()
      .indexOf(fieldNameRaw, searchIndex - token.begin);
    const offset =
      offsetInToken !== -1
        ? offsetInToken
        : token.getText().indexOf(fieldNameRaw);
    if (offsetInToken !== -1) {
      searchIndex = token.begin + offsetInToken + fieldNameRaw.length;
    }

    const start = doc.positionAt(token.begin + (offset !== -1 ? offset : 0));
    const end = doc.positionAt(
      token.begin +
        (offset !== -1 ? offset + fieldNameRaw.length : token.getText().length),
    );

    if (typeof currentType === 'object' && currentType.optional === true) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: { start, end },
        message: `Property "${fieldName}" is accessed on optional parent. Consider checking if the parent exists first or using a default filter.`,
        source: 'liquid-lsp-linter',
        code: 'liquid.linter.optional_access',
      });
    }

    if (typeof currentType === 'object') {
      if (currentType.kind === 'composite') {
        const nextType = currentType.fields.get(fieldName);
        if (nextType) {
          currentType = nextType;
        } else if (currentType.open) {
          currentType = 'unknown';
        } else {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: `Property "${fieldName}" does not exist on composite type.`,
            source: 'liquid-lsp-linter',
          });
          currentType = 'unknown';
          break;
        }
      } else {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: { start, end },
          message: `Cannot access property "${fieldName}" on non-composite type.`,
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
          message: `Property "${fieldName}" does not exist on currency. Available fields are "amount" and "symbol".`,
          source: 'liquid-lsp-linter',
        });
        currentType = 'unknown';
        break;
      }
    } else {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: { start, end },
        message: `Cannot access property "${fieldName}" on primitive type "${currentType}".`,
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
    );
  }

  return currentType;
}

function buildSpacedFilterExpr(expr: string): string {
  return expr
    .replace(/"[^"]*"/g, (m) => '"' + ' '.repeat(m.length - 2) + '"')
    .replace(/'[^']*'/g, (m) => "'" + ' '.repeat(m.length - 2) + "'");
}

function validateFilterNameSyntax(
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

    const filterNameMatch = trimmedAfterPipe.match(
      /^([a-zA-Z_][a-zA-Z0-9_-]*)/,
    );
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

function applyFilterTypeWarnings(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
  currentType: LiquidType,
): LiquidType {
  const parts = expr
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''")
    .split('|');

  for (let i = 1; i < parts.length; i++) {
    const filterPart = (parts[i] ?? '').trim();
    if (!filterPart) continue;

    const filterMatch = filterPart.match(/^([a-zA-Z0-9_-]+)/);
    if (!filterMatch) continue;

    const filterName = filterMatch[1];
    if (!filterName) continue;

    const argsText = filterPart.slice(filterName.length).trim();
    if (argsText) {
      const words = argsText.match(/[a-zA-Z_][a-zA-Z0-9_-]*/g) || [];
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
    }

    if (MATH_FILTERS.has(filterName)) {
      if (currentType === 'string') {
        const tokenText = token.getText();
        const filterOffsetInToken = tokenText.indexOf(filterName);
        const start = doc.positionAt(
          token.begin + (filterOffsetInToken !== -1 ? filterOffsetInToken : 0),
        );
        const end = doc.positionAt(
          token.begin +
            (filterOffsetInToken !== -1
              ? filterOffsetInToken + filterName.length
              : tokenText.length),
        );
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: { start, end },
          message: `Type mismatch: Math filter "${filterName}" is applied to a string value.`,
          source: 'liquid-lsp-linter',
        });
      }
      currentType = 'number';
    } else if (STRING_FILTERS.has(filterName)) {
      if (currentType === 'number') {
        const tokenText = token.getText();
        const filterOffsetInToken = tokenText.indexOf(filterName);
        const start = doc.positionAt(
          token.begin + (filterOffsetInToken !== -1 ? filterOffsetInToken : 0),
        );
        const end = doc.positionAt(
          token.begin +
            (filterOffsetInToken !== -1
              ? filterOffsetInToken + filterName.length
              : tokenText.length),
        );
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: { start, end },
          message: `Type mismatch: String filter "${filterName}" is applied to a number value.`,
          source: 'liquid-lsp-linter',
        });
      }
      currentType = 'string';
    }
  }

  return currentType;
}

function resolveBaseExpressionType(
  basePart: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
  engine: Liquid,
): LiquidType {
  let currentType: LiquidType = 'unknown';
  if (/^""|''$/.test(basePart)) {
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

function extractVariables(token: unknown, variables: string[]): void {
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

function markVariableUsage(
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

function markVariablesReadFromExpression(
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

function processExpression(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
  engine: Liquid,
): LiquidType {
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
  );
}

function checkUnusedVariables(
  textDocument: TextDocument,
  diagnostics: Diagnostic[],
  tokens?: Token[],
): void {
  const docText = textDocument.getText();
  const declarations = findVariableDeclarations(textDocument, tokens);

  if (declarations.length === 0) return;

  let cleanText = docText.replace(
    /\{%\s*comment\s*%\}.*?\{%\s*endcomment\s*%\}/gs,
    '',
  );
  cleanText = cleanText.replace(/"[^"]*"/g, '');
  cleanText = cleanText.replace(/'[^']*'/g, '');

  for (const decl of declarations) {
    const name = decl.name;
    const occurrences = cleanText.match(new RegExp(`\\b${name}\\b`, 'g')) || [];
    const totalCount = occurrences.length;
    const assignMatches =
      cleanText.match(
        new RegExp(
          `\\{%\\s*(assign|assignVar|parseAssign)\\s+${name}\\s*=`,
          'g',
        ),
      ) || [];
    const captureMatches =
      cleanText.match(new RegExp(`\\{%\\s*capture\\s+${name}\\s*%\\}`, 'g')) ||
      [];
    const forMatches =
      cleanText.match(new RegExp(`\\{%\\s*for\\s+${name}\\s+in\\b`, 'g')) || [];
    const declCount =
      assignMatches.length + captureMatches.length + forMatches.length;

    if (totalCount === declCount) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: decl.range,
        message: `Variable "${name}" is declared but its value is never read.`,
        source: 'liquid-lsp-linter',
      });
    }
  }
}
