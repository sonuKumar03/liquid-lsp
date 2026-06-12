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
  CompletionParams,
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
        resolveProvider: true,
        triggerCharacters: [' ', '|']
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

function cleanErrorMessage(msg: string): string {
  if (!msg) return 'Liquid syntax error';

  // Match the 'unexpected "..."' pattern and clean it up
  const match = msg.match(/unexpected "([\s\S]+?)"/);
  if (match && match[1]) {
    let rawContent = match[1];
    // Replace newlines and excessive whitespace with a single space
    rawContent = rawContent.replace(/\s+/g, ' ').trim();
    // Truncate if it's too long
    if (rawContent.length > 30) {
      rawContent = rawContent.slice(0, 30) + '...';
    }
    // Re-insert it
    msg = msg.replace(/unexpected "[\s\S]+?"/, `unexpected "${rawContent}"`);
  }

  // Replace any remaining newlines with spaces in the whole message
  return msg.replace(/\r?\n/g, ' ');
}

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
      message: cleanErrorMessage(err.message),
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

// Static lists of Liquid Core Tags and Filters
const LIQUID_TAGS: CompletionItem[] = [
  { label: 'assign', kind: CompletionItemKind.Keyword, data: 'tag-assign' },
  { label: 'increment', kind: CompletionItemKind.Keyword, data: 'tag-increment' },
  { label: 'decrement', kind: CompletionItemKind.Keyword, data: 'tag-decrement' },
  { label: 'capture', kind: CompletionItemKind.Keyword, data: 'tag-capture' },
  { label: 'case', kind: CompletionItemKind.Keyword, data: 'tag-case' },
  { label: 'comment', kind: CompletionItemKind.Keyword, data: 'tag-comment' },
  { label: 'cycle', kind: CompletionItemKind.Keyword, data: 'tag-cycle' },
  { label: 'echo', kind: CompletionItemKind.Keyword, data: 'tag-echo' },
  { label: 'for', kind: CompletionItemKind.Keyword, data: 'tag-for' },
  { label: 'if', kind: CompletionItemKind.Keyword, data: 'tag-if' },
  { label: 'unless', kind: CompletionItemKind.Keyword, data: 'tag-unless' },
  { label: 'include', kind: CompletionItemKind.Keyword, data: 'tag-include' },
  { label: 'layout', kind: CompletionItemKind.Keyword, data: 'tag-layout' },
  { label: 'render', kind: CompletionItemKind.Keyword, data: 'tag-render' },
  { label: 'raw', kind: CompletionItemKind.Keyword, data: 'tag-raw' },
  { label: 'tablerow', kind: CompletionItemKind.Keyword, data: 'tag-tablerow' }
];

const LIQUID_FILTERS: CompletionItem[] = [
  { label: 'abs', kind: CompletionItemKind.Function, data: 'filter-abs' },
  { label: 'append', kind: CompletionItemKind.Function, data: 'filter-append' },
  { label: 'capitalize', kind: CompletionItemKind.Function, data: 'filter-capitalize' },
  { label: 'ceil', kind: CompletionItemKind.Function, data: 'filter-ceil' },
  { label: 'concat', kind: CompletionItemKind.Function, data: 'filter-concat' },
  { label: 'date', kind: CompletionItemKind.Function, data: 'filter-date' },
  { label: 'default', kind: CompletionItemKind.Function, data: 'filter-default' },
  { label: 'divided_by', kind: CompletionItemKind.Function, data: 'filter-divided_by' },
  { label: 'downcase', kind: CompletionItemKind.Function, data: 'filter-downcase' },
  { label: 'escape', kind: CompletionItemKind.Function, data: 'filter-escape' },
  { label: 'first', kind: CompletionItemKind.Function, data: 'filter-first' },
  { label: 'floor', kind: CompletionItemKind.Function, data: 'filter-floor' },
  { label: 'join', kind: CompletionItemKind.Function, data: 'filter-join' },
  { label: 'last', kind: CompletionItemKind.Function, data: 'filter-last' },
  { label: 'minus', kind: CompletionItemKind.Function, data: 'filter-minus' },
  { label: 'modulo', kind: CompletionItemKind.Function, data: 'filter-modulo' },
  { label: 'plus', kind: CompletionItemKind.Function, data: 'filter-plus' },
  { label: 'prepend', kind: CompletionItemKind.Function, data: 'filter-prepend' },
  { label: 'replace', kind: CompletionItemKind.Function, data: 'filter-replace' },
  { label: 'reverse', kind: CompletionItemKind.Function, data: 'filter-reverse' },
  { label: 'round', kind: CompletionItemKind.Function, data: 'filter-round' },
  { label: 'size', kind: CompletionItemKind.Function, data: 'filter-size' },
  { label: 'slice', kind: CompletionItemKind.Function, data: 'filter-slice' },
  { label: 'sort', kind: CompletionItemKind.Function, data: 'filter-sort' },
  { label: 'split', kind: CompletionItemKind.Function, data: 'filter-split' },
  { label: 'strip', kind: CompletionItemKind.Function, data: 'filter-strip' },
  { label: 'times', kind: CompletionItemKind.Function, data: 'filter-times' },
  { label: 'truncate', kind: CompletionItemKind.Function, data: 'filter-truncate' },
  { label: 'uniq', kind: CompletionItemKind.Function, data: 'filter-uniq' },
  { label: 'upcase', kind: CompletionItemKind.Function, data: 'filter-upcase' }
];

/**
 * 6. COMPLETION PROVIDER
 *
 * Triggered when autocomplete is requested.
 * We inspect the current line up to the cursor position to determine the context:
 * - If after a pipe '|', return filters.
 * - If inside tag delimiters '{%', return tags.
 */
connection.onCompletion((params: CompletionParams): CompletionItem[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const position = params.position;
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: position
  });

  // Check if cursor is after a filter pipe '|' on the current line
  const lastPipe = lineText.lastIndexOf('|');
  const lastTagOpen = lineText.lastIndexOf('{%');
  const lastOutputOpen = lineText.lastIndexOf('{{');

  if (lastPipe !== -1 && (lastPipe > lastTagOpen || lastPipe > lastOutputOpen)) {
    return LIQUID_FILTERS;
  }

  // Check if cursor is inside a tag block '{%' (without being closed)
  const lastTagClose = lineText.lastIndexOf('%}');
  if (lastTagOpen !== -1 && lastTagOpen > lastTagClose) {
    return LIQUID_TAGS;
  }

  return [];
});

/**
 * 7. RESOLVING EXTRA COMPLETION INFO
 *
 * Fetches documentation only when a specific autocomplete suggestion is highlighted.
 */
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  const data = item.data as string;

  if (data.startsWith('tag-')) {
    const tagName = data.replace('tag-', '');
    item.detail = `Liquid Tag: {% ${tagName} %}`;
    item.documentation = {
      kind: 'markdown',
      value: getTagDocumentation(tagName)
    };
  } else if (data.startsWith('filter-')) {
    const filterName = data.replace('filter-', '');
    item.detail = `Liquid Filter: | ${filterName}`;
    item.documentation = {
      kind: 'markdown',
      value: getFilterDocumentation(filterName)
    };
  }

  return item;
});

function getTagDocumentation(tag: string): string {
  switch (tag) {
    case 'assign':
      return 'Creates a new variable.\n\n```liquid\n{% assign my_var = false %}\n```';
    case 'if':
      return 'Conditional execution of code.\n\n```liquid\n{% if condition %}\n  ...\n{% endif %}\n```';
    case 'for':
      return 'Loops through a collection.\n\n```liquid\n{% for item in collection %}\n  {{ item }}\n{% endfor %}\n```';
    case 'capture':
      return 'Captures the string output inside the block into a variable.\n\n```liquid\n{% capture my_variable %}\n  Hello {{ name }}\n{% endcapture %}\n```';
    case 'comment':
      return 'Allows you to leave un-rendered comments in your template.\n\n```liquid\n{% comment %}\n  This won\'t be rendered.\n{% endcomment %}\n```';
    case 'render':
      return 'Renders a partial template file.\n\n```liquid\n{% render "snippet-name" %}\n```';
    default:
      return `Liquid core tag: \`{% ${tag} %}\`.`;
  }
}

function getFilterDocumentation(filter: string): string {
  switch (filter) {
    case 'upcase':
      return 'Converts a string to uppercase.\n\n```liquid\n{{ "hello" | upcase }} => "HELLO"\n```';
    case 'downcase':
      return 'Converts a string to lowercase.\n\n```liquid\n{{ "HELLO" | downcase }} => "hello"\n```';
    case 'default':
      return 'Returns a fallback value if the input is nil, false, or empty.\n\n```liquid\n{{ undefined_variable | default: "fallback" }} => "fallback"\n```';
    case 'split':
      return 'Splits a string on a delimiter into an array.\n\n```liquid\n{{ "a,b,c" | split: "," }} => ["a", "b", "c"]\n```';
    case 'join':
      return 'Joins an array of strings using a connector.\n\n```liquid\n{{ my_array | join: ", " }}\n```';
    default:
      return `Liquid core filter: \`| ${filter}\`.`;
  }
}

connection.onInitialized(() => {
  connection.console.log('LSP server: client connection initialized successfully.');
});

// Bind the document manager's lifecycle events to the connection
documents.listen(connection);

// Start listening for incoming JSON-RPC requests
connection.listen();