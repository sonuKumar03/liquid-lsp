import {
  BrowserMessageReader,
  BrowserMessageWriter,
} from 'vscode-jsonrpc/browser';
import { createProtocolConnection } from 'vscode-languageserver-protocol/browser';
import {
  WORKER_INIT_MESSAGE_TYPE,
  WORKER_READY_SIGNAL,
  type WorkerInitMessage,
} from './worker-protocol.js';

export type BrowserLspWorkerClient = {
  sendRequest(method: string, params?: object): Promise<unknown>;
  sendNotification(method: string, params?: object): void;
  onNotification(handler: (method: string, params: unknown) => void): () => void;
  dispose(): void;
};

/**
 * Connect the main thread to a bundled `dist/worker.js` via MessageChannel +
 * vscode-jsonrpc browser transport (Content-Length framed Uint8Array on the port).
 */
export function connectBrowserLspWorker(
  workerScriptUrl: string,
  options?: { readyTimeoutMs?: number },
): Promise<BrowserLspWorkerClient> {
  const readyTimeoutMs = options?.readyTimeoutMs ?? 15000;

  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const worker = new Worker(workerScriptUrl, { type: 'module' });

    // Explicitly start both MessagePorts to enable JSON-RPC messaging
    channel.port1.start();
    channel.port2.start();

    const reader = new BrowserMessageReader(channel.port2);
    const writer = new BrowserMessageWriter(channel.port2);
    const connection = createProtocolConnection(reader, writer);
    const notificationHandlers: Array<
      (method: string, params: unknown) => void
    > = [];

    (
      connection as unknown as {
        onNotification(
          handler: (method: string, params: unknown) => void,
        ): void;
      }
    ).onNotification((method, params) => {
      for (const handler of notificationHandlers) {
        handler(method, params);
      }
    });

    connection.listen();

    let settled = false;

    function dispose(): void {
      channel.port2.close();
      worker.terminate();
    }

    const readyTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      dispose();
      reject(new Error('LSP worker did not become ready'));
    }, readyTimeoutMs);

    worker.onerror = (e: Event) => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimeout);
      dispose();
      const err = e as unknown as Record<string, unknown>;
      const message = typeof err?.message === 'string' ? err.message : 'LSP worker failed to load';
      const filename = typeof err?.filename === 'string' ? err.filename : 'unknown';
      const lineno = typeof err?.lineno === 'number' ? err.lineno : 0;
      reject(new Error(`${message} @ ${filename}:${lineno}`));
    };

    worker.onmessage = (event: MessageEvent) => {
      if (event.data !== WORKER_READY_SIGNAL) {
        return;
      }
      if (settled) return;
      settled = true;
      clearTimeout(readyTimeout);

      resolve({
        sendRequest: (method, params) =>
          connection.sendRequest(method, params),
        sendNotification: (method, params) => {
          connection.sendNotification(method, params);
        },
        onNotification: (handler) => {
          notificationHandlers.push(handler);
          return () => {
            const idx = notificationHandlers.indexOf(handler);
            if (idx !== -1) {
              notificationHandlers.splice(idx, 1);
            }
          };
        },
        dispose,
      });
    };

    const initMessage: WorkerInitMessage = {
      type: WORKER_INIT_MESSAGE_TYPE,
      port: channel.port1,
    };
    worker.postMessage(initMessage, [channel.port1]);
  });
}
