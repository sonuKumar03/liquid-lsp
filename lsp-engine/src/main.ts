/**
 * Backward-compatible server entry point.
 * VS Code extension and express-server spawn lsp-engine/dist/main.js --stdio.
 */
import { startNodeServer } from 'lsp-node';

process.on('uncaughtException', (err) => {
  console.error('LSP Engine Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('LSP Engine Unhandled Rejection:', reason);
  process.exit(1);
});

startNodeServer();
