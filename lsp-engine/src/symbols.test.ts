import { test, expect } from 'vitest';
import { startLspServer, LSPMessageReader, formatLSPMessage } from './test-utils.js';

test('Liquid outline document symbols hierarchy', () => new Promise<void>((resolve) => {
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
      expect(symbols.length).toBe(2);

      const symbolX = symbols[0];
      expect(symbolX.name).toBe('x');
      expect(symbolX.kind).toBe(13); // 13 = Variable

      const symbolIf = symbols[1];
      expect(symbolIf.name).toBe('if x > 5');
      expect(symbolIf.kind).toBe(3); // 3 = Namespace
      expect(symbolIf.children).toBeDefined();
      expect(symbolIf.children.length).toBe(1);

      const symbolY = symbolIf.children[0];
      expect(symbolY.name).toBe('y');
      expect(symbolY.kind).toBe(13);

      child.kill('SIGINT');
      resolve();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
}));
