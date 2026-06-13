import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import liquidjs from 'liquidjs';
const { Liquid } = liquidjs;
import { validateTextDocument } from './linters/diagnostics.js';
import { handleHover } from './hovers/hovers.js';
import { handleCompletion, handleCompletionResolve } from './completions/completions.js';
import { handleOnTypeFormatting, handleDocumentFormatting } from './formatters/formatting.js';
import { handleDefinition } from './definitions/definitions.js';
import { handleCodeAction } from './codeactions/codeactions.js';
import { handleDocumentSymbol } from './symbols/symbols.js';
import { handleSignatureHelp } from './signatures/signatures.js';
import * as fs from 'fs';
import * as path from 'path';
import { parseSchema } from './shared/schema.js';
import type { LiquidType } from './shared/schema.js';

// Initialize LSP connection (handles communication over JSON-RPC stdio/ipc)
const connection = createConnection(ProposedFeatures.all);

// Text document manager (synchronizes open document buffers with editor state)
const documents = new TextDocuments(TextDocument);

// Initialize Liquid parsing engine used to validate syntax blocks
const liquidEngine = new Liquid();
liquidEngine.registerTag('parseAssign', {
  parse() {},
  render() {}
});

// Debounce map for diagnostic pushes to prevent validation thrashing on rapid keystrokes
const pendingValidationTimers = new Map<string, NodeJS.Timeout>();

/**
 * Handle LSP server handshake.
 * 
 * TO EXTEND LSP CAPABILITIES:
 * 1. Add/modify fields inside the `capabilities` object below to announce support to the client (e.g., renameProvider: true).
 * 2. Bind the corresponding event handler further down (e.g., connection.onRenameRequest).
 */
let globalSchema = new Map<string, LiquidType>();

connection.onInitialize((params) => {
  connection.console.log('LSP server: onInitialize handshake started.');

  // 1. Load schema from initializationOptions
  if (params.initializationOptions) {
    const rawVars = params.initializationOptions.variables || params.initializationOptions.schema;
    if (rawVars) {
      globalSchema = parseSchema(rawVars);
    }
  }

  // 2. Load schema from local .liquid-schema.json in workspace if it exists
  const rootPath = params.rootPath;
  if (rootPath) {
    const configPath = path.join(rootPath, '.liquid-schema.json');
    if (fs.existsSync(configPath)) {
      try {
        const rawData = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(rawData);
        const fileSchema = parseSchema(parsed);
        // Merge schemas
        for (const [k, v] of fileSchema.entries()) {
          globalSchema.set(k, v);
        }
        connection.console.log(`LSP server: Loaded local schema from ${configPath}`);
      } catch (err: any) {
        connection.console.log(`LSP server: Error parsing ${configPath}: ${err.message}`);
      }
    }
  }

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
    validateTextDocument(connection, change.document, liquidEngine, globalSchema);
    pendingValidationTimers.delete(uri);
  }, 150);

  pendingValidationTimers.set(uri, newTimer);
});

// Hover tooltip provider (Triggered on hover over variables/tags/filters. Implemented in src/hovers/hovers.ts)
connection.onHover(params => {
  return handleHover(documents, params, globalSchema);
});

// Autocomplete suggestions (Triggered on typing. Implemented in src/completions/completions.ts)
connection.onCompletion(params => {
  return handleCompletion(documents, params);
});

// Resolve lazy documentation for completions (Loads filter/tag docs dynamically. Implemented in src/completions/completions.ts)
connection.onCompletionResolve(item => {
  return handleCompletionResolve(item);
});

// On-type formatting (Triggered when typing block tag boundaries like '}' or '%'. Implemented in src/formatters/formatting.ts)
connection.onDocumentOnTypeFormatting(params => {
  return handleOnTypeFormatting(documents, params);
});

// Signature Help (Triggered on typing parameters like ':' or ','. Implemented in src/signatures/signatures.ts)
connection.onSignatureHelp(params => {
  return handleSignatureHelp(documents, params);
});

// Document Formatting (Triggered manually or on save. Implemented in src/formatters/formatting.ts)
connection.onDocumentFormatting(params => {
  return handleDocumentFormatting(documents, params);
});

// Go to Definition (Triggered on variable reference cmd-click. Implemented in src/definitions/definitions.ts)
connection.onDefinition(params => {
  return handleDefinition(documents, params);
});

// Code Actions / Quick Fixes (Triggered when editor squiggles offer fixes. Implemented in src/codeactions/codeactions.ts)
connection.onCodeAction(params => {
  return handleCodeAction(documents, params);
});

// Document Outline / Symbols (Triggered to populate editor's sidebar outline. Implemented in src/symbols/symbols.ts)
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