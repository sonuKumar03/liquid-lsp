import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Liquid } from 'liquidjs';
import { validateTextDocument } from './diagnostics.js';
import { handleHover } from './hovers.js';
import { handleCompletion, handleCompletionResolve } from './completions.js';
import { handleOnTypeFormatting, handleDocumentFormatting } from './formatting.js';
import { handleDefinition } from './definitions.js';
import { handleCodeAction } from './codeactions.js';
import { handleDocumentSymbol } from './symbols.js';
import { handleSignatureHelp } from './signatures.js';

// Initialize LSP connection
const connection = createConnection(ProposedFeatures.all);

// Text document manager
const documents = new TextDocuments(TextDocument);

// Initialize Liquid parsing engine
const liquidEngine = new Liquid();

// Debounce map for diagnostic pushes
const pendingValidationTimers = new Map<string, NodeJS.Timeout>();

connection.onInitialize(() => {
  connection.console.log('LSP server: onInitialize handshake started.');
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: [' ', '|']
      },
      hoverProvider: true,
      documentOnTypeFormattingProvider: {
        firstTriggerCharacter: '}',
        moreTriggerCharacter: ['%']
      },
      signatureHelpProvider: {
        triggerCharacters: [':', ',']
      },
      documentFormattingProvider: true,
      definitionProvider: true,
      codeActionProvider: true,
      documentSymbolProvider: true
    }
  };
});

// Real-time parsed diagnostics with a 150ms debounce window
documents.onDidChangeContent(change => {
  const uri = change.document.uri;

  const existingTimer = pendingValidationTimers.get(uri);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const newTimer = setTimeout(() => {
    validateTextDocument(connection, change.document, liquidEngine);
    pendingValidationTimers.delete(uri);
  }, 150);

  pendingValidationTimers.set(uri, newTimer);
});

// Hover tooltip provider
connection.onHover(params => {
  return handleHover(documents, params);
});

// Autocomplete suggestions
connection.onCompletion(params => {
  return handleCompletion(documents, params);
});

// Resolve lazy documentation for completions
connection.onCompletionResolve(item => {
  return handleCompletionResolve(item);
});

// On-type formatting (Auto-closing block tags)
connection.onDocumentOnTypeFormatting(params => {
  return handleOnTypeFormatting(documents, params);
});

// Signature Help
connection.onSignatureHelp(params => {
  return handleSignatureHelp(documents, params);
});

// Document Formatting
connection.onDocumentFormatting(params => {
  return handleDocumentFormatting(documents, params);
});

// Go to Definition
connection.onDefinition(params => {
  return handleDefinition(documents, params);
});

// Code Actions / Quick Fixes
connection.onCodeAction(params => {
  return handleCodeAction(documents, params);
});

// Document Outline / Symbols
connection.onDocumentSymbol(params => {
  return handleDocumentSymbol(documents, params);
});

connection.onInitialized(() => {
  connection.console.log('LSP server: client connection initialized successfully.');
});

// Bind document events
documents.listen(connection);

// Start listening
connection.listen();