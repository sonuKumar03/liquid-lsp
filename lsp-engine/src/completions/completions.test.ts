import { test, expect } from 'vitest';
import {
  startLspServer,
  LSPMessageReader,
  formatLSPMessage,
} from '../shared/test-utils.js';

test('Liquid auto-complete context suggestions', () =>
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
                text: '{% ass',
              },
            },
          }),
        );

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/completion',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 0, character: 6 },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        const items = res.result;
        expect(items.length).toBeGreaterThan(0);
        const hasAssign = items.some(
          (item: any) => item.label === 'assign' && item.data === 'tag-assign',
        );
        expect(hasAssign).toBe(true);

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: {
              textDocument: { uri: 'file:///t.liquid', version: 2 },
              contentChanges: [{ text: '{{ name | up' }],
            },
          }),
        );

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 3,
            method: 'textDocument/completion',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 0, character: 12 },
            },
          }),
        );

        step = 2;
      } else if (step === 2 && res.id === 3) {
        const items = res.result;
        expect(items.length).toBeGreaterThan(0);
        const hasUpcase = items.some(
          (item: any) =>
            item.label === 'upcase' && item.data === 'filter-upcase',
        );
        expect(hasUpcase).toBe(true);

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

test('Liquid variable auto-completions', () =>
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
                text: '{% assign username = "Sonu" %}\n{% for item in items %}{% endfor %}\n{{ user',
              },
            },
          }),
        );

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/completion',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 2, character: 7 },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        const items = res.result;
        expect(items.length).toBeGreaterThan(0);

        const hasUsername = items.some(
          (item: any) => item.label === 'username' && item.kind === 6,
        ); // 6 = Variable
        const hasItem = items.some(
          (item: any) => item.label === 'item' && item.kind === 6,
        );

        expect(hasUsername).toBe(true);
        expect(hasItem).toBe(true);

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

test('Liquid schema variable and property dot-completions', () =>
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
                text: '{{ user.\n{{ ',
              },
            },
          }),
        );

        // 1. Trigger dot completions on "user." (line 0, character 8)
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/completion',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 0, character: 8 },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        const items = res.result;
        expect(items.length).toBeGreaterThan(0);
        // Verify that fields of composite type 'user' are returned
        const hasFirstName = items.some(
          (item: any) => item.label === 'first_name',
        );
        expect(hasFirstName).toBe(true);

        // 2. Trigger variable completions in output block (line 1, character 3)
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 3,
            method: 'textDocument/completion',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 1, character: 3 },
            },
          }),
        );

        step = 2;
      } else if (step === 2 && res.id === 3) {
        const items = res.result;
        expect(items.length).toBeGreaterThan(0);
        // Verify that top-level schema variables are suggested
        const hasUser = items.some((item: any) => item.label === 'user');
        const hasStatus = items.some((item: any) => item.label === 'status');
        expect(hasUser).toBe(true);
        expect(hasStatus).toBe(true);

        child.kill('SIGINT');
        resolve();
      }
    });

    // Initialize with initializationOptions schema
    child.stdin?.write(
      formatLSPMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          capabilities: {},
          initializationOptions: {
            schema: {
              status: { type: 'string' },
              user: {
                type: 'composite',
                fields: {
                  first_name: { type: 'string' },
                  last_name: { type: 'string' },
                },
              },
            },
          },
        },
      }),
    );
  }));

test('Liquid typed-pipe filter auto-completions', () =>
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
                text: '{% assignVar local_str = user.first_name %}\n{{ local_str | \n{{ user.created_at | \n{{ 42 | ',
              },
            },
          }),
        );

        // 1. Trigger filter completions on "local_str | " (line 1, character 14) -> Should suggest string filters but not abs
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/completion',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 1, character: 14 },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        const items = res.result;
        expect(items.length).toBeGreaterThan(0);
        const hasUpcase = items.some((item: any) => item.label === 'upcase');
        const hasAbs = items.some((item: any) => item.label === 'abs');
        const hasDate = items.some((item: any) => item.label === 'date');
        expect(hasUpcase).toBe(true);
        expect(hasAbs).toBe(false);
        expect(hasDate).toBe(false);

        // 2. Trigger filter completions on "user.created_at | " (line 2, character 21) -> Should suggest date filters but not upcase or abs
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 3,
            method: 'textDocument/completion',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 2, character: 21 },
            },
          }),
        );

        step = 2;
      } else if (step === 2 && res.id === 3) {
        const items = res.result;
        expect(items.length).toBeGreaterThan(0);
        const hasDate = items.some((item: any) => item.label === 'date');
        const hasUpcase = items.some((item: any) => item.label === 'upcase');
        const hasAbs = items.some((item: any) => item.label === 'abs');
        expect(hasDate).toBe(true);
        expect(hasUpcase).toBe(false);
        expect(hasAbs).toBe(false);

        // 3. Trigger filter completions on "42 | " (line 3, character 8) -> Should suggest number filters but not date
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 4,
            method: 'textDocument/completion',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 3, character: 8 },
            },
          }),
        );

        step = 3;
      } else if (step === 3 && res.id === 4) {
        const items = res.result;
        expect(items.length).toBeGreaterThan(0);
        const hasAbs = items.some((item: any) => item.label === 'abs');
        const hasDate = items.some((item: any) => item.label === 'date');
        expect(hasAbs).toBe(true);
        expect(hasDate).toBe(false);

        child.kill('SIGINT');
        resolve();
      }
    });

    // Initialize with initializationOptions schema
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
                  first_name: { type: 'string' },
                  created_at: { type: 'date' },
                },
              },
            },
          },
        },
      }),
    );
  }));
