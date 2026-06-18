import { test, expect } from 'vitest';
import {
  startLspServer,
  LSPMessageReader,
  formatLSPMessage,
} from '../shared/test-utils.js';

test('Liquid syntax diagnostics lifecycle', () =>
  new Promise<void>((resolve) => {
    const child = startLspServer();
    let step = 0;

    new LSPMessageReader(child.stdout!, (res) => {
      if (res.method === 'window/logMessage') {
        console.error('SERVER LOG:', res.params.message);
        return;
      }

      if (step === 0 && res.id === 1) {
        expect(res.result.capabilities.hoverProvider).toBeTruthy();
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
                text: '{% if x }',
              },
            },
          }),
        );
        step = 1;
      } else if (
        step === 1 &&
        res.method === 'textDocument/publishDiagnostics'
      ) {
        expect(res.params.diagnostics.length).toBeGreaterThan(0);
        expect(res.params.diagnostics[0].range.start.character).toBe(0);

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: {
              textDocument: { uri: 'file:///t.liquid', version: 2 },
              contentChanges: [{ text: '{% if x %}{% endif %}' }],
            },
          }),
        );
        step = 2;
      } else if (
        step === 2 &&
        res.method === 'textDocument/publishDiagnostics'
      ) {
        expect(res.params.diagnostics.length).toBe(0);
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

test('Liquid compiler diagnostics include unclosed block metadata', () =>
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
                text: '{% if true %}\nHello',
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
        const unclosedTag = diagnostics.find(
          (d: any) => d.code === 'liquid.syntax.unclosed_delimiter',
        );
        expect(unclosedTag).toBeDefined();
        expect(unclosedTag.data.tagName).toBe('if');

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

test('Liquid enhanced diagnostics (operators & conditions)', () =>
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
                text: '{% if x = 5 %}\n{% endif %}',
              },
            },
          }),
        );
        step = 1;
      } else if (
        step === 1 &&
        res.method === 'textDocument/publishDiagnostics'
      ) {
        expect(res.params.diagnostics.length).toBeGreaterThan(0);
        expect(res.params.diagnostics[0].message).toContain(
          'Assignments are not allowed inside conditional statements',
        );

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: {
              textDocument: { uri: 'file:///t.liquid', version: 2 },
              contentChanges: [{ text: '{% assign x = 1 + 2 %}' }],
            },
          }),
        );
        step = 2;
      } else if (
        step === 2 &&
        res.method === 'textDocument/publishDiagnostics'
      ) {
        expect(res.params.diagnostics.length).toBeGreaterThan(0);
        expect(res.params.diagnostics[0].message).toContain(
          'Liquid does not support inline mathematical operators',
        );

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

test('Liquid multiple syntax errors diagnostics', () =>
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
                text: '{% if x = 5 %}\n{% assign y = 1 + 2 %}',
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
        const syntaxErrors = diagnostics.filter((d: any) => d.severity === 1);
        expect(syntaxErrors.length).toBe(2);
        expect(
          diagnostics.some((d: any) =>
            d.message.includes('Assignments are not allowed'),
          ),
        ).toBe(true);
        expect(
          diagnostics.some((d: any) =>
            d.message.includes('inline mathematical operators'),
          ),
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
        params: { capabilities: {} },
      }),
    );
  }));

test('Liquid unused variables diagnostics', () =>
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
                text: '{% assign val = 10 %}\n{% assign score = 20 %}\n{{ score }}',
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
        const unusedWarnings = diagnostics.filter((d: any) =>
          d.message.includes('never read it anywhere'),
        );
        expect(unusedWarnings.length).toBe(1);
        expect(unusedWarnings[0].message).toContain('val');

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

test('Liquid enhanced diagnostics (type mismatch & redefinition)', () =>
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
                text: '{% assign x = "hello" %}\n{% assign x = 20 %}\n{% assign y = x | plus: 5 %}',
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
        const overwrittenWarning = diagnostics.find((d: any) =>
          d.message.includes('overwriting'),
        );
        expect(overwrittenWarning).toBeDefined();
        expect(overwrittenWarning.range.start.line).toBe(0);

        const typeMismatchWarning = diagnostics.find((d: any) =>
          d.message.includes('only works on'),
        );
        expect(typeMismatchWarning).toBeUndefined();

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: {
              textDocument: { uri: 'file:///t.liquid', version: 2 },
              contentChanges: [
                {
                  text: '{% assign x = "hello" %}\n{% assign y = x | plus: 5 %}',
                },
              ],
            },
          }),
        );
        step = 2;
      } else if (
        step === 2 &&
        res.method === 'textDocument/publishDiagnostics'
      ) {
        const diagnostics = res.params.diagnostics;
        const typeMismatchWarning = diagnostics.find((d: any) =>
          d.message.includes('only works on'),
        );
        expect(typeMismatchWarning).toBeDefined();
        expect(typeMismatchWarning.range.start.line).toBe(1);

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

test('Liquid schema and dropdown options validation', () =>
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
                text: '{% assign status = "Draft" %}',
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
        const dropdownWarning = diagnostics.find((d: any) =>
          d.message.includes('not one of the choices for'),
        );
        expect(dropdownWarning).toBeDefined();
        expect(dropdownWarning.message).toContain('choices');
        expect(dropdownWarning.message).toContain('Active');

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
              status: {
                type: 'dropdown',
                options: ['Active', 'Inactive'],
              },
            },
          },
        },
      }),
    );
  }));

test('Liquid invalid dropdown comparison diagnostics', () =>
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
                uri: 'file:///dropdown-compare.liquid',
                languageId: 'liquid',
                version: 1,
                text: '{% if user.status == "draft" %}{{ user.status }}{% endif %}',
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
        const dropdownWarning = diagnostics.find((d: any) =>
          d.message.includes('not a valid option for'),
        );
        expect(dropdownWarning).toBeDefined();
        expect(dropdownWarning.message).toContain('"draft"');
        expect(dropdownWarning.message).toContain('"active"');

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
                  status: {
                    type: 'dropdown',
                    options: ['active', 'inactive'],
                  },
                },
              },
            },
          },
        },
      }),
    );
  }));

test('Liquid manual syntax diagnostics (math in outputs)', () =>
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
                text: ['{{ x + 5 }}'].join('\n'),
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

        // 1. Math in outputs
        const mathError = diagnostics.find(
          (d: any) =>
            d.range.start.line === 0 &&
            d.message.includes('inline mathematical operators'),
        );
        expect(mathError).toBeDefined();

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

test('Liquid manual syntax diagnostics (unclosed curly delimiters)', () =>
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
                text: ['{{ name', '{% assign y = 10'].join('\n'),
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

        // 2. Unclosed output delimiter
        const unclosedOutput = diagnostics.find(
          (d: any) =>
            d.range.start.line === 0 && d.message.includes('not closed'),
        );
        expect(unclosedOutput).toBeDefined();

        // 3. Unclosed tag delimiter
        const unclosedTag = diagnostics.find(
          (d: any) =>
            d.range.start.line === 1 && d.message.includes('not closed'),
        );
        expect(unclosedTag).toBeDefined();

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

test('Liquid filter name syntax diagnostics', () =>
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
                  '{% assignVar name = user.first_name | "uppercase" %}',
                  '{% assignVar age = 30 | invalidFilter %}',
                  '{% assign x = "hello | world" %}',
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

        // 1. Invalid filter name syntax (expected filter name) on line 0
        const syntaxError = diagnostics.find(
          (d: any) =>
            d.range.start.line === 0 &&
            d.message.includes('Expected filter name'),
        );
        expect(syntaxError).toBeDefined();
        expect(syntaxError.severity).toBe(1); // Error

        // 2. Unknown filter warning on line 1
        const unknownFilter = diagnostics.find(
          (d: any) =>
            d.range.start.line === 1 && d.message.includes('Unknown filter'),
        );
        expect(unknownFilter).toBeDefined();
        expect(unknownFilter.severity).toBe(2); // Warning

        // 3. String literal containing pipe should NOT cause filter diagnostics on line 2
        const line2FilterDiagnostics = diagnostics.filter(
          (d: any) =>
            d.range.start.line === 2 &&
            d.message.toLowerCase().includes('filter'),
        );
        expect(line2FilterDiagnostics.length).toBe(0);

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

test('Liquid diagnostics regression test for complex conditional and assignVar/parseAssign block', () =>
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
                text: '{% if sd_effective_date and sd_term_length and sd_term_length.value and sd_term_length.type %} {% parseAssign one_day = \'{"value": 1, "type": "DAYS", "days": 1}\' %} {% assign temp_expiration = sd_effective_date | plus: sd_term_length %} {% assign sd_expiration_date = temp_expiration | minus: one_day %} {% else %} {% assign sd_expiration_date = nil %} {% endif %}',
              },
            },
          }),
        );
        step = 1;
      } else if (
        step === 1 &&
        res.method === 'textDocument/publishDiagnostics'
      ) {
        const errors = res.params.diagnostics.filter((d: any) => d.severity === 1);
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
        params: { capabilities: {} },
      }),
    );
  }));

test('Liquid assignment typo suggestion (== instead of =)', () =>
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
                text: '{% assign x == 5 %}',
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
        const typoError = diagnostics.find(
          (d: any) => d.message.includes('Did you mean "=" instead of "=="?'),
        );
        expect(typoError).toBeDefined();
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
