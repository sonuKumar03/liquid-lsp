import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import type { Connection } from 'vscode-languageserver';
import { startServer } from 'lsp-common';
import { nodeWorkspaceSchemaLoader } from './workspace-schema-loader.js';

/** Starts the Liquid LSP on a Node stdio JSON-RPC connection. */
export function startNodeServer(
  connection: Connection = createConnection(ProposedFeatures.all),
): Connection {
  startServer(connection, {
    workspaceSchemaLoader: nodeWorkspaceSchemaLoader,
  });
  return connection;
}
