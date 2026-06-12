import { DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import type { Diagnostic, Connection } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Liquid, Tokenizer, TagToken, TokenKind, Token } from 'liquidjs';
import { getEnhancedErrorMessage, cleanErrorMessage, getClosestFilter } from './utils.js';
import { LIQUID_FILTERS } from './constants.js';
import { findVariableDeclarations } from './definitions.js';

export async function validateTextDocument(
  connection: Connection,
  textDocument: TextDocument,
  liquidEngine: Liquid
): Promise<void> {
  connection.console.log('LSP server: validating document: ' + textDocument.uri);
  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  // 1. Check for Syntax Errors (Option A: Multiple Syntax Errors via Token-by-Token Parsing)
  try {
    liquidEngine.parse(text);
  } catch (mainErr: any) {
    try {
      const tokenizer = new Tokenizer(text, liquidEngine.options as any);
      const tokens = tokenizer.readTopLevelTokens();

      let hasTokenErrors = false;

      for (const token of tokens) {
        if (token.kind === TokenKind.Tag || token.kind === TokenKind.Output) {
          const tokenIndex = tokens.indexOf(token);
          const remainTokens = tokens.slice(tokenIndex + 1);
          const remainTokensCopy = [...remainTokens];

          const blockTags = ['if', 'for', 'unless', 'capture', 'tablerow', 'case', 'comment'];
          if (token instanceof TagToken) {
            const tagName = token.name;
            if (blockTags.includes(tagName)) {
              const dummyTokenizer = new Tokenizer(`{% end${tagName} %}`, liquidEngine.options as any);
              const dummyEndToken = dummyTokenizer.readTopLevelTokens()[0];
              remainTokensCopy.push(dummyEndToken!);
            }
          }

          try {
            (liquidEngine as any).parser.parseToken(token, remainTokensCopy);
          } catch (tokenErr: any) {
            hasTokenErrors = true;
            const start = textDocument.positionAt(token.begin);
            const end = textDocument.positionAt(token.end);

            const lineNum = start.line;
            const lineText = textDocument.getText({
              start: { line: lineNum, character: 0 },
              end: { line: lineNum + 1, character: 0 }
            });

            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: { start, end },
              message: getEnhancedErrorMessage(tokenErr.message, lineText),
              source: 'liquid-lsp'
            });
          }
        }
      }

      // If token-by-token parsing didn't find specific inline errors, or if there is a block structure error
      // (like unclosed tags which require full stream parsing), push the main compiler error.
      if (!hasTokenErrors || mainErr.message.includes('not closed')) {
        let start = { line: 0, character: 0 };
        let end = { line: 0, character: 0 };
        if (mainErr.token && typeof mainErr.token.begin === 'number' && typeof mainErr.token.end === 'number') {
          start = textDocument.positionAt(mainErr.token.begin);
          end = textDocument.positionAt(mainErr.token.end);
        }

        // Avoid pushing duplicate errors if we already reported an error at the exact same location
        const isDuplicate = diagnostics.some(d => d.range.start.line === start.line && d.range.start.character === start.character);
        if (!isDuplicate) {
          const lineText = textDocument.getText({
            start: { line: start.line, character: 0 },
            end: { line: start.line + 1, character: 0 }
          });
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: getEnhancedErrorMessage(mainErr.message, lineText),
            source: 'liquid-lsp'
          });
        }
      }
    } catch (e) {
      // Fallback if tokenization fails
      let start = { line: 0, character: 0 };
      let end = { line: 0, character: 0 };
      if (mainErr.token && typeof mainErr.token.begin === 'number' && typeof mainErr.token.end === 'number') {
        start = textDocument.positionAt(mainErr.token.begin);
        end = textDocument.positionAt(mainErr.token.end);
      }
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: { start, end },
        message: cleanErrorMessage(mainErr.message),
        source: 'liquid-lsp'
      });
    }
  }

  // 2. Check for Semantic Warnings (Option B: Unknown Filters Linter)
  const filterPattern = /\|\s*([a-zA-Z0-9_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = filterPattern.exec(text))) {
    const filterName = match[1];
    if (!filterName) continue;
    // Check if it is a known filter
    const isKnown = LIQUID_FILTERS.some(f => f.label === filterName);
    if (!isKnown) {
      const matchIndex = match.index;
      const filterOffset = match[0].indexOf(filterName);
      const start = textDocument.positionAt(matchIndex + filterOffset);
      const end = textDocument.positionAt(matchIndex + filterOffset + filterName.length);

      const closestFilter = getClosestFilter(filterName);
      const message = closestFilter 
        ? `Unknown filter "${filterName}". Did you mean "${closestFilter}"?`
        : `Unknown filter "${filterName}".`;

      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: { start, end },
        message,
        source: 'liquid-lsp-linter'
      });
    }
  }

  // 3. Check for lifecycles, redundant redefinitions, and type mismatches
  checkVariableLifecycles(textDocument, diagnostics);

  // 4. Check for Unused Variables
  checkUnusedVariables(textDocument, diagnostics);

  // Asynchronously send/push the diagnostics back to the editor
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

type LiquidType = 'string' | 'number' | 'boolean' | 'unknown';

function processExpression(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, { declRange: Range; line: number; hasBeenRead: boolean; type: LiquidType }>
): LiquidType {
  let cleanExpr = expr.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");

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
    const words = basePart.match(/[a-zA-Z_][a-zA-Z0-9_-]*/g) || [];
    const keywords = new Set(['true', 'false', 'nil', 'null', 'and', 'or', 'contains', 'in']);
    for (const word of words) {
      if (!keywords.has(word) && activeVars.has(word)) {
        const v = activeVars.get(word)!;
        v.hasBeenRead = true;
      }
    }
    if (/[=!<>+]/.test(basePart)) {
      currentType = 'boolean';
    }
  }

  const MATH_FILTERS = new Set(['plus', 'minus', 'times', 'divided_by', 'modulo', 'round', 'ceil', 'floor', 'abs', 'size']);
  const STRING_FILTERS = new Set(['upcase', 'downcase', 'capitalize', 'escape', 'replace', 'prepend', 'append', 'join', 'slice', 'truncate', 'split', 'strip']);

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
      const keywords = new Set(['true', 'false', 'nil', 'null', 'and', 'or', 'contains', 'in']);
      for (const word of words) {
        if (!keywords.has(word) && activeVars.has(word)) {
          const v = activeVars.get(word)!;
          v.hasBeenRead = true;
        }
      }
    }

    if (MATH_FILTERS.has(filterName)) {
      if (currentType === 'string') {
        const tokenText = token.getText();
        const filterOffsetInToken = tokenText.indexOf(filterName);
        const start = doc.positionAt(token.begin + (filterOffsetInToken !== -1 ? filterOffsetInToken : 0));
        const end = doc.positionAt(token.begin + (filterOffsetInToken !== -1 ? filterOffsetInToken + filterName.length : tokenText.length));

        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: { start, end },
          message: `Type mismatch: Math filter "${filterName}" is applied to a string value.`,
          source: 'liquid-lsp-linter'
        });
      }
      currentType = 'number';
    } else if (STRING_FILTERS.has(filterName)) {
      currentType = 'string';
    }
  }

  return currentType;
}

function checkVariableLifecycles(doc: TextDocument, diagnostics: Diagnostic[]): void {
  const text = doc.getText();
  const tokenizer = new Tokenizer(text);
  let tokens: Token[] = [];
  try {
    tokens = tokenizer.readTopLevelTokens();
  } catch (e) {
    return;
  }

  const activeVars = new Map<string, { declRange: Range; line: number; hasBeenRead: boolean; type: LiquidType }>();

  for (const token of tokens) {
    const line = doc.positionAt(token.begin).line;

    if (token instanceof TagToken) {
      const name = token.name;
      const tokenText = token.getText();

      if (name === 'assign') {
        const match = tokenText.match(/assign\s+([a-zA-Z0-9_-]+)\s*=\s*(.+)/);
        if (match) {
          const varName = match[1] ?? '';
          const expr = match[2] ?? '';

          // 1. Process reads first
          const inferredType = processExpression(expr, token, doc, diagnostics, activeVars);

          // 2. Check redundant redefinition
          const prev = activeVars.get(varName);
          if (prev && !prev.hasBeenRead) {
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              range: prev.declRange,
              message: `Variable "${varName}" is overwritten here but its value was never read.`,
              source: 'liquid-lsp-linter'
            });
          }

          // 3. Define the variable
          const offset = tokenText.indexOf(varName);
          const start = doc.positionAt(token.begin + offset);
          const end = doc.positionAt(token.begin + offset + varName.length);
          const declRange = Range.create(start, end);

          activeVars.set(varName, {
            declRange,
            line,
            hasBeenRead: false,
            type: inferredType
          });
        }
      } else if (name === 'capture') {
        const match = tokenText.match(/capture\s+([a-zA-Z0-9_-]+)/);
        if (match) {
          const varName = match[1] ?? '';

          const prev = activeVars.get(varName);
          if (prev && !prev.hasBeenRead) {
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              range: prev.declRange,
              message: `Variable "${varName}" is overwritten here but its value was never read.`,
              source: 'liquid-lsp-linter'
            });
          }

          const offset = tokenText.indexOf(varName);
          const start = doc.positionAt(token.begin + offset);
          const end = doc.positionAt(token.begin + offset + varName.length);
          const declRange = Range.create(start, end);

          activeVars.set(varName, {
            declRange,
            line,
            hasBeenRead: false,
            type: 'string'
          });
        }
      } else if (name === 'for') {
        const match = tokenText.match(/for\s+([a-zA-Z0-9_-]+)\s+in\s+(.+)/);
        if (match) {
          const varName = match[1] ?? '';
          const expr = match[2] ?? '';

          processExpression(expr, token, doc, diagnostics, activeVars);

          const offset = tokenText.indexOf(varName);
          const start = doc.positionAt(token.begin + offset);
          const end = doc.positionAt(token.begin + offset + varName.length);
          const declRange = Range.create(start, end);

          activeVars.set(varName, {
            declRange,
            line,
            hasBeenRead: false,
            type: 'unknown'
          });
        }
      } else if (['if', 'unless', 'elsif', 'when'].includes(name)) {
        processExpression(token.args, token, doc, diagnostics, activeVars);
      }
    } else if (token.kind === TokenKind.Output) {
      const tokenText = token.getText();
      const expr = tokenText.slice(2, -2).trim();
      processExpression(expr, token, doc, diagnostics, activeVars);
    }
  }
}

function checkUnusedVariables(textDocument: TextDocument, diagnostics: Diagnostic[]): void {
  const docText = textDocument.getText();
  const declarations = findVariableDeclarations(textDocument);
  
  if (declarations.length === 0) return;

  // Strip comments and strings to get cleanText for usages checking
  let cleanText = docText.replace(/\{%\s*comment\s*%\}.*?\{%\s*endcomment\s*%\}/gs, '');
  cleanText = cleanText.replace(/"[^"]*"/g, '');
  cleanText = cleanText.replace(/'[^']*'/g, '');

  for (const decl of declarations) {
    const name = decl.name;
    
    // Count total occurrences of name
    const occurrences = cleanText.match(new RegExp(`\\b${name}\\b`, 'g')) || [];
    const totalCount = occurrences.length;

    // Count declaration contexts of name
    const assignMatches = cleanText.match(new RegExp(`\\{%\\s*assign\\s+${name}\\s*=`, 'g')) || [];
    const captureMatches = cleanText.match(new RegExp(`\\{%\\s*capture\\s+${name}\\s*%\\}`, 'g')) || [];
    const forMatches = cleanText.match(new RegExp(`\\{%\\s*for\\s+${name}\\s+in\\b`, 'g')) || [];
    const declCount = assignMatches.length + captureMatches.length + forMatches.length;

    if (totalCount === declCount) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: decl.range,
        message: `Variable "${name}" is declared but its value is never read.`,
        source: 'liquid-lsp-linter'
      });
    }
  }
}
