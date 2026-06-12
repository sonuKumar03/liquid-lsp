import { test } from 'node:test';
import assert from 'node:assert';
import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to format a JSON object into a standard LSP/JSON-RPC message.
// The protocol specifies that every message must be prefixed by a "Content-Length" header
// followed by a double line ending (\r\n\r\n).
function formatLSPMessage(jsonPayload: object): string {
  const content = JSON.stringify(jsonPayload);
  return `Content-Length: ${Buffer.byteLength(content, 'utf8')}\r\n\r\n${content}`;
}

test('LSP server handles JSON-RPC initialization handshake over stdin/stdout', (t, done) => {
  // Path to the compiled main.js file
  const serverPath = path.resolve(__dirname, '../dist/main.js');

  // Spawn the LSP server as a child process. We capture standard I/O (stdin/stdout)
  // so we can read and write raw JSON-RPC messages.
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let buffer = '';

  child.stdout?.on('data', (data) => {
    buffer += data.toString();

    // Look for the separation between headers and the JSON body
    const delimiterIndex = buffer.indexOf('\r\n\r\n');
    if (delimiterIndex !== -1) {
      const headerPart = buffer.slice(0, delimiterIndex);
      const bodyPart = buffer.slice(delimiterIndex + 4);

      // Extract the Content-Length header to know how many bytes to read
      const contentLengthMatch = headerPart.match(/Content-Length:\s*(\d+)/i);
      if (contentLengthMatch && contentLengthMatch[1]) {
        const expectedLength = parseInt(contentLengthMatch[1], 10);

        // Wait until we have received the full body payload
        if (Buffer.byteLength(bodyPart, 'utf8') >= expectedLength) {
          const rawJSON = bodyPart.slice(0, expectedLength);
          const response = JSON.parse(rawJSON);

          // VERIFY THE Handshake response structure
          assert.strictEqual(response.jsonrpc, '2.0');
          assert.strictEqual(response.id, 1);
          assert.ok(response.result);
          assert.ok(response.result.capabilities);

          // Verify specific capabilities configured in main.ts
          assert.ok(response.result.capabilities.hoverProvider);
          assert.ok(response.result.capabilities.completionProvider);
          assert.strictEqual(response.result.capabilities.textDocumentSync, 2); // 2 represents Incremental synchronization

          // Clean up: terminate the child process and mark the test as done
          child.kill('SIGINT');
          done();
        }
      }
    }
  });

  // Construct the "initialize" request payload
  const initializeRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      processId: process.pid,
      rootUri: null,
      capabilities: {}
    }
  };

  // Send the request to the server's stdin
  child.stdin?.write(formatLSPMessage(initializeRequest));
});
