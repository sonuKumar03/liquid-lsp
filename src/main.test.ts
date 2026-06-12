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
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
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
      const items = res.result;
      assert.ok(items.length > 0);
      const hasAssign = items.some((item: any) => item.label === 'assign' && item.data === 'tag-assign');
      assert.ok(hasAssign, 'Expected "assign" tag in autocomplete list');

      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: 'file:///t.liquid', version: 2 },
          contentChanges: [{ text: '{{ name | up' }]
        }
      }));

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

test('Liquid hover documentation', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///t.liquid',
            languageId: 'liquid',
            version: 1,
            text: '{% assign x = "hello" | upcase %}'
          }
        }
      }));

      // Request hover info on "assign" (character index 4)
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/hover',
        params: {
          textDocument: { uri: 'file:///t.liquid' },
          position: { line: 0, character: 4 }
        }
      }));

      step = 1;
    } else if (step === 1 && res.id === 2) {
      // Assert we got assign tag documentation back
      assert.ok(res.result);
      assert.ok(res.result.contents);
      assert.strictEqual(res.result.contents.kind, 'markdown');
      assert.ok(res.result.contents.value.includes('assign'));

      // Request hover info on "upcase" (character index 27)
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'textDocument/hover',
        params: {
          textDocument: { uri: 'file:///t.liquid' },
          position: { line: 0, character: 27 }
        }
      }));

      step = 2;
    } else if (step === 2 && res.id === 3) {
      // Assert we got upcase filter documentation back
      assert.ok(res.result);
      assert.ok(res.result.contents);
      assert.strictEqual(res.result.contents.kind, 'markdown');
      assert.ok(res.result.contents.value.includes('upcase'));

      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
});

test('Liquid variable auto-completions', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///t.liquid',
            languageId: 'liquid',
            version: 1,
            text: '{% assign username = "Sonu" %}\n{% for item in items %}{% endfor %}\n{{ user'
          }
        }
      }));

      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/completion',
        params: {
          textDocument: { uri: 'file:///t.liquid' },
          position: { line: 2, character: 7 }
        }
      }));

      step = 1;
    } else if (step === 1 && res.id === 2) {
      const items = res.result;
      assert.ok(items.length > 0);

      const hasUsername = items.some((item: any) => item.label === 'username' && item.kind === 6); // 6 = Variable
      const hasItem = items.some((item: any) => item.label === 'item' && item.kind === 6);

      assert.ok(hasUsername, 'Expected "username" in variable suggestions');
      assert.ok(hasItem, 'Expected "item" in variable suggestions');

      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
});

test('Liquid auto-close block tags', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      
      // Open a document containing a completed opening "for" tag
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///t.liquid',
            languageId: 'liquid',
            version: 1,
            text: '{% for item in items %}'
          }
        }
      }));

      // Send onTypeFormatting request right after the "%}" (line 0, character 24)
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/onTypeFormatting',
        params: {
          textDocument: { uri: 'file:///t.liquid' },
          position: { line: 0, character: 24 },
          ch: '}',
          options: { tabSize: 2, insertSpaces: true }
        }
      }));

      step = 1;
    } else if (step === 1 && res.id === 2) {
      const edits = res.result;
      assert.ok(edits);
      assert.strictEqual(edits.length, 1);
      assert.strictEqual(edits[0].newText, '\n\n{% endfor %}');
      assert.strictEqual(edits[0].range.start.line, 0);
      assert.strictEqual(edits[0].range.start.character, 24);

      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
});

test('Liquid Go to Definition', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///t.liquid',
            languageId: 'liquid',
            version: 1,
            text: '{% assign username = "Sonu" %}\n{{ username }}'
          }
        }
      }));

      // Request definition of username on line 1 (character index 3)
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/definition',
        params: {
          textDocument: { uri: 'file:///t.liquid' },
          position: { line: 1, character: 3 }
        }
      }));

      step = 1;
    } else if (step === 1 && res.id === 2) {
      const location = res.result;
      assert.ok(location);
      assert.strictEqual(location.uri, 'file:///t.liquid');
      // Declaration range for username: {% assign username = ... %}
      // username is 8 characters long, starting at index 10 in line 0: '{% assign ' -> 10
      assert.strictEqual(location.range.start.line, 0);
      assert.strictEqual(location.range.start.character, 10);
      assert.strictEqual(location.range.end.line, 0);
      assert.strictEqual(location.range.end.character, 18);

      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
});

test('Liquid Code Actions Quick Fix', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;
  let diagnostic: any = null;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      
      // Open unclosed tag to trigger diagnostic
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///t.liquid',
            languageId: 'liquid',
            version: 1,
            text: '{% if true %}\nHello'
          }
        }
      }));

      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      assert.ok(res.params.diagnostics.length > 0);
      diagnostic = res.params.diagnostics[0];

      // Request code actions at the unclosed tag diagnostic range
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/codeAction',
        params: {
          textDocument: { uri: 'file:///t.liquid' },
          range: diagnostic.range,
          context: { diagnostics: [diagnostic] }
        }
      }));

      step = 2;
    } else if (step === 2 && res.id === 2) {
      const actions = res.result;
      assert.ok(actions && actions.length > 0);
      
      const fixAction = actions.find((a: any) => a.title.includes('endif'));
      assert.ok(fixAction);
      assert.strictEqual(fixAction.kind, 'quickfix');
      assert.ok(fixAction.edit.changes['file:///t.liquid']);

      const editChange = fixAction.edit.changes['file:///t.liquid'][0];
      assert.strictEqual(editChange.newText, '\n{% endif %}');

      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
});

test('Liquid enhanced diagnostics (operators & conditions)', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      
      // Open file with single equal inside conditional statement
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///t.liquid',
            languageId: 'liquid',
            version: 1,
            text: '{% if x = 5 %}\n{% endif %}'
          }
        }
      }));

      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      assert.ok(res.params.diagnostics.length > 0);
      assert.ok(res.params.diagnostics[0].message.includes('Assignments are not allowed inside conditional statements'));

      // Change file to use inline math operators in assign
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: 'file:///t.liquid', version: 2 },
          contentChanges: [{ text: '{% assign x = 1 + 2 %}' }]
        }
      }));

      step = 2;
    } else if (step === 2 && res.method === 'textDocument/publishDiagnostics') {
      assert.ok(res.params.diagnostics.length > 0);
      assert.ok(res.params.diagnostics[0].message.includes('Liquid does not support inline mathematical operators'));

      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
});

test('Liquid multiple syntax errors diagnostics', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///t.liquid',
            languageId: 'liquid',
            version: 1,
            text: '{% if x = 5 %}\n{% assign y = 1 + 2 %}'
          }
        }
      }));

      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      const diagnostics = res.params.diagnostics;
      const syntaxErrors = diagnostics.filter((d: any) => d.severity === 1);
      assert.strictEqual(syntaxErrors.length, 2);
      assert.ok(diagnostics.some((d: any) => d.message.includes('Assignments are not allowed')));
      assert.ok(diagnostics.some((d: any) => d.message.includes('inline mathematical operators')));

      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
});

test('Liquid spelling correction for unknown filters', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;
  let diagnostic: any = null;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///t.liquid',
            languageId: 'liquid',
            version: 1,
            text: '{{ name | upcsae }}'
          }
        }
      }));

      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      const diagnostics = res.params.diagnostics;
      assert.strictEqual(diagnostics.length, 1);
      
      diagnostic = diagnostics[0];
      assert.strictEqual(diagnostic.severity, 2); // 2 = Warning
      assert.ok(diagnostic.message.includes('Unknown filter "upcsae"'));
      assert.ok(diagnostic.message.includes('Did you mean "upcase"?'));

      // Request Code Action for this diagnostic
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/codeAction',
        params: {
          textDocument: { uri: 'file:///t.liquid' },
          range: diagnostic.range,
          context: { diagnostics: [diagnostic] }
        }
      }));

      step = 2;
    } else if (step === 2 && res.id === 2) {
      const actions = res.result;
      assert.ok(actions && actions.length > 0);

      const spellAction = actions.find((a: any) => a.title.includes('Change to "upcase"'));
      assert.ok(spellAction);
      assert.strictEqual(spellAction.kind, 'quickfix');

      const editChange = spellAction.edit.changes['file:///t.liquid'][0];
      assert.strictEqual(editChange.newText, 'upcase');
      assert.strictEqual(editChange.range.start.character, 10);
      assert.strictEqual(editChange.range.end.character, 16);

      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
});

test('Liquid inline math conversion code action', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;
  let diagnostic: any = null;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///t.liquid',
            languageId: 'liquid',
            version: 1,
            text: '{% assign score = score + 5 %}'
          }
        }
      }));

      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      const diagnostics = res.params.diagnostics;
      assert.ok(diagnostics.length > 0);
      
      // Find the mathematical operator warning diagnostic
      diagnostic = diagnostics.find((d: any) => d.message.includes('mathematical operators'));
      assert.ok(diagnostic);

      // Request Code Action for this diagnostic
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/codeAction',
        params: {
          textDocument: { uri: 'file:///t.liquid' },
          range: diagnostic.range,
          context: { diagnostics: [diagnostic] }
        }
      }));

      step = 2;
    } else if (step === 2 && res.id === 2) {
      const actions = res.result;
      assert.ok(actions && actions.length > 0);

      const mathAction = actions.find((a: any) => a.title.includes('Convert inline math'));
      assert.ok(mathAction);
      assert.strictEqual(mathAction.kind, 'quickfix');

      const editChange = mathAction.edit.changes['file:///t.liquid'][0];
      // Expect full line conversion from score + 5 to score | plus: 5
      assert.strictEqual(editChange.newText, '{% assign score = score | plus: 5 %}');

      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
});

test('Liquid unused variables diagnostics', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///t.liquid',
            languageId: 'liquid',
            version: 1,
            text: '{% assign val = 10 %}\n{% assign score = 20 %}\n{{ score }}'
          }
        }
      }));

      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      const diagnostics = res.params.diagnostics;
      // Should flag warning for "val" (unused) but not for "score" (used)
      const unusedWarnings = diagnostics.filter((d: any) => d.message.includes('declared but its value is never read'));
      assert.strictEqual(unusedWarnings.length, 1);
      assert.ok(unusedWarnings[0].message.includes('val'));

      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
});

test('Liquid outline document symbols hierarchy', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///t.liquid',
            languageId: 'liquid',
            version: 1,
            text: '{% assign x = 10 %}\n{% if x > 5 %}\n{% assign y = 20 %}\n{% endif %}'
          }
        }
      }));

      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/documentSymbol',
        params: {
          textDocument: { uri: 'file:///t.liquid' }
        }
      }));

      step = 1;
    } else if (step === 1 && res.id === 2) {
      const symbols = res.result;
      assert.strictEqual(symbols.length, 2);

      const symbolX = symbols[0];
      assert.strictEqual(symbolX.name, 'x');
      assert.strictEqual(symbolX.kind, 13); // 13 = Variable

      const symbolIf = symbols[1];
      assert.strictEqual(symbolIf.name, 'if x > 5');
      assert.strictEqual(symbolIf.kind, 3); // 3 = Namespace
      assert.ok(symbolIf.children && symbolIf.children.length === 1);

      const symbolY = symbolIf.children[0];
      assert.strictEqual(symbolY.name, 'y');
      assert.strictEqual(symbolY.kind, 13);

      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
});

test('Liquid enhanced diagnostics (type mismatch & redefinition)', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///t.liquid',
            languageId: 'liquid',
            version: 1,
            text: '{% assign x = "hello" %}\n{% assign x = 20 %}\n{% assign y = x | plus: 5 %}'
          }
        }
      }));
      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      const diagnostics = res.params.diagnostics;
      
      const overwrittenWarning = diagnostics.find((d: any) => d.message.includes('overwritten'));
      assert.ok(overwrittenWarning, 'Expected overwritten warning');
      assert.strictEqual(overwrittenWarning.range.start.line, 0);

      const typeMismatchWarning = diagnostics.find((d: any) => d.message.includes('Type mismatch'));
      assert.ok(!typeMismatchWarning, 'Expected no type mismatch warnings since x was overwritten with a number');

      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: 'file:///t.liquid', version: 2 },
          contentChanges: [{ text: '{% assign x = "hello" %}\n{% assign y = x | plus: 5 %}' }]
        }
      }));
      step = 2;
    } else if (step === 2 && res.method === 'textDocument/publishDiagnostics') {
      const diagnostics = res.params.diagnostics;
      
      const typeMismatchWarning = diagnostics.find((d: any) => d.message.includes('Type mismatch'));
      assert.ok(typeMismatchWarning, 'Expected type mismatch warning');
      assert.strictEqual(typeMismatchWarning.range.start.line, 1);

      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
});

test('Liquid signature help', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///t.liquid',
            languageId: 'liquid',
            version: 1,
            text: '{{ name | truncate: 10, '
          }
        }
      }));

      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/signatureHelp',
        params: {
          textDocument: { uri: 'file:///t.liquid' },
          position: { line: 0, character: 24 }
        }
      }));

      step = 1;
    } else if (step === 1 && res.id === 2) {
      const sigHelp = res.result;
      assert.ok(sigHelp);
      assert.strictEqual(sigHelp.signatures.length, 1);
      assert.strictEqual(sigHelp.signatures[0].label, 'truncate(length: number, truncate_string: string = "...")');
      assert.strictEqual(sigHelp.activeParameter, 1);

      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
});

test('Liquid document formatting', (t, done) => {
  const serverPath = path.resolve(__dirname, '../dist/main.js');
  const child = fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.log('    [Server Log]', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///t.liquid',
            languageId: 'liquid',
            version: 1,
            text: '{%assign  x=10%}\n{{name|upcase}}'
          }
        }
      }));

      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/formatting',
        params: {
          textDocument: { uri: 'file:///t.liquid' },
          options: { tabSize: 2, insertSpaces: true }
        }
      }));

      step = 1;
    } else if (step === 1 && res.id === 2) {
      const edits = res.result;
      assert.ok(edits && edits.length === 1);
      assert.strictEqual(edits[0].newText, '{% assign x = 10 %}\n{{ name | upcase }}');

      child.kill('SIGINT');
      done();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
});

