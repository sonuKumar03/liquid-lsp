import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import type { Connection } from 'vscode-languageserver';
import { startServer } from 'lsp-common';

export function startNodeServer(
  connection: Connection = createConnection(ProposedFeatures.all),
): Connection {
  startServer(connection);
  return connection;
}
