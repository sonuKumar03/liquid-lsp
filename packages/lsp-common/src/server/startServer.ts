import type { Connection, SemanticTokensParams } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createLiquidEngine } from 'liquid-core';
import { handleCodeAction } from '../codeactions/codeactions.js';
import {
  handleCompletion,
  handleCompletionResolve,
} from '../completions/completions.js';
import { handleDefinition } from '../definitions/definitions.js';
import {
  handleOnTypeFormatting,
  handleDocumentFormatting,
} from '../formatters/formatting.js';
import { handleHover } from '../hovers/hovers.js';
import { validateTextDocument } from '../linters/diagnostics.js';
import { handleSignatureHelp } from '../signatures/signatures.js';
import { handleDocumentSymbol } from '../symbols/symbols.js';
import { handleRename } from '../rename/rename.js';
import { handleSemanticTokens } from '../semanticTokens/semanticTokens.js';
import { SERVER_CAPABILITIES } from './capabilities.js';
import { DocumentManager } from './document-manager.js';
import { DiagnosticsScheduler } from './diagnostics-scheduler.js';
import { TypeSystem, type WorkspaceSchemaLoader } from './type-system.js';

export interface StartServerDependencies {
  /** Optional loader for `.liquid-schema.json` at workspace root (Node). */
  workspaceSchemaLoader?: WorkspaceSchemaLoader;
}

/**
 * Runtime-agnostic LSP entry point. Wires TypeSystem, DocumentManager,
 * DiagnosticsScheduler, and all feature handlers onto the given connection.
 */
export function startServer(
  connection: Connection,
  dependencies: StartServerDependencies = {},
): void {
  const typeSystem = new TypeSystem(
    {
      log: (message) => connection.console.log(message),
      error: (message) => connection.console.error(message),
    },
    dependencies.workspaceSchemaLoader,
  );
  const documentManager = new DocumentManager(connection);
  const liquidEngine = createLiquidEngine();

  const validateDocument = (document: TextDocument) => {
    const tokens = documentManager.getTokens(document.uri, liquidEngine);
    validateTextDocument(
      connection,
      document,
      liquidEngine,
      typeSystem.getLiquidSchema(),
      typeSystem.getVariableDeclarations(),
      typeSystem.getSchemaLoadErrors(),
      tokens,
    );
  };

  const diagnosticsScheduler = new DiagnosticsScheduler(validateDocument);

  connection.onInitialize((params) => {
    connection.console.log('LSP server: onInitialize handshake started.');

    if (params.initializationOptions) {
      const rawVars =
        params.initializationOptions.variables ||
        params.initializationOptions.schema;
      if (rawVars) {
        const normalized = Array.isArray(rawVars)
          ? { variables: rawVars }
          : rawVars;
        typeSystem.applyVariableSchema(normalized, 'initializationOptions');
      }
    }

    const rootPath = params.rootPath;
    typeSystem.setWorkspaceRoot(rootPath ?? null);
    if (rootPath) {
      typeSystem.loadWorkspaceSchemaFile(rootPath);
      diagnosticsScheduler.validateAll(documentManager.documents.all());
    }

    return { capabilities: SERVER_CAPABILITIES };
  });

  documentManager.documents.onDidChangeContent((change) => {
    diagnosticsScheduler.schedule(change.document);
  });

  connection.onHover((params) => {
    return handleHover(
      documentManager.documents,
      params,
      typeSystem.getLiquidSchema(),
      typeSystem.getContextData(),
    );
  });

  connection.onCompletion((params) => {
    return handleCompletion(
      documentManager,
      liquidEngine,
      params,
      typeSystem.getLiquidSchema(),
    );
  });

  connection.onCompletionResolve((item) => {
    return handleCompletionResolve(item);
  });

  connection.onDocumentOnTypeFormatting((params) => {
    return handleOnTypeFormatting(documentManager.documents, params);
  });

  connection.onSignatureHelp((params) => {
    return handleSignatureHelp(documentManager.documents, params);
  });

  connection.onDocumentFormatting((params) => {
    return handleDocumentFormatting(documentManager.documents, params);
  });

  connection.onDefinition((params) => {
    return handleDefinition(
      documentManager,
      liquidEngine,
      params,
      typeSystem.getWorkspaceRoot(),
    );
  });

  connection.onCodeAction((params) => {
    return handleCodeAction(documentManager.documents, params);
  });

  connection.onDocumentSymbol((params) => {
    return handleDocumentSymbol(documentManager, liquidEngine, params);
  });

  connection.onRenameRequest((params) => {
    return handleRename(
      documentManager,
      params,
      typeSystem.getLiquidSchema(),
    );
  });

  connection.languages.semanticTokens.on((params: SemanticTokensParams) => {
    return handleSemanticTokens(
      documentManager,
      params,
      typeSystem.getLiquidSchema(),
    );
  });

  connection.onNotification(
    'workspace/updateSchema',
    (params: { schema: unknown; contextData?: Record<string, unknown> }) => {
      if (params?.schema) {
        typeSystem.applyVariableSchema(params.schema, 'workspace/updateSchema');
        if (params.contextData) {
          typeSystem.setContextData(params.contextData);
        }

        typeSystem.mergeWorkspaceSchemaIfPresent();
        diagnosticsScheduler.validateAll(documentManager.documents.all());
      }
    },
  );

  connection.onInitialized(() => {
    connection.console.log(
      'LSP server: client connection initialized successfully.',
    );
  });

  documentManager.listen();
  connection.listen();
}
