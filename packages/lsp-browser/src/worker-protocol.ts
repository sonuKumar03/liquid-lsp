/** Host → worker: transfer MessagePort for LSP JSON-RPC. */
export const WORKER_INIT_MESSAGE_TYPE = 'liquid-lsp-worker-init';

/** Worker → host: LSP server is listening on the transferred port. */
export const WORKER_READY_SIGNAL = 'liquid-lsp-worker-ready';

export type WorkerInitMessage = {
  type: typeof WORKER_INIT_MESSAGE_TYPE;
  port: MessagePort;
};
