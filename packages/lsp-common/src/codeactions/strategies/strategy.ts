import { CodeAction, CodeActionKind, Range } from 'vscode-languageserver';
import type { CodeActionParams, Diagnostic } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { DocumentManager } from '../../server/document-manager.js';
import type { Liquid } from 'liquid-core';

export interface CodeActionStrategy {
  execute(
    doc: TextDocument,
    diagnostic: Diagnostic,
    params: CodeActionParams,
    documentManager?: DocumentManager,
    liquidEngine?: Liquid,
  ): CodeAction[];
  matches?(diagnostic: Diagnostic): boolean;
}

export function createQuickFix(
  title: string,
  uri: string,
  range: Range,
  newText: string,
  diagnostic: Diagnostic,
): CodeAction {
  const edit = {
    changes: {
      [uri]: [
        {
          range,
          newText,
        },
      ],
    },
  };
  const action = CodeAction.create(title, edit, CodeActionKind.QuickFix);
  action.diagnostics = [diagnostic];
  return action;
}
