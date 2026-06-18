import { test, expect } from 'vitest';
import {
  startLspServer,
  LSPMessageReader,
  formatLSPMessage,
} from '../shared/test-utils.js';

test('Liquid signature help', () =>
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
                text: '{{ name | truncate: 10, ',
              },
            },
          }),
        );

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/signatureHelp',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 0, character: 24 },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        const sigHelp = res.result;
        expect(sigHelp).toBeDefined();
        expect(sigHelp.signatures.length).toBe(1);
        expect(sigHelp.signatures[0].label).toBe(
          'truncate(length: number, truncate_string: string = "...")',
        );
        expect(sigHelp.activeParameter).toBe(1);

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

test('Liquid signature help for divided_by', () =>
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
                text: '{{ amount | divided_by: 2, ',
              },
            },
          }),
        );

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/signatureHelp',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 0, character: 27 },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        const sigHelp = res.result as
          | {
              signatures?: Array<{ label?: string }>;
              activeParameter?: number;
            }
          | null;

        expect(sigHelp).toBeDefined();
        expect(sigHelp?.signatures?.length).toBe(1);
        expect(sigHelp?.signatures?.[0]?.label).toBe(
          'divided_by(divisor: number)',
        );
        expect(sigHelp?.activeParameter).toBe(0);

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

test('Liquid signature help uses filter metadata for custom filters', () =>
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
                uri: 'file:///metadata-filter.liquid',
                languageId: 'liquid',
                version: 1,
                text: '{{ item | updateAttribute: "status", ',
              },
            },
          }),
        );

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/signatureHelp',
            params: {
              textDocument: { uri: 'file:///metadata-filter.liquid' },
              position: { line: 0, character: 36 },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        const sigHelp = res.result as
          | {
              signatures?: Array<{
                label?: string;
                parameters?: Array<{ label?: string }>;
              }>;
              activeParameter?: number;
            }
          | null;

        expect(sigHelp).toBeDefined();
        expect(sigHelp?.signatures?.length).toBe(1);
        expect(sigHelp?.signatures?.[0]?.label).toBe(
          'updateAttribute(attr: string, val: any)',
        );
        expect(sigHelp?.signatures?.[0]?.parameters).toEqual([
          { label: 'attr' },
          { label: 'val' },
        ]);
        expect(sigHelp?.activeParameter).toBe(1);

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

test('Liquid signature help provides metadata signatures for filters missing handcoded entries', () =>
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
                uri: 'file:///concat-filter.liquid',
                languageId: 'liquid',
                version: 1,
                text: '{{ items | concat: ',
              },
            },
          }),
        );

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/signatureHelp',
            params: {
              textDocument: { uri: 'file:///concat-filter.liquid' },
              position: { line: 0, character: 18 },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        const sigHelp = res.result as
          | {
              signatures?: Array<{ label?: string }>;
              activeParameter?: number;
            }
          | null;

        expect(sigHelp).toBeDefined();
        expect(sigHelp?.signatures?.[0]?.label).toBe('concat(array: any)');
        expect(sigHelp?.activeParameter).toBe(0);

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
