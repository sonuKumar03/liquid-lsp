import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

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
  private chunks: Buffer[] = [];
  private totalLength = 0;

  constructor(private onMessage: (msg: string) => void) {}

  public append(chunk: Buffer) {
    this.chunks.push(chunk);
    this.totalLength += chunk.length;
    this.processBuffer();
  }

  private processBuffer() {
    if (this.chunks.length > 1) {
      this.chunks = [Buffer.concat(this.chunks, this.totalLength)];
    }
    let buffer = this.chunks[0] || Buffer.alloc(0);

    while (true) {
      // Find the header delimiter \r\n\r\n (sequence: 13, 10, 13, 10)
      const delimiterIndex = buffer.indexOf('\r\n\r\n');
      if (delimiterIndex === -1) break;

      const headerPart = buffer
        .subarray(0, delimiterIndex)
        .toString('utf8');
      const contentLengthMatch = headerPart.match(/Content-Length:\s*(\d+)/i);

      if (!contentLengthMatch || !contentLengthMatch[1]) {
        // Stream is corrupted. Discard up to next Content-Length header to resynchronize.
        const str = buffer.toString('utf8');
        const nextHeaderMatch = str.slice(delimiterIndex + 4).match(/Content-Length:/i);
        if (nextHeaderMatch && nextHeaderMatch.index !== undefined) {
          buffer = buffer.subarray(delimiterIndex + 4 + nextHeaderMatch.index);
        } else {
          buffer = Buffer.alloc(0);
        }
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const bodyStart = delimiterIndex + 4;

      if (buffer.length < bodyStart + contentLength) {
        // Wait for more data to complete the body
        break;
      }

      // Extract the body buffer and convert to string
      const bodyBuffer = buffer.subarray(
        bodyStart,
        bodyStart + contentLength,
      );
      const bodyPart = bodyBuffer.toString('utf8');

      // Update the remaining buffer
      buffer = buffer.subarray(bodyStart + contentLength);

      this.onMessage(bodyPart);
    }

    if (buffer.length === 0) {
      this.chunks = [];
      this.totalLength = 0;
    } else {
      this.chunks = [buffer];
      this.totalLength = buffer.length;
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
  console.log('Client connected via WebSocket.');

  // Path to compiled lsp-engine dist/main.js
  const serverPath = path.resolve(__dirname, '../../lsp-engine/dist/main.js');

  // Spawn the LSP engine in stdio mode
  const lspProcess = spawn('node', [serverPath, '--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (lspProcess.pid !== undefined) {
    console.log(`Spawned LSP engine child process PID: ${lspProcess.pid}`);
  } else {
    console.log('Spawned LSP engine child process with unknown PID');
  }

  lspProcess.on('error', (err) => {
    console.error('Failed to spawn LSP process:', err);
    if (ws.readyState === ws.OPEN) {
      ws.close(1011, 'LSP server spawn error');
    }
  });

  // Setup parser to parse stdout of LSP server
  const parser = new LSPStreamParser((jsonPayload) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(jsonPayload);
    }
  });

  // Forward LSP stdout -> WebSocket client
  if (lspProcess.stdout) {
    lspProcess.stdout.on('data', (chunk) => {
      parser.append(chunk);
    });
  }

  // Forward LSP stderr -> Server console (for debugging)
  if (lspProcess.stderr) {
    lspProcess.stderr.on('data', (chunk) => {
      console.error(`LSP Server Error Log: ${chunk.toString('utf8').trim()}`);
    });
  }

  // Forward WebSocket client -> LSP stdin
  const MAX_MESSAGE_SIZE = 5 * 1024 * 1024; // 5 MB

  ws.on('message', (message) => {
    const byteLength = Buffer.isBuffer(message)
      ? message.length
      : Array.isArray(message)
      ? message.reduce((acc, chunk) => acc + (chunk as Buffer).length, 0)
      : message instanceof ArrayBuffer
      ? message.byteLength
      : 0;

    if (byteLength > MAX_MESSAGE_SIZE) {
      console.error(`Rejected message of size ${byteLength} exceeding limit of ${MAX_MESSAGE_SIZE}`);
      ws.close(1009, 'Message size exceeds limit');
      return;
    }

    let payload: string;
    try {
      if (Buffer.isBuffer(message)) {
        payload = message.toString('utf8');
      } else {
        payload = Buffer.from(message as ArrayBuffer).toString('utf8');
      }
      JSON.parse(payload);
    } catch (err) {
      console.error('Invalid non-JSON or malformed WebSocket message received:', err);
      ws.close(1007, 'Invalid UTF-8 or malformed JSON-RPC message');
      return;
    }

    const lspMessage = formatLSPMessage(payload);
    if (lspProcess.stdin && lspProcess.stdin.writable) {
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
