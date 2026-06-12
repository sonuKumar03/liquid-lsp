import { test, expect } from 'vitest';
import { startLspServer, LSPMessageReader, formatLSPMessage } from './test-utils.js';

test('Liquid auto-complete context suggestions', () => new Promise<void>((resolve) => {
  const child = startLspServer();
  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') return;

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
      expect(items.length).toBeGreaterThan(0);
      const hasAssign = items.some((item: any) => item.label === 'assign' && item.data === 'tag-assign');
      expect(hasAssign).toBe(true);

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
      expect(items.length).toBeGreaterThan(0);
      const hasUpcase = items.some((item: any) => item.label === 'upcase' && item.data === 'filter-upcase');
      expect(hasUpcase).toBe(true);

      child.kill('SIGINT');
      resolve();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
}));

test('Liquid variable auto-completions', () => new Promise<void>((resolve) => {
  const child = startLspServer();
  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') return;

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
      expect(items.length).toBeGreaterThan(0);

      const hasUsername = items.some((item: any) => item.label === 'username' && item.kind === 6); // 6 = Variable
      const hasItem = items.some((item: any) => item.label === 'item' && item.kind === 6);

      expect(hasUsername).toBe(true);
      expect(hasItem).toBe(true);

      child.kill('SIGINT');
      resolve();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
}));
