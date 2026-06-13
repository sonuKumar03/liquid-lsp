import { test, expect } from 'vitest';
import {
  startLspServer,
  LSPMessageReader,
  formatLSPMessage,
} from '../shared/test-utils.js';

test('Liquid hover documentation', () =>
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
                text: '{% assign x = "hello" | upcase %}',
              },
            },
          }),
        );

        // Request hover info on "assign" (character index 4)
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/hover',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 0, character: 4 },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        expect(res.result).toBeDefined();
        expect(res.result.contents).toBeDefined();
        expect(res.result.contents.kind).toBe('markdown');
        expect(res.result.contents.value).toContain('assign');

        // Request hover info on "upcase" (character index 27)
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 3,
            method: 'textDocument/hover',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 0, character: 27 },
            },
          }),
        );

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

    child.stdin?.write(
      formatLSPMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { capabilities: {} },
      }),
    );
  }));

test('Liquid hover documentation for schema variables', () =>
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
                  '{{ user.first_name }}',
                  '{{ status }}',
                  '{{ user.items[0].title }}',
                ].join('\n'),
              },
            },
          }),
        );

        // Request hover info on "user.first_name" (line 0, character 10 - hovering over "first_name")
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/hover',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 0, character: 10 },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        expect(res.result).toBeDefined();
        expect(res.result.contents).toBeDefined();
        expect(res.result.contents.value).toContain(
          '**Variable:** `user.first_name`',
        );
        expect(res.result.contents.value).toContain('**Type:** `string`');

        // Request hover info on "status" (line 1, character 5)
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 3,
            method: 'textDocument/hover',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 1, character: 5 },
            },
          }),
        );

        step = 2;
      } else if (step === 2 && res.id === 3) {
        expect(res.result).toBeDefined();
        expect(res.result.contents).toBeDefined();
        expect(res.result.contents.value).toContain('**Variable:** `status`');
        expect(res.result.contents.value).toContain(
          '**Type:** `dropdown` (Options: "Active", "Inactive")',
        );

        // Request hover info on "title" in "user.items[0].title" (line 2, character 18 - hovering over "title")
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 4,
            method: 'textDocument/hover',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 2, character: 18 },
            },
          }),
        );

        step = 3;
      } else if (step === 3 && res.id === 4) {
        expect(res.result).toBeDefined();
        expect(res.result.contents).toBeDefined();
        expect(res.result.contents.value).toContain(
          '**Variable:** `user.items[0].title`',
        );
        expect(res.result.contents.value).toContain('**Type:** `string`');

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

test('Liquid hover documentation with variable values', () =>
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
                  '{{ user.first_name }}',
                  '{{ status }}',
                ].join('\n'),
              },
            },
          }),
        );

        // Update the schema and provide context data dynamically
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'workspace/updateSchema',
            params: {
              schema: {
                status: {
                  type: 'dropdown',
                  options: ['Active', 'Inactive'],
                },
                user: {
                  type: 'composite',
                  fields: {
                    first_name: 'string',
                  },
                },
              },
              contextData: {
                status: 'Active',
                user: {
                  first_name: 'Sonu',
                },
              },
            },
          }),
        );

        // Request hover info on "user.first_name" (line 0, character 10)
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/hover',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 0, character: 10 },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        expect(res.result).toBeDefined();
        expect(res.result.contents).toBeDefined();
        expect(res.result.contents.value).toContain(
          '**Variable:** `user.first_name`',
        );
        expect(res.result.contents.value).toContain('**Type:** `string`');
        expect(res.result.contents.value).toContain('**Value:** `Sonu`');

        // Request hover info on "status" (line 1, character 5)
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 3,
            method: 'textDocument/hover',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 1, character: 5 },
            },
          }),
        );

        step = 2;
      } else if (step === 2 && res.id === 3) {
        expect(res.result).toBeDefined();
        expect(res.result.contents).toBeDefined();
        expect(res.result.contents.value).toContain('**Variable:** `status`');
        expect(res.result.contents.value).toContain('**Value:** `Active`');

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
        },
      }),
    );
  }));

test('Liquid hover documentation for local variables', () =>
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
                  '{% assignVar local_str = user.first_name %}',
                  '{{ local_str }}',
                ].join('\n'),
              },
            },
          }),
        );

        // Update the schema
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'workspace/updateSchema',
            params: {
              schema: {
                user: {
                  type: 'composite',
                  fields: {
                    first_name: 'string',
                  },
                },
              },
            },
          }),
        );

        // Request hover info on "local_str" (line 1, character 5)
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/hover',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 1, character: 5 },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        expect(res.result).toBeDefined();
        expect(res.result.contents).toBeDefined();
        expect(res.result.contents.value).toContain('**Variable:** `local_str`');
        expect(res.result.contents.value).toContain('**Type:** `string`');

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
        },
      }),
    );
  }));
