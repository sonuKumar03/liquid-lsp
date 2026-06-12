import { test } from 'node:test';
import assert from 'node:assert';
import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to format a JSON object into a standard LSP/JSON-RPC message
function formatLSPMessage(jsonPayload: object): string {
  const content = JSON.stringify(jsonPayload);
  return `Content-Length: ${Buffer.byteLength(content, 'utf8')}\r\n\r\n${content}`;
}

// Robust message reader to parse incoming JSON-RPC chunks from stdout.
// This handles case-by-case fragmentation, concatenating stdout buffers,
// reading headers, and parsing multiple messages correctly.
class LSPMessageReader {
  private buffer = '';

  constructor(
    private stdout: NodeJS.ReadableStream,
    private onMessage: (msg: any) => void
  ) {
    this.stdout.on('data', (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });
  }

  private processBuffer() {
    while (true) {
      const delimiterIndex = this.buffer.indexOf('\r\n\r\n');
      if (delimiterIndex === -1) break;

      const headerPart = this.buffer.slice(0, delimiterIndex);
      const contentLengthMatch = headerPart.match(/Content-Length:\s*(\d+)/i);

      if (!contentLengthMatch || !contentLengthMatch[1]) {
        this.buffer = this.buffer.slice(delimiterIndex + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const bodyStart = delimiterIndex + 4;

      if (Buffer.byteLength(this.buffer.slice(bodyStart), 'utf8') < contentLength) {
        break;
      }

      const bodyPart = this.buffer.slice(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      try {
        const json = JSON.parse(bodyPart);
        this.onMessage(json);
      } catch (e) {
        console.error('Failed to parse message:', bodyPart, e);
      }
    }
  }
}

test('Liquid syntax diagnostics lifecycle', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    // If it's a logging notification, print it and don't advance our step logic
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      // 1. Handshake response received. Verify capabilities.
      assert.ok(res.result.capabilities.hoverProvider);
      
      // Complete handshake and open invalid document
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: { textDocument: { uri: 'file:///t.liquid', languageId: 'liquid', version: 1, text: '{% if x }' } }
      }));
      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      // 2. Syntax validation warning received. Verify details and correct it.
      assert.ok(res.params.diagnostics.length > 0);
      assert.ok(res.params.diagnostics[0].message);
      assert.strictEqual(res.params.diagnostics[0].range.start.character, 0); // Fails at tag start

      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: { textDocument: { uri: 'file:///t.liquid', version: 2 }, contentChanges: [{ text: '{% if x %}{% endif %}' }] }
      }));
      step = 2;
    } else if (step === 2 && res.method === 'textDocument/publishDiagnostics') {
      // 3. Diagnostics cleared notification received.
      assert.strictEqual(res.params.diagnostics.length, 0);
      child.kill('SIGINT');
      done();
    }
  });

  // Start initialization handshake
  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
});
