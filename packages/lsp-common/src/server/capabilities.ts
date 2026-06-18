import { TextDocumentSyncKind } from 'vscode-languageserver';
import type { ServerCapabilities } from 'vscode-languageserver';
import { SEMANTIC_TOKEN_TYPES, SEMANTIC_TOKEN_MODIFIERS } from '../semanticTokens/semanticTokens.js';

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
  renameProvider: true,
  referencesProvider: true,
  semanticTokensProvider: {
    legend: {
      tokenTypes: SEMANTIC_TOKEN_TYPES,
      tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
    },
    full: true,
  },
};
