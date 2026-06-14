import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createConnection,
} from 'vscode-languageserver/browser';
import { startServer } from 'lsp-common';

/** Browser transport endpoint (Worker global or MessagePort from MessageChannel). */
export type BrowserLspPort = Worker | MessagePort;

/** Build an LSP connection that reads/writes JSON-RPC via postMessage. */
export function getWorkerConnection(
  port: BrowserLspPort,
): ReturnType<typeof createConnection> {
  const reader = new BrowserMessageReader(port);
  const writer = new BrowserMessageWriter(port);
  return createConnection(reader, writer);
}

/** Start the full Liquid LSP inside a Web Worker (no filesystem schema loader). */
export function startWorkerServer(port: BrowserLspPort): void {
  startServer(getWorkerConnection(port));
}

export { startServer } from 'lsp-common';
export {
  connectBrowserLspWorker,
  type BrowserLspWorkerClient,
} from './browser-client.js';
export {
  WORKER_INIT_MESSAGE_TYPE,
  WORKER_READY_SIGNAL,
  type WorkerInitMessage,
} from './worker-protocol.js';
