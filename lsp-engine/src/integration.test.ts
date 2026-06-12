import { test, expect } from 'vitest';
import { startLspServer, LSPMessageReader, formatLSPMessage } from './test-utils.js';

test('Liquid computational edge cases (output type mismatch, formatter string preservation, null signature help)', () => new Promise<void>((resolve) => {
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
            text: '{% assign name = "sonu" %}\n{{ name | plus: 10 }}\n{%assign  name  =  "a = b | c" %}\n{{ name | upcase: }}'
          }
        }
      }));
      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      const diagnostics = res.params.diagnostics;
      const typeMismatchWarning = diagnostics.find((d: any) => d.message.includes('Type mismatch'));
      expect(typeMismatchWarning).toBeDefined();
      expect(typeMismatchWarning.range.start.line).toBe(1);

      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/formatting',
        params: {
          textDocument: { uri: 'file:///t.liquid' },
          options: { tabSize: 2, insertSpaces: true }
        }
      }));
      step = 2;
    } else if (step === 2 && res.id === 2) {
      const edits = res.result;
      expect(edits).toBeDefined();
      expect(edits.length).toBe(1);
      const expectedText = '{% assign name = "sonu" %}\n{{ name | plus: 10 }}\n{% assign name = "a = b | c" %}\n{{ name | upcase: }}';
      expect(edits[0].newText).toBe(expectedText);

      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'textDocument/signatureHelp',
        params: {
          textDocument: { uri: 'file:///t.liquid' },
          position: { line: 3, character: 18 }
        }
      }));
      step = 3;
    } else if (step === 3 && res.id === 3) {
      expect(res.result === null || !res.result.signatures || res.result.signatures.length === 0).toBe(true);

      child.kill('SIGINT');
      resolve();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
}));
