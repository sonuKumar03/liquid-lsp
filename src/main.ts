import {
  createConnection,
  TextDocuments,
  DiagnosticSeverity,
  ProposedFeatures,
  TextDocumentSyncKind,
  CompletionItemKind
} from 'vscode-languageserver/node';
import type {
  Diagnostic,
  InitializeParams,
  InitializeResult,
  CompletionItem,
  Hover,
  TextDocumentPositionParams
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Liquid } from 'liquidjs';
import path from 'path';

/**
 * 1. WHAT IS THE CONNECTION?
 *
 * An LSP server runs as a separate process from the editor (e.g. VS Code, Helix, Neovim).
 * The editor and server communicate using JSON-RPC messages sent over standard input (stdin)
 * and standard output (stdout).
 *
 * createConnection() initializes this JSON-RPC handshake.
 */
const connection = createConnection(ProposedFeatures.all);

/**
 * 2. WHAT IS THE TEXT DOCUMENT MANAGER?
 *
 * An editor keeps files in memory as you type (before you save them).
 * The TextDocuments manager synchronizes these open buffers with the server.
 * When the user types, the editor sends delta changes to the server, and this
 * class updates its internal cache so that we always have the latest document content.
 */
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

/**
 * 3. THE LSP HANDSHAKE: onInitialize
 *
 * When the client/editor connects to the server, the very first request it sends is "initialize".
 * This is where the server and client declare their capabilities to each other:
 * - The Client sends client capabilities (e.g., "I support markdown in hover tools").
 * - The Server responds with server capabilities (e.g., "I support auto-completion and hover").
 */
connection.onInitialize((params: InitializeParams): InitializeResult => {
  connection.console.log('LSP server: onInitialize handshake started.');
  return {
    capabilities: {
      // Synchronize text documents. Incremental sync only sends changes/deltas,
      // which is highly performant compared to sending the whole file on every keypress.
      textDocumentSync: TextDocumentSyncKind.Incremental,
      
      // Let the editor know we support completions (auto-complete suggestions).
      completionProvider: {
        resolveProvider: true // Indicates we can supply additional information for completion items
      },
      
      // Let the editor know we support hover tooltips.
      hoverProvider: true
    }
  };
});

/**
 * 4. CODE VALIDATION (DIAGNOSTICS) WITH DEBOUNCING
 *
 * Diagnostics are the squiggly underlines representing errors, warnings, or hints in your code.
 * We parse the template using `liquidjs` and push syntax diagnostics asynchronously.
 * We debounce this process by 150ms to keep typing responsive and save CPU.
 */
const liquidEngine = new Liquid();
const pendingValidationTimers = new Map<string, NodeJS.Timeout>();

documents.onDidChangeContent(change => {
  const uri = change.document.uri;

  const existingTimer = pendingValidationTimers.get(uri);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const newTimer = setTimeout(() => {
    validateTextDocument(change.document);
    pendingValidationTimers.delete(uri);
  }, 150);

  pendingValidationTimers.set(uri, newTimer);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  connection.console.log('LSP server: validating document: ' + textDocument.uri);
  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  try {
    liquidEngine.parse(text);
  } catch (err: any) {
    let start = { line: 0, character: 0 };
    let end = { line: 0, character: 0 };

    if (err.token && typeof err.token.begin === 'number' && typeof err.token.end === 'number') {
      start = textDocument.positionAt(err.token.begin);
      end = textDocument.positionAt(err.token.end);
    }

    const diagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: { start, end },
      message: err.message || 'Liquid syntax error',
      source: 'liquid-lsp'
    };
    diagnostics.push(diagnostic);
  }

  // Asynchronously send/push the diagnostics back to the editor
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

/**
 * 5. HOVER PROVIDER
 *
 * Triggered when a user hovers their mouse pointer over a piece of code.
 * The server receives the document URI and the cursor position, and responds
 * with markdown or plain text to display in the tooltip.
 */
connection.onHover((params: TextDocumentPositionParams): Hover | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const filename = path.basename(doc.uri);

  return {
    contents: {
      kind: 'markdown',
      value: `### General LSP Hover Info\n\n- **File Name**: \`${filename}\`\n- **Line**: \`${params.position.line + 1}\`\n- **Character**: \`${params.position.character + 1}\``
    }
  };
});

/**
 * 6. COMPLETION PROVIDER
 *
 * Triggered when a user requests auto-completion (e.g. via Ctrl+Space or while typing).
 * We return a list of suggestions.
 */
connection.onCompletion((): CompletionItem[] => {
  return [
    {
      label: 'TypeScript',
      kind: CompletionItemKind.Text,
      data: 1, // Custom identifier for resolving extra details later
      detail: 'TypeScript Language',
      documentation: 'A typed superset of JavaScript.'
    },
    {
      label: 'JavaScript',
      kind: CompletionItemKind.Text,
      data: 2,
      detail: 'JavaScript Language',
      documentation: 'High-level, often just-in-time compiled language.'
    }
  ];
});

/**
 * 7. RESOLVING EXTRA COMPLETION INFO
 *
 * To optimize performance, we initially send a lightweight list of completion items.
 * When the user selects a suggestion in the UI, the editor sends a "completionResolve"
 * request to fetch the heavier documentation or details for *only* that selected item.
 */
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  if (item.data === 1) {
    item.detail = 'TypeScript Language (Resolved)';
    item.documentation = {
      kind: 'markdown',
      value: 'TypeScript adds static type definitions to help catch bugs early.'
    };
  } else if (item.data === 2) {
    item.detail = 'JavaScript Language (Resolved)';
    item.documentation = {
      kind: 'markdown',
      value: 'JavaScript is the main scripting language of the web.'
    };
  }
  return item;
});

connection.onInitialized(() => {
  connection.console.log('LSP server: client connection initialized successfully.');
});

// Bind the document manager's lifecycle events to the connection
documents.listen(connection);

// Start listening for incoming JSON-RPC requests
connection.listen();