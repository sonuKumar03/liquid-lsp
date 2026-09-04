import { test, expect } from 'vitest';
import {
  startLspServer,
  LSPMessageReader,
  formatLSPMessage,
} from '../shared/test-utils.js';

test('Liquid outline document symbols hierarchy', () =>
  new Promise<void>((resolve) => {
    const child = startLspServer();
    let step = 0;

    new LSPMessageReader(child.stdout!, (res) => {
      if (res.method === 'window/logMessage') return;

      if (step === 0 && res.id === 1) {
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'initialized',
            params: {},
          }),
        );
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: {
              textDocument: {
                uri: 'file:///t.liquid',
                languageId: 'liquid',
                version: 1,
                text: '{% assign x = 10 %}\n{% if x > 5 %}\n{% assign y = 20 %}\n{% endif %}',
              },
            },
          }),
        );

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/documentSymbol',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
            },
          }),
        );

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

    child.stdin?.write(
      formatLSPMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { capabilities: {} },
      }),
    );
  }));

test('Liquid document symbols for and capture blocks and precise selectionRange', () =>
  new Promise<void>((resolve) => {
    const child = startLspServer();
    let step = 0;

    new LSPMessageReader(child.stdout!, (res) => {
      if (res.method === 'window/logMessage') return;

      if (step === 0 && res.id === 1) {
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'initialized',
            params: {},
          }),
        );
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: {
              textDocument: {
                uri: 'file:///t.liquid',
                languageId: 'liquid',
                version: 1,
                text: '{% assign my_var = 123 %}\n{% for item in items %}\n{% endfor %}\n{% capture captured_var %}\n{% endcapture %}',
              },
            },
          }),
        );

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/documentSymbol',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        const symbols = res.result;
        expect(symbols.length).toBe(3);

        const symbolAssign = symbols[0];
        expect(symbolAssign.name).toBe('my_var');
        expect(symbolAssign.kind).toBe(13); // Variable
        // The selectionRange should highlight just 'my_var', which starts at line 0, col 10
        expect(symbolAssign.selectionRange.start.line).toBe(0);
        expect(symbolAssign.selectionRange.start.character).toBe(10);
        expect(symbolAssign.selectionRange.end.character).toBe(16);

        const symbolFor = symbols[1];
        expect(symbolFor.name).toBe('for item in items');
        expect(symbolFor.kind).toBe(3); // Namespace
        expect(symbolFor.children.length).toBe(1);

        const symbolForItem = symbolFor.children[0];
        expect(symbolForItem.name).toBe('item');
        expect(symbolForItem.kind).toBe(13);
        expect(symbolForItem.selectionRange.start.line).toBe(1);
        expect(symbolForItem.selectionRange.start.character).toBe(7); // offset of 'item' in '{% for item in items %}'
        expect(symbolForItem.selectionRange.end.character).toBe(11);

        const symbolCapture = symbols[2];
        expect(symbolCapture.name).toBe('capture captured_var');
        expect(symbolCapture.kind).toBe(3); // Namespace
        expect(symbolCapture.children.length).toBe(1);

        const symbolCapturedVar = symbolCapture.children[0];
        expect(symbolCapturedVar.name).toBe('captured_var');
        expect(symbolCapturedVar.kind).toBe(13);
        expect(symbolCapturedVar.selectionRange.start.line).toBe(3);
        expect(symbolCapturedVar.selectionRange.start.character).toBe(11); // offset of 'captured_var' in '{% capture captured_var %}'
        expect(symbolCapturedVar.selectionRange.end.character).toBe(23);

        child.kill('SIGINT');
        resolve();
      }
    });

    child.stdin?.write(
      formatLSPMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { capabilities: {} },
      }),
    );
  }));
