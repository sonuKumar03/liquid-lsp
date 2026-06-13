import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createLiquidEngine } from 'liquid-core';
import { validateTextDocument } from './linters/diagnostics.js';
import { handleHover } from './hovers/hovers.js';
import {
  handleCompletion,
  handleCompletionResolve,
} from './completions/completions.js';
import {
  handleOnTypeFormatting,
  handleDocumentFormatting,
} from './formatters/formatting.js';
import { handleDefinition } from './definitions/definitions.js';
import { handleCodeAction } from './codeactions/codeactions.js';
import { handleDocumentSymbol } from './symbols/symbols.js';
import { handleSignatureHelp } from './signatures/signatures.js';
import * as fs from 'fs';
import * as path from 'path';
import type { LiquidType } from './shared/schema.js';
import {
  mergeVariableSchemas,
  parseVariableSchema,
  type SchemaLoadError,
} from 'key-pointer-schema';

// Initialize LSP connection (handles communication over JSON-RPC stdio/ipc)
const connection = createConnection(ProposedFeatures.all);

// Text document manager (synchronizes open document buffers with editor state)
const documents = new TextDocuments(TextDocument);

// Initialize Liquid parsing engine used to validate syntax blocks
const liquidEngine = createLiquidEngine();

// Debounce map for diagnostic pushes to prevent validation thrashing on rapid keystrokes
const pendingValidationTimers = new Map<string, NodeJS.Timeout>();

let globalSchema = new Map<string, LiquidType>();
let globalContextData: any = {};
let schemaLoadErrors: SchemaLoadError[] = [];
let workspaceRoot: string | null = null;

function reportSchemaLoadErrors(errors: SchemaLoadError[]): void {
  for (const error of errors) {
    if (error.severity !== 'error') {
      continue;
    }
    connection.console.error(`Schema error: ${error.message}`);
  }
}

function validateAllOpenDocuments(): void {
  documents.all().forEach((doc) => {
    validateTextDocument(
      connection,
      doc,
      liquidEngine,
      globalSchema,
      schemaLoadErrors,
    );
  });
}

function applyVariableSchema(raw: unknown, context?: string): void {
  const parsed = parseVariableSchema(raw);
  if (parsed.usedLegacyLiquidSchema) {
    connection.console.log(
      `LSP server: loaded legacy liquid schema${context ? ` from ${context}` : ''}.`,
    );
  }

  globalSchema = parsed.liquidSchema;
  schemaLoadErrors = parsed.errors;

  if (schemaLoadErrors.length > 0) {
    reportSchemaLoadErrors(schemaLoadErrors);
    connection.console.log(
      `LSP server: variable schema has ${schemaLoadErrors.length} issue(s)${context ? ` (${context})` : ''}.`,
    );
  }
}

function loadWorkspaceSchemaFile(rootPath: string): void {
  const configPath = path.join(rootPath, '.liquid-schema.json');
  if (!fs.existsSync(configPath)) {
    return;
  }

  try {
    const rawData = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(rawData);
    const fileResult = parseVariableSchema(parsed);
    const merged = mergeVariableSchemas(
      {
        variables: new Map(),
        liquidSchema: globalSchema,
        errors: [],
        usedLegacyLiquidSchema: false,
      },
      fileResult,
    );
    globalSchema = merged.liquidSchema;
    schemaLoadErrors = [...schemaLoadErrors, ...merged.errors];
    connection.console.log(
      `LSP server: Loaded local schema from ${configPath}`,
    );
  } catch (err: any) {
    connection.console.log(
      `LSP server: Error parsing ${configPath}: ${err.message}`,
    );
    schemaLoadErrors = [
      ...schemaLoadErrors,
      {
        severity: 'error',
        code: 'key_pointer.schema.load_error',
        message: `Failed to parse ${configPath}: ${err.message}`,
      },
    ];
  }
}

connection.onInitialize((params) => {
  connection.console.log('LSP server: onInitialize handshake started.');

  if (params.initializationOptions) {
    const rawVars =
      params.initializationOptions.variables ||
      params.initializationOptions.schema;
    if (rawVars) {
      applyVariableSchema(rawVars, 'initializationOptions');
    }
  }

  const rootPath = params.rootPath;
  workspaceRoot = rootPath ?? null;
  if (rootPath) {
    loadWorkspaceSchemaFile(rootPath);
    validateAllOpenDocuments();
  }

  return {
    capabilities: {
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
    },
  };
});

documents.onDidChangeContent((change) => {
  const uri = change.document.uri;

  const existingTimer = pendingValidationTimers.get(uri);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const newTimer = setTimeout(() => {
    validateTextDocument(
      connection,
      change.document,
      liquidEngine,
      globalSchema,
      schemaLoadErrors,
    );
    pendingValidationTimers.delete(uri);
  }, 150);

  pendingValidationTimers.set(uri, newTimer);
});

connection.onHover((params) => {
  return handleHover(documents, params, globalSchema, globalContextData);
});

connection.onCompletion((params) => {
  return handleCompletion(documents, params, globalSchema);
});

connection.onCompletionResolve((item) => {
  return handleCompletionResolve(item);
});

connection.onDocumentOnTypeFormatting((params) => {
  return handleOnTypeFormatting(documents, params);
});

connection.onSignatureHelp((params) => {
  return handleSignatureHelp(documents, params);
});

connection.onDocumentFormatting((params) => {
  return handleDocumentFormatting(documents, params);
});

connection.onDefinition((params) => {
  return handleDefinition(documents, params, workspaceRoot);
});

connection.onCodeAction((params) => {
  return handleCodeAction(documents, params);
});

connection.onDocumentSymbol((params) => {
  return handleDocumentSymbol(documents, params);
});

connection.onNotification(
  'workspace/updateSchema',
  (params: { schema: any; contextData?: any }) => {
    if (params && params.schema) {
      applyVariableSchema(params.schema, 'workspace/updateSchema');
      if (params.contextData) {
        globalContextData = params.contextData;
      }

      if (workspaceRoot) {
        loadWorkspaceSchemaFile(workspaceRoot);
      }

      validateAllOpenDocuments();
    }
  },
);

connection.onInitialized(() => {
  connection.console.log(
    'LSP server: client connection initialized successfully.',
  );
});

documents.listen(connection);

connection.listen();
