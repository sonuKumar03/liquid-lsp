import { CodeAction, CodeActionKind, Command } from 'vscode-languageserver/node';
import type { CodeActionParams } from 'vscode-languageserver/node';
import { TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CONDITIONAL_ASSIGNMENT_MESSAGE,
  INLINE_MATH_OPERATOR_MESSAGE,
  SINGLE_EQUALS_ASSIGNMENT_REGEX
} from '../shared/liquid-syntax.js';
import { DIAGNOSTIC_CODES } from '../shared/diagnostic-codes.js';
import { convertToLiquidMath } from '../shared/utils.js';

export function handleCodeAction(
  documents: TextDocuments<TextDocument>,
  params: CodeActionParams
): (Command | CodeAction)[] {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const codeActions: CodeAction[] = [];

  /**
   * Iterate over the diagnostics reported at the current cursor position.
   * 
   * TO ADD A NEW QUICK-FIX:
   * 1. Inspect the diagnostic message/severity or check its unique code.
   * 2. Construct a CodeAction object with `kind: CodeActionKind.QuickFix`.
   * 3. Provide `edit.changes` defining the workspace edit (the text replacement/insert).
   * 4. Push it to `codeActions`.
   */
  for (const diagnostic of params.context.diagnostics) {
    const message = diagnostic.message;
    if (typeof message !== 'string') {
      continue;
    }
    const data = diagnostic.data as
      | { tagName?: string; suggestedFilter?: string }
      | undefined;

    if (diagnostic.code === DIAGNOSTIC_CODES.UNCLOSED_DELIMITER) {
      const tagName = data?.tagName ?? null;
      if (!tagName) continue;
      const endTagName = `end${tagName}`;

      // Insert the closing tag at the end of the document
      const lastLine = doc.lineCount - 1;
      const lastLineText = doc.getText({
        start: { line: lastLine, character: 0 },
        end: { line: lastLine + 1, character: 0 }
      });
      const endPosition = { line: lastLine, character: lastLineText.length };

      const edit = {
        changes: {
          [params.textDocument.uri]: [
            {
              range: { start: endPosition, end: endPosition },
              newText: `\n{% ${endTagName} %}`
            }
          ]
        }
      };

      const action = CodeAction.create(
        `Insert missing {% ${endTagName} %}`,
        edit,
        CodeActionKind.QuickFix
      );
      action.diagnostics = [diagnostic];
      codeActions.push(action);
      continue;
    }

    if (diagnostic.code === DIAGNOSTIC_CODES.UNKNOWN_FILTER) {
      const suggestedFilter = data?.suggestedFilter;
      if (suggestedFilter) {

        const edit = {
          changes: {
            [params.textDocument.uri]: [
              {
                range: diagnostic.range,
                newText: suggestedFilter
              }
            ]
          }
        };

        const action = CodeAction.create(
          `Change to "${suggestedFilter}"`,
          edit,
          CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        codeActions.push(action);
      }
    }

    // 3. Pattern to match: "Liquid does not support inline mathematical operators"
    if (diagnostic.code === DIAGNOSTIC_CODES.INLINE_MATH || message.includes(INLINE_MATH_OPERATOR_MESSAGE)) {
      const startLine = diagnostic.range.start.line;
      const lineText = doc.getText({
        start: { line: startLine, character: 0 },
        end: { line: startLine + 1, character: 0 }
      });

      const convertedText = convertToLiquidMath(lineText);
      if (convertedText) {
        const edit = {
          changes: {
            [params.textDocument.uri]: [
              {
                range: {
                  start: { line: startLine, character: 0 },
                  end: { line: startLine, character: lineText.length }
                },
                newText: convertedText.replace(/\r?\n/g, '')
              }
            ]
          }
        };

        const action = CodeAction.create(
          `Convert inline math to Liquid filter`,
          edit,
          CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        codeActions.push(action);
      }
    }

    // 4. Pattern to match: "Assignments are not allowed inside conditional statements"
    if (diagnostic.code === DIAGNOSTIC_CODES.CONDITIONAL_ASSIGNMENT || message.includes(CONDITIONAL_ASSIGNMENT_MESSAGE)) {
      const startLine = diagnostic.range.start.line;
      const lineText = doc.getText({
        start: { line: startLine, character: 0 },
        end: { line: startLine + 1, character: 0 }
      });

      const matchIndex = lineText.search(SINGLE_EQUALS_ASSIGNMENT_REGEX);
      if (matchIndex !== -1) {
        const edit = {
          changes: {
            [params.textDocument.uri]: [
              {
                range: {
                  start: { line: startLine, character: matchIndex },
                  end: { line: startLine, character: matchIndex + 1 }
                },
                newText: '=='
              }
            ]
          }
        };

        const action = CodeAction.create(
          `Change '=' to '=='`,
          edit,
          CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        codeActions.push(action);
      }
    }
  }

  return codeActions;
}
