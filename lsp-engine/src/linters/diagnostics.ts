import { DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import type { Diagnostic, Connection } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Tokenizer, TokenKind, TagToken, Liquid } from 'liquidjs';
import type { Token } from 'liquidjs';
import { getEnhancedErrorMessage, cleanErrorMessage, getClosestFilter } from '../shared/utils.js';
import { LIQUID_FILTERS } from '../shared/constants.js';
import { findVariableDeclarations } from '../definitions/definitions.js';
import type { LiquidType } from '../shared/schema.js';

export async function validateTextDocument(
  connection: Connection,
  textDocument: TextDocument,
  liquidEngine: Liquid,
  globalSchema?: Map<string, LiquidType>
): Promise<void> {
  connection.console.log('LSP server: validating document: ' + textDocument.uri);
  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  checkUnclosedDelimiters(text, diagnostics, textDocument);

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
          if (token instanceof TagToken) {
            const tagName = token.name;
            if (tagName.startsWith('end') || ['else', 'elsif', 'when'].includes(tagName)) {
              continue;
            }
          }

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

          // Run manual syntax checks in token-by-token parse
          const tokenText = token.getText();
          const textWithoutQuotes = tokenText.replace(/'[^']*'|"[^"]*"/g, '');
          let isManualError = false;

          if (token instanceof TagToken) {
            if (['if', 'unless', 'elsif', 'when'].includes(token.name)) {
              if (/(?<![=!<>])=(?![=<>])/.test(textWithoutQuotes)) {
                isManualError = true;
              }
            }
            if (/\+|(?<=\s)-(?=\s)|(?<=\d)-(?=\d)|\*|\//.test(textWithoutQuotes)) {
              isManualError = true;
            }
          } else if (token.kind === TokenKind.Output) {
            if (/\+|(?<=\s)-(?=\s)|(?<=\d)-(?=\d)|\*|\//.test(textWithoutQuotes)) {
              isManualError = true;
            }
          }

          if (isManualError) {
            hasTokenErrors = true;
            const start = textDocument.positionAt(token.begin);
            const end = textDocument.positionAt(token.end);

            const lineNum = start.line;
            const lineText = textDocument.getText({
              start: { line: lineNum, character: 0 },
              end: { line: lineNum + 1, character: 0 }
            });

            const message = getEnhancedErrorMessage('expected "|" before filter', lineText);

            pushUniqueDiagnostic(diagnostics, {
              severity: DiagnosticSeverity.Error,
              range: { start, end },
              message,
              source: 'liquid-lsp'
            });
            continue;
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
      if (!hasTokenErrors) {
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
    } catch {
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



  // 3. Check for lifecycles, redundant redefinitions, and type mismatches
  checkVariableLifecycles(textDocument, diagnostics, globalSchema);

  // 4. Check for Unused Variables
  checkUnusedVariables(textDocument, diagnostics);

  // Asynchronously send/push the diagnostics back to the editor
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

function processParseAssignExpression(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, { declRange: Range; line: number; hasBeenRead: boolean; type: LiquidType }>
): LiquidType {
  // Bug A: Split expression by '|' to separate filter chains from property path
  const filterParts = expr.split('|');
  const pathPart = (filterParts[0] ?? '').trim();

  const parts = pathPart.split('.');
  
  // Edge Case E: Strip array bracket index from baseVar, e.g. baseVar[0] -> baseVar
  const baseVarRaw = (parts[0] ?? '').trim();
  const baseVar = baseVarRaw.replace(/\[\s*[a-zA-Z0-9_-]+\s*\]/g, '');
  
  if (!baseVar) return 'unknown';

  let currentType: LiquidType = 'unknown';
  if (activeVars.has(baseVar)) {
    const v = activeVars.get(baseVar)!;
    v.hasBeenRead = true;
    currentType = v.type;
  } else {
    // If baseVar is a literal string/number/boolean, treat it as primitive
    if (/^""|''$/.test(baseVar) || /^"[^"]*"|'[^']*'$/.test(baseVar)) {
      currentType = 'string';
    } else if (/^(true|false)$/.test(baseVar)) {
      currentType = 'boolean';
    } else if (/^\d+(\.\d+)?$/.test(baseVar)) {
      currentType = 'number';
    }
  }

  // Bug B: Keep track of sequential search index to avoid collision with varName at start of tag
  const equalIndex = token.getText().indexOf('=');
  let searchIndex = token.begin + (equalIndex !== -1 ? equalIndex + 1 : 0);

  // Resolve dot-notation path recursively
  for (let i = 1; i < parts.length; i++) {
    const fieldNameRaw = (parts[i] ?? '').trim();
    if (!fieldNameRaw) continue;

    // Edge Case E: Strip array bracket index, e.g. items[0] -> items
    const fieldName = fieldNameRaw.replace(/\[\s*[a-zA-Z0-9_-]+\s*\]/g, '');

    // Get the character offset of the fieldName in tokenText sequentially
    const offsetInToken = token.getText().indexOf(fieldNameRaw, searchIndex - token.begin);
    const offset = offsetInToken !== -1 ? offsetInToken : token.getText().indexOf(fieldNameRaw);
    if (offsetInToken !== -1) {
      searchIndex = token.begin + offsetInToken + fieldNameRaw.length;
    }

    const start = doc.positionAt(token.begin + (offset !== -1 ? offset : 0));
    const end = doc.positionAt(token.begin + (offset !== -1 ? offset + fieldNameRaw.length : token.getText().length));

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
            source: 'liquid-lsp-linter'
          });
          currentType = 'unknown';
          break;
        }
      } else {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: { start, end },
          message: `Cannot access property "${fieldName}" on non-composite type.`,
          source: 'liquid-lsp-linter'
        });
        currentType = 'unknown';
        break;
      }
    } else {
      if (currentType === 'currency') {
        if (fieldName === 'amount') {
          currentType = 'number';
        } else if (fieldName === 'symbol') {
          currentType = 'string';
        } else {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: `Property "${fieldName}" does not exist on currency. Available fields are "amount" and "symbol".`,
            source: 'liquid-lsp-linter'
          });
          currentType = 'unknown';
          break;
        }
      } else {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: { start, end },
          message: `Cannot access property "${fieldName}" on primitive type "${currentType}".`,
          source: 'liquid-lsp-linter'
        });
        currentType = 'unknown';
        break;
      }
    }
  }

  // Coercion rules: if assigning the whole object/currency directly via parseAssign:
  if (parts.length === 1 && !baseVarRaw.includes('[')) {
    if (typeof currentType === 'object') {
      if (currentType.kind === 'composite') {
        currentType = 'string'; // object.toString()
      }
    } else if (currentType === 'currency') {
      currentType = 'number'; // currency.toValueOf()
    }
  }

  // Bug A: Process filter chain if present
  if (filterParts.length > 1) {
    const MATH_FILTERS = new Set(['plus', 'minus', 'times', 'divided_by', 'modulo', 'round', 'ceil', 'floor', 'abs', 'size']);
    const STRING_FILTERS = new Set(['upcase', 'downcase', 'capitalize', 'escape', 'replace', 'prepend', 'append', 'join', 'slice', 'truncate', 'split', 'strip']);

    for (let i = 1; i < filterParts.length; i++) {
      const filterPart = (filterParts[i] ?? '').trim();
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
  }

  return currentType;
}


/**
 * Process a Liquid expression to infer its type and validate filter usage.
 * 
 * TO ADD A NEW FILTER TYPE-CHECK OR VALUE RULES:
 * 1. Identify where filters are evaluated (lines below containing `LIQUID_FILTERS.has(...)` or custom checks).
 * 2. Add validation checks to push diagnostics for invalid filter usage.
 */
function processExpression(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, { declRange: Range; line: number; hasBeenRead: boolean; type: LiquidType }>
): LiquidType {
  // 1. Strict filter syntax and validity checking
  const spacedExpr = expr.replace(/"[^"]*"/g, (m) => '"' + ' '.repeat(m.length - 2) + '"')
                         .replace(/'[^']*'/g, (m) => "'" + ' '.repeat(m.length - 2) + "'");

  let pipeIdx = spacedExpr.indexOf('|');
  while (pipeIdx !== -1) {
    const afterPipe = expr.substring(pipeIdx + 1);
    const trimmedAfterPipe = afterPipe.trimStart();
    const leadingWhitespaceLen = afterPipe.length - trimmedAfterPipe.length;
    const filterNameStart = pipeIdx + 1 + leadingWhitespaceLen;

    const filterNameMatch = trimmedAfterPipe.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)/);
    if (!filterNameMatch) {
      // Syntax error: expected filter name!
      const tokenText = token.getText();
      const exprOffsetInToken = tokenText.indexOf(expr);
      const errorStartOffset = token.begin + (exprOffsetInToken !== -1 ? exprOffsetInToken : 0) + filterNameStart;

      const matchWord = trimmedAfterPipe.match(/^[^\s|]*/);
      const highlightLen = Math.max(1, matchWord ? matchWord[0].length : 1);

      const start = doc.positionAt(errorStartOffset);
      const end = doc.positionAt(errorStartOffset + highlightLen);

      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: { start, end },
        message: 'Expected filter name.',
        source: 'liquid-lsp-linter'
      });
    } else {
      const filterName = filterNameMatch[1]!;
      const isKnown = LIQUID_FILTERS.some(f => f.label === filterName);
      if (!isKnown) {
        // Unknown filter warning
        const tokenText = token.getText();
        const exprOffsetInToken = tokenText.indexOf(expr);
        const errorStartOffset = token.begin + (exprOffsetInToken !== -1 ? exprOffsetInToken : 0) + filterNameStart;

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
          source: 'liquid-lsp-linter'
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

  // Math-related filters (expect numeric inputs, output numbers)
  const MATH_FILTERS = new Set(['plus', 'minus', 'times', 'divided_by', 'modulo', 'round', 'ceil', 'floor', 'abs', 'size']);
  
  // String-related filters (expect string inputs, output strings)
  // TO ADD A NEW FILTER TYPE RULE:
  // 1. Add it to either MATH_FILTERS or STRING_FILTERS here.
  // 2. The type checker below will automatically enforce it.
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

function checkVariableLifecycles(
  doc: TextDocument,
  diagnostics: Diagnostic[],
  globalSchema?: Map<string, LiquidType>
): void {
  const text = doc.getText();
  const tokenizer = new Tokenizer(text);
  let tokens: Token[];
  try {
    tokens = tokenizer.readTopLevelTokens();
  } catch {
    return;
  }

  const activeVars = new Map<string, { declRange: Range; line: number; hasBeenRead: boolean; type: LiquidType }>();

  // Populate activeVars with pre-defined global schema types
  if (globalSchema) {
    for (const [k, v] of globalSchema.entries()) {
      activeVars.set(k, {
        declRange: Range.create(0, 0, 0, 0),
        line: -1,
        hasBeenRead: true, // global variables don't need unused warning
        type: v
      });
    }
  }

  for (const token of tokens) {
    const line = doc.positionAt(token.begin).line;

    // --- MANUAL SYNTAX CHECKS ---
    const tokenText = token.getText();
    const textWithoutQuotes = tokenText.replace(/'[^']*'|"[^"]*"/g, '');

    if (token instanceof TagToken) {
      const name = token.name;

      // 1. Check single equals assignment inside conditionals (if, unless, elsif, when)
      if (['if', 'unless', 'elsif', 'when'].includes(name)) {
        const singleEqualRegex = /(?<![=!<>])=(?![=<>])/;
        if (singleEqualRegex.test(textWithoutQuotes)) {
          const start = doc.positionAt(token.begin);
          const end = doc.positionAt(token.end);
          pushUniqueDiagnostic(diagnostics, {
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: 'Assignments are not allowed inside conditional statements. Did you mean "=="?',
            source: 'liquid-lsp'
          });
        }
      }

      // 2. Check inline mathematical operators in tag args
      const mathOperatorRegex = /\+|(?<=\s)-(?=\s)|(?<=\d)-(?=\d)|\*|\//;
      if (mathOperatorRegex.test(textWithoutQuotes)) {
        const start = doc.positionAt(token.begin);
        const end = doc.positionAt(token.end);
        pushUniqueDiagnostic(diagnostics, {
          severity: DiagnosticSeverity.Error,
          range: { start, end },
          message: 'Liquid does not support inline mathematical operators. Use filters instead, e.g. "| plus: 2".',
          source: 'liquid-lsp'
        });
      }
    } else if (token.kind === TokenKind.Output) {
      // 3. Check inline mathematical operators in output values
      const mathOperatorRegex = /\+|(?<=\s)-(?=\s)|(?<=\d)-(?=\d)|\*|\//;
      if (mathOperatorRegex.test(textWithoutQuotes)) {
        const start = doc.positionAt(token.begin);
        const end = doc.positionAt(token.end);
        pushUniqueDiagnostic(diagnostics, {
          severity: DiagnosticSeverity.Error,
          range: { start, end },
          message: 'Liquid does not support inline mathematical operators. Use filters instead, e.g. "| plus: 2".',
          source: 'liquid-lsp'
        });
      }
    }

    if (token instanceof TagToken) {
      const name = token.name;

      if (name === 'assign' || name === 'assignVar') {
        const match = token.args.match(/^\s*([a-zA-Z0-9_-]+)\s*=\s*(.+)/);
        if (match) {
          const varName = match[1] ?? '';
          const expr = match[2] ?? '';

          // 1. Process reads first
          const inferredType = processExpression(expr, token, doc, diagnostics, activeVars);

          // 2. Check redundant redefinition
          const prev = activeVars.get(varName);
          if (prev && !prev.hasBeenRead && prev.line !== -1) {
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

          // Dropdown options validation
          if (prev && typeof prev.type === 'object' && prev.type.kind === 'dropdown') {
            const cleanExpr = expr.trim();
            if (/^"[^"]*"|'[^']*'$/.test(cleanExpr)) {
              const strVal = cleanExpr.slice(1, -1);
              if (!prev.type.options.includes(strVal)) {
                diagnostics.push({
                  severity: DiagnosticSeverity.Warning,
                  range: Range.create(doc.positionAt(token.begin), doc.positionAt(token.end)),
                  message: `Value "${strVal}" is not a valid option for dropdown variable "${varName}". Valid options are: ${prev.type.options.map(o => `"${o}"`).join(', ')}.`,
                  source: 'liquid-lsp-linter'
                });
              }
            }
          }
        }
      } else if (name === 'parseAssign') {
        const match = token.args.match(/^\s*([a-zA-Z0-9_-]+)\s*=\s*(.+)/);
        if (match) {
          const varName = match[1] ?? '';
          const expr = (match[2] ?? '').trim();

          // 1. Process reads first
          const inferredType = processParseAssignExpression(expr, token, doc, diagnostics, activeVars);

          // 2. Check redundant redefinition
          const prev = activeVars.get(varName);
          if (prev && !prev.hasBeenRead && prev.line !== -1) {
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

          // Dropdown options validation
          if (prev && typeof prev.type === 'object' && prev.type.kind === 'dropdown') {
            const cleanExpr = expr.trim();
            if (/^"[^"]*"|'[^']*'$/.test(cleanExpr)) {
              const strVal = cleanExpr.slice(1, -1);
              if (!prev.type.options.includes(strVal)) {
                diagnostics.push({
                  severity: DiagnosticSeverity.Warning,
                  range: Range.create(doc.positionAt(token.begin), doc.positionAt(token.end)),
                  message: `Value "${strVal}" is not a valid option for dropdown variable "${varName}". Valid options are: ${prev.type.options.map(o => `"${o}"`).join(', ')}.`,
                  source: 'liquid-lsp-linter'
                });
              }
            }
          }
        }
      } else if (name === 'capture') {
        const match = token.args.match(/^\s*([a-zA-Z0-9_-]+)/);
        if (match) {
          const varName = match[1] ?? '';

          const prev = activeVars.get(varName);
          if (prev && !prev.hasBeenRead && prev.line !== -1) {
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
        const match = token.args.match(/^\s*([a-zA-Z0-9_-]+)\s+in\s+(.+)/);
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
    const assignMatches = cleanText.match(new RegExp(`\\{%\\s*(assign|assignVar|parseAssign)\\s+${name}\\s*=`, 'g')) || [];
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

function checkUnclosedDelimiters(text: string, diagnostics: Diagnostic[], doc: TextDocument): void {
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

      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: { start, end },
        message: `tag ${rawTag} not closed`,
        source: 'liquid-lsp'
      });
    }
  }
}

function pushUniqueDiagnostic(diagnostics: Diagnostic[], diag: Diagnostic): void {
  const isDuplicate = diagnostics.some(d => 
    d.range.start.line === diag.range.start.line && 
    d.range.start.character === diag.range.start.character &&
    d.message === diag.message
  );
  if (!isDuplicate) {
    diagnostics.push(diag);
  }
}
