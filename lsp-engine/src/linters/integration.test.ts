import { test, expect } from 'vitest';
import { startLspServer, LSPMessageReader, formatLSPMessage } from '../shared/test-utils.js';

test('Liquid computational edge cases (output type mismatch, formatter string preservation, null signature help)', () => new Promise<void>((resolve) => {
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

test('Liquid custom parseAssign tag validation and coercion', () => new Promise<void>((resolve) => {
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
            text: [
              '{% parseAssign raw_price = price %}',
              '{% assign check_type_mismatch = raw_price | plus: 10 %}',
              '{% parseAssign name = user.first_name %}',
              '{% parseAssign invalid = user.invalid_prop %}',
              '{% parseAssign filtered_name = user.first_name | upcase %}',
              '{% parseAssign invalid_filtered = user.invalid_prop | upcase %}',
              '{% parseAssign first_name = user.first_name.first_name %}',
              '{% parseAssign item_title = user.items[0].title %}'
            ].join('\n')
          }
        }
      }));
      step = 1;
    } else if (step === 1 && res.method === 'textDocument/publishDiagnostics') {
      const diagnostics = res.params.diagnostics;
      
      // 1. Verify y (raw_price) coerced from currency to number: no plus filter type warning
      const rawPriceMismatch = diagnostics.find((d: any) => d.range.start.line === 1 && d.message.includes('Type mismatch'));
      expect(rawPriceMismatch).toBeUndefined();

      // 2. Verify invalid_prop triggers diagnostic error
      const invalidPropertyError = diagnostics.find((d: any) => d.range.start.line === 3 && d.message.includes('Property "invalid_prop" does not exist'));
      expect(invalidPropertyError).toBeDefined();
      expect(invalidPropertyError.severity).toBe(1); // 1 = Error

      // 3. Verify filtered_name (valid filter chain) does not trigger error
      const filteredNameError = diagnostics.find((d: any) => d.range.start.line === 4);
      // Wait, there could be unused variable warning, check that it's only warning for unused, not property error
      if (filteredNameError) {
        expect(filteredNameError.message).not.toContain('does not exist');
      }

      // 4. Verify invalid_filtered (invalid property with filter chain) triggers error
      const invalidFilteredError = diagnostics.find((d: any) => d.range.start.line === 5 && d.message.includes('Property "invalid_prop" does not exist'));
      expect(invalidFilteredError).toBeDefined();

      // 5. Verify range highlight offset collision: first_name error starts at character 44, not 13
      const offsetCollisionError = diagnostics.find((d: any) => d.range.start.line === 6 && d.message.includes('Cannot access property "first_name"'));
      expect(offsetCollisionError).toBeDefined();
      expect(offsetCollisionError.range.start.character).toBe(44);

      // 6. Verify item_title bracket access (user.items[0].title) does not trigger property/bracket error
      const bracketAccessError = diagnostics.find((d: any) => d.range.start.line === 7 && d.message.includes('does not exist'));
      expect(bracketAccessError).toBeUndefined();

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
          price: 'currency',
          user: {
            type: 'composite',
            fields: {
              first_name: 'string',
              items: {
                type: 'composite',
                fields: {
                  title: 'string'
                }
              }
            }
          }
        }
      }
    }
  }));
}));
