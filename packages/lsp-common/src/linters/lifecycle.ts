import { DiagnosticSeverity, Range } from 'vscode-languageserver';
import type { Diagnostic } from 'vscode-languageserver';
import type { Liquid, Token, TagToken } from 'liquid-core';
import {
  Tokenizer,
  TokenKind,
  TagTokenClass,
  tokenizeTopLevel,
  isKnownLiquidFilter,
  isConditionalTagLine,
  getClosestFilter,
} from 'liquid-core';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { LiquidType } from '../shared/schema.js';
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
  precomputedTokens?: Token[],
): void {
  const text = textDocument.getText();
  let tokens: Token[] = [];

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
        );
      } else if (token.kind === TokenKind.Output) {
        const expr = token.getText().slice(2, -2).trim();
        processExpression(expr, token, textDocument, diagnostics, activeVars);
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
): void {
  const tokenText = token.getText();
  const name = token.name;

  if (name === 'assign' || name === 'assignVar') {
    const match = token.args.match(/^\s*([a-zA-Z0-9_-]+)\s*=\s*(.+)/);
    if (match) {
      const varName = match[1] ?? '';
      const expr = match[2] ?? '';
      const prev = activeVars.get(varName);

      const inferredType = processExpression(
        expr,
        token,
        doc,
        diagnostics,
        activeVars,
      );
      redefineIfNeeded(diagnostics, activeVars, varName);
      activeVars.set(
        varName,
        createDecl(varName, line, tokenText, inferredType),
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
  } else if (name === 'parseAssign') {
    const match = token.args.match(/^\s*([a-zA-Z0-9_-]+)\s*=\s*(.+)/);
    if (match) {
      const varName = match[1] ?? '';
      const expr = (match[2] ?? '').trim();
      const prev = activeVars.get(varName);

      const inferredType = processParseAssignExpression(
        expr,
        token,
        doc,
        diagnostics,
        activeVars,
      );
      redefineIfNeeded(diagnostics, activeVars, varName);
      activeVars.set(
        varName,
        createDecl(varName, line, tokenText, inferredType),
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
    const match = token.args.match(/^\s*([a-zA-Z0-9_-]+)/);
    if (match) {
      const varName = match[1] ?? '';
      redefineIfNeeded(diagnostics, activeVars, varName);
      activeVars.set(varName, createDecl(varName, line, tokenText, 'string'));
    }
  } else if (name === 'for') {
    const match = token.args.match(/^\s*([a-zA-Z0-9_-]+)\s+in\s+(.+)/);
    if (match) {
      const varName = match[1] ?? '';
      const expr = match[2] ?? '';
      processExpression(expr, token, doc, diagnostics, activeVars);
      activeVars.set(varName, createDecl(varName, line, tokenText, 'unknown'));
    }
  } else if (isConditionalTagLine(name)) {
    processExpression(token.args, token, doc, diagnostics, activeVars);
  }
}

function createDecl(
  varName: string,
  line: number,
  tokenText: string,
  type: LiquidType,
): ActiveVar {
  const offset = tokenText.indexOf(varName);
  const start = { line, character: Math.max(0, offset) };
  const end = { line, character: Math.max(0, offset) + varName.length };
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
    const MATH_FILTERS = new Set([
      'plus',
      'minus',
      'times',
      'divided_by',
      'modulo',
      'round',
      'ceil',
      'floor',
      'abs',
      'size',
    ]);
    const STRING_FILTERS = new Set([
      'upcase',
      'downcase',
      'capitalize',
      'escape',
      'replace',
      'prepend',
      'append',
      'join',
      'slice',
      'truncate',
      'split',
      'strip',
    ]);

    for (let i = 1; i < filterParts.length; i++) {
      const filterPart = (filterParts[i] ?? '').trim();
      if (!filterPart) continue;

      const filterMatch = filterPart.match(/^([a-zA-Z0-9_-]+)/);
      if (!filterMatch) continue;

      const filterName = filterMatch[1];
      if (!filterName) continue;

      if (MATH_FILTERS.has(filterName)) {
        if (currentType === 'string') {
          const tokenText = token.getText();
          const filterOffsetInToken = tokenText.indexOf(filterName);
          const start = doc.positionAt(
            token.begin +
              (filterOffsetInToken !== -1 ? filterOffsetInToken : 0),
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
        currentType = 'string';
      }
    }
  }

  return currentType;
}

function processExpression(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
): LiquidType {
  const spacedExpr = expr
    .replace(/"[^"]*"/g, (m) => '"' + ' '.repeat(m.length - 2) + '"')
    .replace(/'[^']*'/g, (m) => "'" + ' '.repeat(m.length - 2) + "'");

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
      const matchWord = trimmedAfterPipe.match(/^[^\s|]*/);
      const highlightLen = Math.max(1, matchWord ? matchWord[0].length : 1);
      const start = doc.positionAt(errorStartOffset);
      const end = doc.positionAt(errorStartOffset + highlightLen);
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: { start, end },
        message: 'Expected filter name.',
        source: 'liquid-lsp-linter',
      });
    } else {
      const filterName = filterNameMatch[1]!;
      const isKnown = isKnownLiquidFilter(filterName);
      if (!isKnown) {
        const tokenText = token.getText();
        const exprOffsetInToken = tokenText.indexOf(expr);
        const errorStartOffset =
          token.begin +
          (exprOffsetInToken !== -1 ? exprOffsetInToken : 0) +
          filterNameStart;
        const start = doc.positionAt(errorStartOffset);
        const end = doc.positionAt(errorStartOffset + filterName.length);
        const closestFilter = getClosestFilter(filterName);
        const message = closestFilter
          ? `Unknown filter "${filterName}". Did you mean "${closestFilter}"?`
          : `Unknown filter "${filterName}".`;
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: { start, end },
          message,
          code: DIAGNOSTIC_CODES.UNKNOWN_FILTER,
          data: { filterName, suggestedFilter: closestFilter },
          source: 'liquid-lsp-linter',
        });
      }
    }
    pipeIdx = spacedExpr.indexOf('|', pipeIdx + 1);
  }

  const cleanExpr = expr.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  const parts = cleanExpr.split('|');
  const basePart = (parts[0] ?? '').trim();

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
  } else {
    if (basePart.includes('.')) {
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
      if (/[=!<>+]/.test(basePart)) currentType = 'boolean';
    }
  }

  return applyFilterTypes(
    expr,
    token,
    doc,
    diagnostics,
    activeVars,
    currentType,
  );
}

function applyFilterTypes(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
  currentType: LiquidType,
): LiquidType {
  const MATH_FILTERS = new Set([
    'plus',
    'minus',
    'times',
    'divided_by',
    'modulo',
    'round',
    'ceil',
    'floor',
    'abs',
    'size',
  ]);
  const STRING_FILTERS = new Set([
    'upcase',
    'downcase',
    'capitalize',
    'escape',
    'replace',
    'prepend',
    'append',
    'join',
    'slice',
    'truncate',
    'split',
    'strip',
  ]);
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
      return 'number';
    }

    if (STRING_FILTERS.has(filterName)) {
      return 'string';
    }
  }

  return currentType;
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
