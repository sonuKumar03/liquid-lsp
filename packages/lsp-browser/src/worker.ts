/**
 * Bundled worker entry (dist/worker.js). Host uses `connectBrowserLspWorker` and
 * transfers a MessagePort for framed JSON-RPC.
 */
import { startWorkerServer } from './index.js';
import {
  WORKER_INIT_MESSAGE_TYPE,
  WORKER_READY_SIGNAL,
  type WorkerInitMessage,
} from './worker-protocol.js';

self.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as WorkerInitMessage;
  if (data?.type !== WORKER_INIT_MESSAGE_TYPE || !data.port) {
    return;
  }

  try {
    startWorkerServer(data.port);
    self.postMessage(WORKER_READY_SIGNAL);
  } catch (err) {
    console.error('LSP worker failed to start server:', err);
    throw err;
  }
});
