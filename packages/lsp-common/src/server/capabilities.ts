import { TextDocumentSyncKind } from 'vscode-languageserver';
import type { ServerCapabilities } from 'vscode-languageserver';

export const SERVER_CAPABILITIES: ServerCapabilities = {
  textDocumentSync: TextDocumentSyncKind.Incremental,
  completionProvider: {
    resolveProvider: true,
    triggerCharacters: [' ', '|', '.'],
  },
  hoverProvider: true,
  documentOnTypeFormattingProvider: {
    firstTriggerCharacter: '}',
    moreTriggerCharacter: ['%'],
  },
  signatureHelpProvider: {
    triggerCharacters: [':', ','],
  },
  documentFormattingProvider: true,
  definitionProvider: true,
  codeActionProvider: true,
  documentSymbolProvider: true,
};
