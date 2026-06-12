import { test, expect } from 'vitest';
import { startLspServer, LSPMessageReader, formatLSPMessage } from '../shared/test-utils.js';

test('Liquid Code Actions Quick Fix (unclosed tag)', () => new Promise<void>((resolve) => {
  const child = startLspServer();
  let step = 0;
  let diagnostic: any = null;

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
            text: '{% if true %}\nHello'
          }
        }
      }));
      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      expect(res.params.diagnostics.length).toBeGreaterThan(0);
      diagnostic = res.params.diagnostics[0];

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
      expect(actions.length).toBeGreaterThan(0);

      const fixAction = actions.find((a: any) => a.title.includes('endif'));
      expect(fixAction).toBeDefined();
      expect(fixAction.kind).toBe('quickfix');
      expect(fixAction.edit.changes['file:///t.liquid']).toBeDefined();

      const editChange = fixAction.edit.changes['file:///t.liquid'][0];
      expect(editChange.newText).toBe('\n{% endif %}');

      child.kill('SIGINT');
      resolve();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
}));

test('Liquid spelling correction for unknown filters', () => new Promise<void>((resolve) => {
  const child = startLspServer();
  let step = 0;
  let diagnostic: any = null;

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
            text: '{{ name | upcsae }}'
          }
        }
      }));
      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      const diagnostics = res.params.diagnostics;
      expect(diagnostics.length).toBe(1);

      diagnostic = diagnostics[0];
      expect(diagnostic.severity).toBe(2); // 2 = Warning
      expect(diagnostic.message).toContain('Unknown filter "upcsae"');
      expect(diagnostic.message).toContain('Did you mean "upcase"?');

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
      expect(actions.length).toBeGreaterThan(0);

      const spellAction = actions.find((a: any) => a.title.includes('Change to "upcase"'));
      expect(spellAction).toBeDefined();
      expect(spellAction.kind).toBe('quickfix');

      const editChange = spellAction.edit.changes['file:///t.liquid'][0];
      expect(editChange.newText).toBe('upcase');
      expect(editChange.range.start.character).toBe(10);
      expect(editChange.range.end.character).toBe(16);

      child.kill('SIGINT');
      resolve();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
}));

test('Liquid inline math conversion code action', () => new Promise<void>((resolve) => {
  const child = startLspServer();
  let step = 0;
  let diagnostic: any = null;

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
            text: '{% assign score = score + 5 %}'
          }
        }
      }));
      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      const diagnostics = res.params.diagnostics;
      expect(diagnostics.length).toBeGreaterThan(0);

      diagnostic = diagnostics.find((d: any) => d.message.includes('mathematical operators'));
      expect(diagnostic).toBeDefined();

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
      expect(actions.length).toBeGreaterThan(0);

      const mathAction = actions.find((a: any) => a.title.includes('Convert inline math'));
      expect(mathAction).toBeDefined();
      expect(mathAction.kind).toBe('quickfix');

      const editChange = mathAction.edit.changes['file:///t.liquid'][0];
      expect(editChange.newText).toBe('{% assign score = score | plus: 5 %}');

      child.kill('SIGINT');
      resolve();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
}));
