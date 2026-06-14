import {
  BrowserMessageReader,
  BrowserMessageWriter,
} from 'vscode-jsonrpc/browser';
import { createProtocolConnection } from 'vscode-languageserver-protocol/browser';
import { PublishDiagnosticsNotification } from 'vscode-languageserver-protocol';
import {
  WORKER_INIT_MESSAGE_TYPE,
  WORKER_READY_SIGNAL,
  type WorkerInitMessage,
} from './worker-protocol.js';

export type BrowserLspWorkerClient = {
  sendRequest(method: string, params?: object): Promise<unknown>;
  sendNotification(method: string, params?: object): void;
  onNotification(handler: (method: string, params: unknown) => void): void;
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
    const reader = new BrowserMessageReader(channel.port2);
    const writer = new BrowserMessageWriter(channel.port2);
    const connection = createProtocolConnection(reader, writer);
    const notificationHandlers: Array<
      (method: string, params: unknown) => void
    > = [];

    connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
      for (const handler of notificationHandlers) {
        handler(PublishDiagnosticsNotification.method, params);
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

    worker.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimeout);
      dispose();
      reject(new Error('LSP worker failed to load'));
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
          connection.sendRequest(method as never, params as never),
        sendNotification: (method, params) => {
          connection.sendNotification(method as never, params as never);
        },
        onNotification: (handler) => {
          notificationHandlers.push(handler);
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
