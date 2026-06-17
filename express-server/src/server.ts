import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { setupLSPBridge } from './lsp-bridge.js';

const require = createRequire(import.meta.url);

const DEFAULT_EXPRESS_GATEWAY_PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.resolve(__dirname, '../public')));
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Serve Monaco Web Editor on HTTP GET
app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/index.html'));
});

// Serve local SpotDraft LiquidJS browser build
app.get('/liquid.js', (req, res) => {
  res.sendFile(require.resolve('liquidjs/dist/liquid.browser.umd.js'));
});

// Serve bundled browser LSP worker (Monaco Web Worker transport)
app.get('/lsp-worker.js', (req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  res.sendFile(
    path.resolve(__dirname, '../../packages/lsp-browser/dist/worker.js'),
  );
});

// Main-thread client for worker transport (vscode-jsonrpc browser protocol)
app.get('/lsp-browser-client.js', (req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  res.sendFile(
    path.resolve(
      __dirname,
      '../../packages/lsp-browser/dist/browser-client.js',
    ),
  );
});

// Handle WebSocket connections
wss.on('connection', (ws) => {
  setupLSPBridge(ws);
});

// Bridge HTTP upgrade request to WebSocket handler on path "/lsp"
server.on('upgrade', (request, socket, head) => {
  const pathname = request.url
    ? new URL(request.url, `http://${request.headers.host}`).pathname
    : '';

  if (pathname === '/lsp') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

const PORT = process.env.PORT || DEFAULT_EXPRESS_GATEWAY_PORT;
server.listen(PORT, () => {
  console.log(`Express WebSocket LSP Gateway listening on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/lsp`);
});
