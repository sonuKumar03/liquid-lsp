/**
 * Bundled worker entry (dist/worker.js). The host page posts JSON-RPC messages
 * to this worker; responses are posted back via BrowserMessageWriter.
 */
import { startWorkerServer } from './index.js';

startWorkerServer(self as unknown as Worker);
