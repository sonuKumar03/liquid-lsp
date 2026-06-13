/**
 * Backward-compatible server entry point.
 * VS Code extension and express-server spawn lsp-engine/dist/main.js --stdio.
 */
import { startNodeServer } from 'lsp-node';

startNodeServer();
