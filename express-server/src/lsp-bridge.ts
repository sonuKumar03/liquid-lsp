import type { WebSocket } from 'ws';
import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { LSPStreamParser, formatLSPMessage } from './stream-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_MESSAGE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Manages child process lifecycle and bidirectional communication
 * between the WebSocket client and the LSP child process.
 */
export function setupLSPBridge(ws: WebSocket): void {
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

  // Handle process spawn or runtime errors
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
    lspProcess.stdout.on('data', (chunk: Buffer) => {
      parser.append(chunk);
    });
  }

  // Forward LSP stderr -> Server console (for debugging)
  if (lspProcess.stderr) {
    lspProcess.stderr.on('data', (chunk: Buffer) => {
      console.error(`LSP Server Error Log: ${chunk.toString('utf8').trim()}`);
    });
  }

  // Forward WebSocket client -> LSP stdin
  ws.on('message', (message) => {
    const byteLength = getMessageByteLength(message);

    if (byteLength > MAX_MESSAGE_SIZE) {
      console.error(
        `Rejected message of size ${byteLength} exceeding limit of ${MAX_MESSAGE_SIZE}`,
      );
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
      console.error(
        'Invalid non-JSON or malformed WebSocket message received:',
        err,
      );
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
}

/**
 * Calculates byte size of a WebSocket message payload.
 */
function getMessageByteLength(message: unknown): number {
  if (Buffer.isBuffer(message)) {
    return message.length;
  }
  if (Array.isArray(message)) {
    return message.reduce(
      (acc, chunk) => acc + (Buffer.isBuffer(chunk) ? chunk.length : 0),
      0,
    );
  }
  if (message instanceof ArrayBuffer) {
    return message.byteLength;
  }
  return 0;
}
