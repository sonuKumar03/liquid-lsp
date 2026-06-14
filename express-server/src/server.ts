import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_EXPRESS_GATEWAY_PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.resolve(__dirname, '../public')));
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

/**
 * LSP stream parser to extract JSON payloads from Content-Length stream.
 *
 * To ensure safe processing of binary streams (like UTF-8 chunk streams),
 * this parser keeps raw bytes inside a Buffer instead of parsing strings.
 */
class LSPStreamParser {
  private buffer = Buffer.alloc(0);

  constructor(private onMessage: (msg: string) => void) {}

  public append(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.processBuffer();
  }

  private processBuffer() {
    while (true) {
      // Find the header delimiter \r\n\r\n (sequence: 13, 10, 13, 10)
      const delimiterIndex = this.buffer.indexOf('\r\n\r\n');
      if (delimiterIndex === -1) break;

      const headerPart = this.buffer
        .subarray(0, delimiterIndex)
        .toString('utf8');
      const contentLengthMatch = headerPart.match(/Content-Length:\s*(\d+)/i);

      if (!contentLengthMatch || !contentLengthMatch[1]) {
        // Skip invalid header
        this.buffer = this.buffer.subarray(delimiterIndex + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const bodyStart = delimiterIndex + 4;

      if (this.buffer.length < bodyStart + contentLength) {
        // Wait for more data to complete the body
        break;
      }

      // Extract the body buffer and convert to string
      const bodyBuffer = this.buffer.subarray(
        bodyStart,
        bodyStart + contentLength,
      );
      const bodyPart = bodyBuffer.toString('utf8');

      // Update the remaining buffer
      this.buffer = this.buffer.subarray(bodyStart + contentLength);

      this.onMessage(bodyPart);
    }
  }
}

/**
 * Format JSON object/payload to LSP standard stream message with headers.
 */
function formatLSPMessage(payload: string): string {
  return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}

// Serve Monaco Web Editor on HTTP GET
app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/index.html'));
});

// Serve local SpotDraft LiquidJS browser build
app.get('/liquid.js', (req, res) => {
  res.sendFile(
    path.resolve(
      __dirname,
      '../../node_modules/liquidjs/dist/liquid.browser.umd.js',
    ),
  );
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
  console.log('Client connected via WebSocket.');

  // Path to compiled lsp-engine dist/main.js
  const serverPath = path.resolve(__dirname, '../../lsp-engine/dist/main.js');

  // Spawn the LSP engine in stdio mode
  const lspProcess = spawn('node', [serverPath, '--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  console.log(`Spawned LSP engine child process PID: ${lspProcess.pid}`);

  // Setup parser to parse stdout of LSP server
  const parser = new LSPStreamParser((jsonPayload) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(jsonPayload);
    }
  });

  // Forward LSP stdout -> WebSocket client
  lspProcess.stdout.on('data', (chunk) => {
    parser.append(chunk);
  });

  // Forward LSP stderr -> Server console (for debugging)
  lspProcess.stderr.on('data', (chunk) => {
    console.error(`LSP Server Error Log: ${chunk.toString('utf8').trim()}`);
  });

  // Forward WebSocket client -> LSP stdin
  ws.on('message', (message) => {
    const payload = message.toString();
    const lspMessage = formatLSPMessage(payload);
    if (lspProcess.stdin.writable) {
      lspProcess.stdin.write(lspMessage);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected. Killing LSP child process...');
    lspProcess.kill();
  });

  ws.on('error', (err) => {
    console.error('WebSocket Error:', err);
    lspProcess.kill();
  });

  lspProcess.on('exit', (code) => {
    console.log(`LSP process exited with code: ${code}`);
    ws.close();
  });
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
