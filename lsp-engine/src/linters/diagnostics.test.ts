import { test, expect } from 'vitest';
import { startLspServer, LSPMessageReader, formatLSPMessage } from '../shared/test-utils.js';

test('Liquid syntax diagnostics lifecycle', () => new Promise<void>((resolve) => {
  const child = startLspServer();
  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.error('SERVER LOG:', res.params.message);
      return;
    }

    if (step === 0 && res.id === 1) {
      expect(res.result.capabilities.hoverProvider).toBeTruthy();
      child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: { textDocument: { uri: 'file:///t.liquid', languageId: 'liquid', version: 1, text: '{% if x }' } }
      }));
      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      expect(res.params.diagnostics.length).toBeGreaterThan(0);
      expect(res.params.diagnostics[0].range.start.character).toBe(0);

      child.stdin?.write(formatLSPMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: { textDocument: { uri: 'file:///t.liquid', version: 2 }, contentChanges: [{ text: '{% if x %}{% endif %}' }] }
      }));
      step = 2;
    } else if (step === 2 && res.method === 'textDocument/publishDiagnostics') {
      expect(res.params.diagnostics.length).toBe(0);
      child.kill('SIGINT');
      resolve();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
}));

test('Liquid enhanced diagnostics (operators & conditions)', () => new Promise<void>((resolve) => {
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
            text: '{% if x = 5 %}\n{% endif %}'
          }
        }
      }));
      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      expect(res.params.diagnostics.length).toBeGreaterThan(0);
      expect(res.params.diagnostics[0].message).toContain('Assignments are not allowed inside conditional statements');

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
      expect(res.params.diagnostics.length).toBeGreaterThan(0);
      expect(res.params.diagnostics[0].message).toContain('Liquid does not support inline mathematical operators');

      child.kill('SIGINT');
      resolve();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
}));

test('Liquid multiple syntax errors diagnostics', () => new Promise<void>((resolve) => {
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
            text: '{% if x = 5 %}\n{% assign y = 1 + 2 %}'
          }
        }
      }));
      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      const diagnostics = res.params.diagnostics;
      const syntaxErrors = diagnostics.filter((d: any) => d.severity === 1);
      expect(syntaxErrors.length).toBe(2);
      expect(diagnostics.some((d: any) => d.message.includes('Assignments are not allowed'))).toBe(true);
      expect(diagnostics.some((d: any) => d.message.includes('inline mathematical operators'))).toBe(true);

      child.kill('SIGINT');
      resolve();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
}));

test('Liquid unused variables diagnostics', () => new Promise<void>((resolve) => {
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
            text: '{% assign val = 10 %}\n{% assign score = 20 %}\n{{ score }}'
          }
        }
      }));
      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      const diagnostics = res.params.diagnostics;
      const unusedWarnings = diagnostics.filter((d: any) => d.message.includes('declared but its value is never read'));
      expect(unusedWarnings.length).toBe(1);
      expect(unusedWarnings[0].message).toContain('val');

      child.kill('SIGINT');
      resolve();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
}));

test('Liquid enhanced diagnostics (type mismatch & redefinition)', () => new Promise<void>((resolve) => {
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
            text: '{% assign x = "hello" %}\n{% assign x = 20 %}\n{% assign y = x | plus: 5 %}'
          }
        }
      }));
      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      const diagnostics = res.params.diagnostics;
      const overwrittenWarning = diagnostics.find((d: any) => d.message.includes('overwritten'));
      expect(overwrittenWarning).toBeDefined();
      expect(overwrittenWarning.range.start.line).toBe(0);

      const typeMismatchWarning = diagnostics.find((d: any) => d.message.includes('Type mismatch'));
      expect(typeMismatchWarning).toBeUndefined();

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
      expect(typeMismatchWarning).toBeDefined();
      expect(typeMismatchWarning.range.start.line).toBe(1);

      child.kill('SIGINT');
      resolve();
    }
  });

  child.stdin?.write(formatLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
}));

test('Liquid schema and dropdown options validation', () => new Promise<void>((resolve) => {
  const child = startLspServer();
  let step = 0;

  new LSPMessageReader(child.stdout!, (res) => {
    if (res.method === 'window/logMessage') {
      console.error('SERVER LOG:', res.params.message);
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
            text: '{% assign status = "Draft" %}'
          }
        }
      }));
      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      const diagnostics = res.params.diagnostics;
      const dropdownWarning = diagnostics.find((d: any) => d.message.includes('not a valid option for dropdown'));
      expect(dropdownWarning).toBeDefined();
      expect(dropdownWarning.message).toContain('valid option');
      expect(dropdownWarning.message).toContain('Active');

      child.kill('SIGINT');
      resolve();
    }
  });

  child.stdin?.write(formatLSPMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      capabilities: {},
      initializationOptions: {
        schema: {
          status: {
            type: 'dropdown',
            options: ['Active', 'Inactive']
          }
        }
      }
    }
  }));
}));
