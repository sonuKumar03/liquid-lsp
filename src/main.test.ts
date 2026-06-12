import { test } from 'node:test';
import assert from 'node:assert';
import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Compact helper to send a JSON-RPC message over standard input
function send(child: any, msg: object) {
  const content = JSON.stringify(msg);
  child.stdin.write(`Content-Length: ${Buffer.byteLength(content, 'utf8')}\r\n\r\n${content}`);
}

test('Liquid syntax diagnostics lifecycle', (t, done) => {
  const child = fork(path.resolve(__dirname, '../dist/main.js'), ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });
  let buffer = '';

  child.stdout!.on('data', (chunk) => {
    buffer += chunk.toString();
    const parts = buffer.split('\r\n\r\n');
    if (parts.length < 2) return;

    const header = parts[0]!;
    const body = parts[1]!;
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) return;

    const expectedLength = parseInt(lengthMatch[1]!, 10);
    if (Buffer.byteLength(body, 'utf8') < expectedLength) return;

    const res = JSON.parse(body.slice(0, expectedLength));
    buffer = body.slice(expectedLength); // Reset buffer with leftover data

    if (res.id === 1) {
      // 1. Check handshake response and open a document with invalid syntax
      assert.ok(res.result.capabilities.hoverProvider);
      send(child, { jsonrpc: '2.0', method: 'initialized', params: {} });
      send(child, {
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: { textDocument: { uri: 'file:///t.liquid', languageId: 'liquid', version: 1, text: '{% if x }' } }
      });
    } else if (res.method === 'textDocument/publishDiagnostics') {
      if (res.params.diagnostics.length > 0) {
        // 2. Verify invalid syntax triggers diagnostic, then correct it
        assert.ok(res.params.diagnostics[0].message);
        assert.strictEqual(res.params.diagnostics[0].range.start.character, 0); // Highlights the unclosed tag starting at character 0
        send(child, {
          jsonrpc: '2.0',
          method: 'textDocument/didChange',
          params: { textDocument: { uri: 'file:///t.liquid', version: 2 }, contentChanges: [{ text: '{% if x %}{% endif %}' }] }
        });
      } else {
        // 3. Verify diagnostics are cleared after syntax is corrected
        assert.strictEqual(res.params.diagnostics.length, 0);
        child.kill('SIGINT');
        done();
      }
    }
  });

  // Start initialization handshake
  send(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } });
});
