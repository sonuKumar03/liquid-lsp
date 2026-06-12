import { test, expect } from 'vitest';
import { startLspServer, LSPMessageReader, formatLSPMessage } from './test-utils.js';

test('Liquid hover documentation', () => new Promise<void>((resolve) => {
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
      expect(res.result).toBeDefined();
      expect(res.result.contents).toBeDefined();
      expect(res.result.contents.kind).toBe('markdown');
      expect(res.result.contents.value).toContain('assign');

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
      expect(res.result).toBeDefined();
      expect(res.result.contents).toBeDefined();
      expect(res.result.contents.kind).toBe('markdown');
      expect(res.result.contents.value).toContain('upcase');

      child.kill('SIGINT');
      resolve();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
}));
