import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createConnection,
} from 'vscode-languageserver/browser';
import { startServer } from 'lsp-common';

/** Build an LSP connection that reads/writes JSON-RPC via Worker postMessage. */
export function getWorkerConnection(worker: Worker): ReturnType<
  typeof createConnection
> {
  const reader = new BrowserMessageReader(worker);
  const writer = new BrowserMessageWriter(worker);
  return createConnection(reader, writer);
}

/** Start the full Liquid LSP inside a Web Worker (no filesystem schema loader). */
export function startWorkerServer(worker: Worker): void {
  startServer(getWorkerConnection(worker));
}

export { startServer } from 'lsp-common';
