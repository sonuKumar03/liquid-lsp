import { test, expect } from 'vitest';
import {
  startLspServer,
  LSPMessageReader,
  formatLSPMessage,
} from '../shared/test-utils.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test('Liquid Go to Definition', () =>
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
                text: '{% assign username = "Sonu" %}\n{{ username }}',
              },
            },
          }),
        );

        // Request definition of username on line 1 (character index 3)
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/definition',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 1, character: 3 },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        const location = res.result;
        expect(location).toBeDefined();
        expect(location.uri).toBe('file:///t.liquid');
        // Declaration range for username: {% assign username = ... %}
        // username is 8 characters long, starting at index 10 in line 0: '{% assign ' -> 10
        expect(location.range.start.line).toBe(0);
        expect(location.range.start.character).toBe(10);
        expect(location.range.end.line).toBe(0);
        expect(location.range.end.character).toBe(18);

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

test('Liquid Go to Definition for schema variables', () =>
  new Promise<void>((resolve) => {
    const rootPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'liquid-lsp-definitions-test-'),
    );
    const schemaPath = path.join(rootPath, '.liquid-schema.json');
    const schemaContent = JSON.stringify(
      {
        user: {
          type: 'composite',
          fields: {
            first_name: 'string',
          },
        },
      },
      null,
      2,
    );

    fs.writeFileSync(schemaPath, schemaContent, 'utf8');

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
                text: '{{ user.first_name }}',
              },
            },
          }),
        );

        // Request definition of user.first_name (character index 10 is inside first_name)
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/definition',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 0, character: 10 },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        const location = res.result;
        expect(location).toBeDefined();
        expect(location.uri).toContain('.liquid-schema.json');

        const lines = schemaContent.split('\n');
        const expectedLine = lines.findIndex((l) => l.includes('first_name'));
        expect(location.range.start.line).toBe(expectedLine);

        child.kill('SIGINT');

        try {
          fs.rmSync(rootPath, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }

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
          rootPath,
        },
      }),
    );
  }));
