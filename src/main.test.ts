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
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      assert.ok(res.result.capabilities.hoverProvider);
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: { textDocument: { uri: 'file:///t.liquid', languageId: 'liquid', version: 1, text: '{% if x }' } }
      }));
      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      assert.ok(res.params.diagnostics.length > 0);
      assert.strictEqual(res.params.diagnostics[0].range.start.character, 0);

      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: { textDocument: { uri: 'file:///t.liquid', version: 2 }, contentChanges: [{ text: '{% if x %}{% endif %}' }] }
      }));
      step = 2;
    } else if (step === 2 && res.method === 'textDocument/publishDiagnostics') {
      assert.strictEqual(res.params.diagnostics.length, 0);
      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
});

test('Liquid auto-complete context suggestions', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      // Complete handshake
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));

      // Open a document with a tag fragment: `{% ass`
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///t.liquid',
            languageId: 'liquid',
            version: 1,
            text: '{% ass'
          }
        }
      }));

      // Immediately query autocomplete right after "ass" (character index 6)
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/completion',
        params: {
          textDocument: { uri: 'file:///t.liquid' },
          position: { line: 0, character: 6 }
        }
      }));

      step = 1;
    } else if (step === 1 && res.id === 2) {
      // Verify tag completions are returned (specifically 'assign')
      const items = res.result;
      assert.ok(items.length > 0);
      const hasAssign = items.some((item: any) => item.label === 'assign' && item.data === 'tag-assign');
      assert.ok(hasAssign, 'Expected "assign" tag in autocomplete list');

      // Change document to filter fragment: `{{ name | up`
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: 'file:///t.liquid', version: 2 },
          contentChanges: [{ text: '{{ name | up' }]
        }
      }));

      // Query autocomplete right after "up" (character index 12)
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'textDocument/completion',
        params: {
          textDocument: { uri: 'file:///t.liquid' },
          position: { line: 0, character: 12 }
        }
      }));

      step = 2;
    } else if (step === 2 && res.id === 3) {
      // Verify filter completions are returned (specifically 'upcase')
      const items = res.result;
      assert.ok(items.length > 0);
      const hasUpcase = items.some((item: any) => item.label === 'upcase' && item.data === 'filter-upcase');
      assert.ok(hasUpcase, 'Expected "upcase" filter in autocomplete list');

      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
});
