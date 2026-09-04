import { test, expect } from 'vitest';
import {
  startLspServer,
  LSPMessageReader,
  formatLSPMessage,
} from '../shared/test-utils.js';

test('Liquid computational edge cases (output type mismatch, formatter string preservation, null signature help)', () =>
  new Promise<void>((resolve) => {
    const child = startLspServer();
    let step = 0;

    new LSPMessageReader(child.stdout!, (res) => {
      if (res.method === 'window/logMessage') {
        console.error('SERVER LOG:', res.params.message);
        return;
      }

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
                text: '{% assign name = "sonu" %}\n{{ name | plus: 10 }}\n{%assign  name  =  "a = b | c" %}\n{{ name | upcase: }}',
              },
            },
          }),
        );
        step = 1;
      } else if (
        step === 1 &&
        res.method === 'textDocument/publishDiagnostics'
      ) {
        const diagnostics = res.params.diagnostics;
        const typeMismatchWarning = diagnostics.find((d: any) =>
          d.message.includes('only works on'),
        );
        expect(typeMismatchWarning).toBeDefined();
        expect(typeMismatchWarning.range.start.line).toBe(1);

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/formatting',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              options: { tabSize: 2, insertSpaces: true },
            },
          }),
        );
        step = 2;
      } else if (step === 2 && res.id === 2) {
        const edits = res.result;
        expect(edits).toBeDefined();
        expect(edits.length).toBe(1);
        const expectedText =
          '{% assign name = "sonu" %}\n{{ name | plus: 10 }}\n{% assign name = "a = b | c" %}\n{{ name | upcase: }}';
        expect(edits[0].newText).toBe(expectedText);

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 3,
            method: 'textDocument/signatureHelp',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 3, character: 18 },
            },
          }),
        );
        step = 3;
      } else if (step === 3 && res.id === 3) {
        expect(
          res.result === null ||
            !res.result.signatures ||
            res.result.signatures.length === 0,
        ).toBe(true);

        child.kill('SIGINT');
        resolve();
      }
    });

    child.stdin?.write(
      formatLSPMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    );
  }));

test('Liquid custom parseAssign tag validation and coercion', () =>
  new Promise<void>((resolve) => {
    const child = startLspServer();
    let step = 0;

    new LSPMessageReader(child.stdout!, (res) => {
      if (res.method === 'window/logMessage') {
        console.error('SERVER LOG:', res.params.message);
        return;
      }

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
                text: [
                  '{% parseAssign raw_price = price %}',
                  '{% assign check_type_mismatch = raw_price | plus: 10 %}',
                  '{% parseAssign name = user.first_name %}',
                  '{% parseAssign invalid = user.invalid_prop %}',
                  '{% parseAssign filtered_name = user.first_name | upcase %}',
                  '{% parseAssign invalid_filtered = user.invalid_prop | upcase %}',
                  '{% parseAssign first_name = user.first_name.first_name %}',
                  '{% parseAssign item_title = user.items[0].title %}',
                ].join('\n'),
              },
            },
          }),
        );
        step = 1;
      } else if (
        step === 1 &&
        res.method === 'textDocument/publishDiagnostics'
      ) {
        const diagnostics = res.params.diagnostics;

        // 1. Verify y (raw_price) coerced from currency to number: no plus filter type warning
        const rawPriceMismatch = diagnostics.find(
          (d: any) =>
            d.range.start.line === 1 && d.message.includes('only works on'),
        );
        expect(rawPriceMismatch).toBeUndefined();

        // 2. Verify invalid_prop triggers diagnostic error
        const invalidPropertyError = diagnostics.find(
          (d: any) =>
            d.range.start.line === 3 &&
            d.message.includes('doesn\'t have a field called "invalid_prop"'),
        );
        expect(invalidPropertyError).toBeDefined();
        expect(invalidPropertyError.severity).toBe(1); // 1 = Error

        // 3. Verify filtered_name (valid filter chain) does not trigger error
        const filteredNameError = diagnostics.find(
          (d: any) => d.range.start.line === 4,
        );
        // Wait, there could be unused variable warning, check that it's only warning for unused, not property error
        if (filteredNameError) {
          expect(filteredNameError.message).not.toContain(
            "doesn't have a field called",
          );
        }

        // 4. Verify invalid_filtered (invalid property with filter chain) triggers error
        const invalidFilteredError = diagnostics.find(
          (d: any) =>
            d.range.start.line === 5 &&
            d.message.includes('doesn\'t have a field called "invalid_prop"'),
        );
        expect(invalidFilteredError).toBeDefined();

        // 5. Verify range highlight offset collision: first_name error starts at character 44, not 13
        const offsetCollisionError = diagnostics.find(
          (d: any) =>
            d.range.start.line === 6 &&
            d.message.includes('You can\'t access "first_name"'),
        );
        expect(offsetCollisionError).toBeDefined();
        expect(offsetCollisionError.range.start.character).toBe(44);

        // 6. Verify item_title bracket access (user.items[0].title) does not trigger property/bracket error
        const bracketAccessError = diagnostics.find(
          (d: any) =>
            d.range.start.line === 7 &&
            d.message.includes("doesn't have a field called"),
        );
        expect(bracketAccessError).toBeUndefined();

        child.kill('SIGINT');
        resolve();
      }
    });

    child.stdin?.write(
      formatLSPMessage({
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
                      title: 'string',
                    },
                  },
                },
              },
            },
          },
        },
      }),
    );
  }));

test('Liquid computation filters render cleanly for legal-tech totals', () =>
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
                text: [
                  '{% assign invoice_total = 1500.5 %}',
                  '{% assign term_months = 12 %}',
                  '{% assign monthly_payment = invoice_total | divided_by: term_months %}',
                  '{% assign line_items_total = sd_line_items | sumArray: "price" %}',
                  'Monthly Payment: {{ monthly_payment | toCurrency: "USD" }}',
                  'Line Items Total: {{ line_items_total | toCurrency: "USD" }}',
                  'Invoice Total: {{ invoice_total | toCurrency: "USD" }}',
                  'Term Length: {{ term_months | toDuration: "MONTHS" }}',
                ].join('\n'),
              },
            },
          }),
        );
        step = 1;
      } else if (
        step === 1 &&
        res.method === 'textDocument/publishDiagnostics'
      ) {
        const diagnostics = res.params.diagnostics;
        expect(diagnostics.length).toBe(0);

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/hover',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 4, character: 45 },
            },
          }),
        );
        step = 2;
      } else if (step === 2 && res.id === 2) {
        expect(res.result).toBeDefined();

        child.kill('SIGINT');
        resolve();
      }
    });

    child.stdin?.write(
      formatLSPMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          capabilities: {},
          initializationOptions: {
            schema: {
              sd_line_items: {
                type: 'composite',
                fields: {
                  price: 'number',
                },
              },
            },
          },
        },
      }),
    );
  }));

test('Liquid SpotDraft-specific custom filters and assignVar linter validation', () =>
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
                text: [
                  '{% assignVar val_unused = user.first_name %}',
                  '{% assignVar val_used = user.first_name %}',
                  '{{ val_used | toCurrency: "USD" }}',
                  '{{ user.items | sumArray: "title" }}',
                  '{{ 10 | toDuration: "DAYS" }}',
                ].join('\n'),
              },
            },
          }),
        );
        step = 1;
      } else if (
        step === 1 &&
        res.method === 'textDocument/publishDiagnostics'
      ) {
        const diagnostics = res.params.diagnostics;

        // 1. Verify val_unused triggers unused warning
        const unusedWarning = diagnostics.find(
          (d: any) =>
            d.message.includes('never read it anywhere') &&
            d.message.includes('val_unused'),
        );
        expect(unusedWarning).toBeDefined();

        // 2. Verify val_used does not trigger unused warning
        const usedWarning = diagnostics.find(
          (d: any) =>
            d.message.includes('never read it anywhere') &&
            d.message.includes('val_used'),
        );
        expect(usedWarning).toBeUndefined();

        // 3. Verify no "Unknown filter" diagnostics are emitted for SpotDraft custom filters
        const unknownFilterWarnings = diagnostics.filter((d: any) =>
          d.message.includes('Unknown filter'),
        );
        expect(unknownFilterWarnings.length).toBe(0);

        // 4. Verify no syntax errors are present
        const errors = diagnostics.filter((d: any) => d.severity === 1);
        expect(errors.length).toBe(0);

        child.kill('SIGINT');
        resolve();
      }
    });

    child.stdin?.write(
      formatLSPMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          capabilities: {},
          initializationOptions: {
            schema: {
              user: {
                type: 'composite',
                fields: {
                  first_name: 'string',
                  items: {
                    type: 'composite',
                    fields: {
                      title: 'string',
                    },
                  },
                },
              },
            },
          },
        },
      }),
    );
  }));
