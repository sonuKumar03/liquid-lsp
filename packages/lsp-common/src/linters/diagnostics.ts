import { DiagnosticSeverity } from 'vscode-languageserver';
import type { Diagnostic, Connection } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  type Liquid,
  type TopLevelToken,
  TokenKind,
  TagTokenClass,
  tokenizeTopLevel,
  getEnhancedErrorMessage,
} from 'liquid-core';
import { DIAGNOSTIC_CODES } from '../shared/diagnostic-codes.js';
import type { LiquidType } from '../shared/schema.js';
import type { SchemaLoadError, VariableDeclaration } from 'key-pointer-schema';
import { schemaLoadErrorsToDiagnostics } from '../shared/schema-load-errors.js';
import { collectEngineValidationDiagnostics } from '../shared/engine-validations.js';
import { collectLifecycleDiagnostics } from './lifecycle.js';

export async function validateTextDocument(
  connection: Connection,
  textDocument: TextDocument,
  liquidEngine: Liquid,
  globalSchema?: Map<string, LiquidType>,
  schemaVariables?: Map<string, VariableDeclaration>,
  schemaLoadErrors?: SchemaLoadError[],
  precomputedTokens?: TopLevelToken[],
): Promise<void> {
  connection.console.log(
    'LSP server: validating document: ' + textDocument.uri,
  );
  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  checkUnclosedDelimiters(text, diagnostics, textDocument);
  collectSyntaxDiagnostics(
    textDocument,
    diagnostics,
    liquidEngine,
    precomputedTokens,
  );
  collectLifecycleDiagnostics(
    textDocument,
    diagnostics,
    liquidEngine,
    globalSchema,
    schemaVariables,
    precomputedTokens,
  );

  const schemaVarNames = globalSchema
    ? new Set(globalSchema.keys())
    : new Set<string>();
  let validationTokens: TopLevelToken[];
  if (precomputedTokens !== undefined) {
    validationTokens = precomputedTokens;
  } else {
    try {
      validationTokens = tokenizeTopLevel(text, liquidEngine);
    } catch {
      validationTokens = [];
    }
  }
  collectEngineValidationDiagnostics(
    textDocument,
    liquidEngine,
    diagnostics,
    validationTokens,
    schemaVarNames,
  );

  if (schemaLoadErrors && schemaLoadErrors.length > 0) {
    diagnostics.push(...schemaLoadErrorsToDiagnostics(schemaLoadErrors));
  }

  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

function collectSyntaxDiagnostics(
  textDocument: TextDocument,
  diagnostics: Diagnostic[],
  liquidEngine: Liquid,
  precomputedTokens?: TopLevelToken[],
): void {
  let tokens: TopLevelToken[];
  if (precomputedTokens !== undefined) {
    tokens = precomputedTokens;
  } else {
    try {
      tokens = tokenizeTopLevel(textDocument.getText(), liquidEngine);
    } catch {
      tokens = [];
    }
  }
  // 1. Run manual syntax checks (single equals and inline math) on all tokens unconditionally
  for (const token of tokens) {
    if (token.kind !== TokenKind.Tag && token.kind !== TokenKind.Output)
      continue;

    if (token instanceof TagTokenClass) {
      const tagName = token.name;
      if (tagName.startsWith('end')) continue;
      if (tagName === 'else' || tagName === 'elsif' || tagName === 'when')
        continue;
    }

    const tokenText = token.getText();
    const textWithoutQuotes = tokenText.replace(/'[^']*'|"[^"]*"/g, '');
    const isConditionalAssignment =
      token instanceof TagTokenClass &&
      isConditionalTagText(token.name) &&
      textWithoutQuotes.search(/(?<![=!<>])=(?![=<>])/) !== -1;
    const isInlineMath =
      textWithoutQuotes.search(/\+|(?<=\s)-(?=\s)|(?<=\d)-(?=\d)|\*|\//) !== -1;
    const manualError = isConditionalAssignment || isInlineMath;

    if (manualError) {
      const start = textDocument.positionAt(token.begin);
      const end = textDocument.positionAt(token.end);
      const message = isConditionalAssignment
        ? 'Assignments are not allowed inside conditional statements. Did you mean "=="?'
        : 'Liquid does not support inline mathematical operators. Use filters instead, e.g. "| plus: 2".';
      const code = isConditionalAssignment
        ? DIAGNOSTIC_CODES.CONDITIONAL_ASSIGNMENT
        : DIAGNOSTIC_CODES.INLINE_MATH;
      pushUniqueDiagnostic(diagnostics, {
        severity: DiagnosticSeverity.Error,
        range: { start, end },
        message: getEnhancedErrorMessage(
          message,
          getLineText(textDocument, start.line),
        ),
        code,
        source: 'liquid-lsp',
      });
    }
  }

  // 2. Run standard parsing error checks
  try {
    const { errors } = liquidEngine.parser.parseResilient(textDocument.getText());
    for (const error of errors) {
      const token = error.token;
      const start = token
        ? textDocument.positionAt(token.begin)
        : { line: 0, character: 0 };
      const end = token
        ? textDocument.positionAt(token.end)
        : { line: 0, character: 0 };

      // Skip tokens that already have manual errors to avoid double diagnostics
      if (token) {
        const tokenText = token.getText();
        const textWithoutQuotes = tokenText.replace(/'[^']*'|"[^"]*"/g, '');
        const isConditionalAssignment =
          token instanceof TagTokenClass &&
          isConditionalTagText(token.name) &&
          textWithoutQuotes.search(/(?<![=!<>])=(?![=<>])/) !== -1;
        const isInlineMath =
          textWithoutQuotes.search(/\+|(?<=\s)-(?=\s)|(?<=\d)-(?=\d)|\*|\//) !== -1;
        if (isConditionalAssignment || isInlineMath) {
          continue;
        }
      }

      const isDuplicate = diagnostics.some(
        (d) =>
          d.range.start.line === start.line &&
          d.range.start.character === start.character,
      );
      if (isDuplicate) {
        continue;
      }

      const errMessage = error.originalError?.message ?? error.message;

      let code: string | undefined = undefined;
      let data: unknown = undefined;

      const notClosedMatch = errMessage.match(
        /^(tag|output)\s+(.+?)\s+not closed(?:,|$)/,
      );
      if (notClosedMatch) {
        code = DIAGNOSTIC_CODES.UNCLOSED_DELIMITER;
        if (notClosedMatch[1] === 'tag') {
          const rawTag = token ? token.getText() : notClosedMatch[2];
          data = {
            tagName:
              (token instanceof TagTokenClass ? token.name : undefined) ??
              errMessage.match(/tag\s+\{%\s*(\w+)/)?.[1],
            rawTag,
          };
        }
      } else {
        const tagMatch = errMessage.match(
          /tag\s+["']?([a-zA-Z0-9_-]+)["']?\s+not found/,
        );
        if (tagMatch && tagMatch[1]) {
          code = DIAGNOSTIC_CODES.UNKNOWN_TAG;
          data = { tagName: tagMatch[1] };
        }
      }

      const diagnostic: Diagnostic = {
        severity: DiagnosticSeverity.Error,
        range: { start, end },
        message: getEnhancedErrorMessage(
          errMessage,
          getLineText(textDocument, start.line),
        ),
        source: 'liquid-lsp',
      };
      if (code) {
        diagnostic.code = code;
      }
      if (data) {
        diagnostic.data = data;
      }
      diagnostics.push(diagnostic);
    }
  } catch (mainErr: unknown) {
    emitMainCompilerDiagnostic(textDocument, diagnostics, mainErr);
  }
}

function isConditionalTagText(name: string): boolean {
  return (
    name === 'if' || name === 'unless' || name === 'elsif' || name === 'when'
  );
}

function emitMainCompilerDiagnostic(
  textDocument: TextDocument,
  diagnostics: Diagnostic[],
  mainErr: unknown,
): void {
  const err =
    typeof mainErr === 'object' && mainErr !== null
      ? (mainErr as Record<string, unknown>)
      : {};
  const errToken =
    typeof err.token === 'object' && err.token !== null
      ? (err.token as Record<string, unknown>)
      : {};
  let start = { line: 0, character: 0 };
  let end = { line: 0, character: 0 };
  if (typeof errToken.begin === 'number' && typeof errToken.end === 'number') {
    start = textDocument.positionAt(errToken.begin);
    end = textDocument.positionAt(errToken.end);
  }

  const isDuplicate = diagnostics.some(
    (d) =>
      d.range.start.line === start.line &&
      d.range.start.character === start.character,
  );
  if (isDuplicate) return;

  const message = typeof err.message === 'string' ? err.message : '';
  const notClosedMatch = message.match(
    /^(tag|output)\s+(.+?)\s+not closed(?:,|$)/,
  );
  let code: string | undefined = notClosedMatch
    ? DIAGNOSTIC_CODES.UNCLOSED_DELIMITER
    : undefined;

  let data: unknown = undefined;
  if (notClosedMatch && notClosedMatch[1] === 'tag') {
    const rawTag =
      typeof errToken.getText === 'function'
        ? (errToken.getText as () => string)()
        : notClosedMatch[2];
    data = {
      tagName:
        (typeof errToken.name === 'string' ? errToken.name : undefined) ??
        message.match(/tag\s+\{%\s*(\w+)/)?.[1],
      rawTag,
    };
  }

  if (!code) {
    const tagMatch = message.match(
      /tag\s+["']?([a-zA-Z0-9_-]+)["']?\s+not found/,
    );
    if (tagMatch && tagMatch[1]) {
      code = DIAGNOSTIC_CODES.UNKNOWN_TAG;
      data = { tagName: tagMatch[1] };
    }
  }

  const diagnostic: Diagnostic = {
    severity: DiagnosticSeverity.Error,
    range: { start, end },
    message: getEnhancedErrorMessage(
      message,
      getLineText(textDocument, start.line),
    ),
    source: 'liquid-lsp',
  };

  if (code) {
    diagnostic.code = code;
  }
  if (data) {
    diagnostic.data = data;
  }

  diagnostics.push(diagnostic);
}

function getLineText(textDocument: TextDocument, line: number): string {
  return textDocument.getText({
    start: { line, character: 0 },
    end: { line: line + 1, character: 0 },
  });
}

function checkUnclosedDelimiters(
  text: string,
  diagnostics: Diagnostic[],
  doc: TextDocument,
): void {
  const openPattern = /\{[%{]/g;
  let match;
  while ((match = openPattern.exec(text)) !== null) {
    const startIdx = match.index;
    const isTag = text[startIdx + 1] === '%';
    const closeStr = isTag ? '%}' : '}}';

    const nextClose = text.indexOf(closeStr, startIdx + 2);
    const nextOpen = text.slice(startIdx + 2).search(/\{[%{]/);
    const nextOpenIdx = nextOpen !== -1 ? startIdx + 2 + nextOpen : -1;

    if (nextClose === -1 || (nextOpenIdx !== -1 && nextOpenIdx < nextClose)) {
      const start = doc.positionAt(startIdx);
      const lineEnd = text.indexOf('\n', startIdx);
      const endIdx = lineEnd !== -1 ? lineEnd : text.length;
      const end = doc.positionAt(endIdx);
      const rawTag = text.slice(startIdx, endIdx).trim();
      const tagName = rawTag.match(/^\{%\s*(\w+)/)?.[1] ?? '';

      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: { start, end },
        message: `tag ${rawTag} not closed`,
        code: DIAGNOSTIC_CODES.UNCLOSED_DELIMITER,
        data: { tagName, rawTag },
        source: 'liquid-lsp',
      });
    }
  }
}

function pushUniqueDiagnostic(
  diagnostics: Diagnostic[],
  diag: Diagnostic,
): void {
  const isDuplicate = diagnostics.some(
    (d) =>
      d.range.start.line === diag.range.start.line &&
      d.range.start.character === diag.range.start.character &&
      d.message === diag.message,
  );
  if (!isDuplicate) {
    diagnostics.push(diag);
  }
}
