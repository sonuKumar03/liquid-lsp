import { test, expect } from 'vitest';
import { startLspServer, LSPMessageReader, formatLSPMessage } from './test-utils.js';

test('Liquid signature help', () => new Promise<void>((resolve) => {
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
      expect(sigHelp).toBeDefined();
      expect(sigHelp.signatures.length).toBe(1);
      expect(sigHelp.signatures[0].label).toBe('truncate(length: number, truncate_string: string = "...")');
      expect(sigHelp.activeParameter).toBe(1);

      child.kill('SIGINT');
      resolve();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
}));
