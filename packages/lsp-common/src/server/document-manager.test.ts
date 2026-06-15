import { describe, expect, it } from 'vitest';
import type { Connection } from 'vscode-languageserver';
import { createLiquidEngine } from 'liquid-core';
import { DocumentManager } from './document-manager.js';

interface MockConnection extends Connection {
  triggerOpen: (params: {
    textDocument: { uri: string; languageId: string; version: number; text: string };
  }) => void;
  triggerChange: (params: {
    textDocument: { uri: string; version: number };
    contentChanges: { text: string }[];
  }) => void;
}

function createMockConnection(): MockConnection {
  const handlers = new Map<string, (params: any) => void>();
  const target: any = {
    console: {
      log: () => {},
      error: () => {},
    },
    triggerOpen: (params: any) => {
      handlers.get('onDidOpenTextDocument')?.(params);
    },
    triggerChange: (params: any) => {
      handlers.get('onDidChangeTextDocument')?.(params);
    },
  };

  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) {
        return obj[prop];
      }
      if (typeof prop === 'string' && prop.startsWith('on')) {
        return (handler: (params: any) => void) => {
          handlers.set(prop, handler);
        };
      }
      return undefined;
    },
  }) as unknown as MockConnection;
}

describe('DocumentManager', () => {
  it('reuses cached tokens for the same document version', () => {
    const connection = createMockConnection();
    const documentManager = new DocumentManager(connection);
    documentManager.listen();
    const engine = createLiquidEngine();
    const uri = 'file:///cache-test.liquid';

    connection.triggerOpen({
      textDocument: {
        uri,
        languageId: 'liquid',
        version: 1,
        text: '{% assign cached = true %}{{ cached }}',
      },
    });

    const first = documentManager.getTokens(uri, engine);
    const second = documentManager.getTokens(uri, engine);

    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);
  });

  it('re-tokenizes after document content changes', () => {
    const connection = createMockConnection();
    const documentManager = new DocumentManager(connection);
    documentManager.listen();
    const engine = createLiquidEngine();
    const uri = 'file:///cache-test.liquid';

    connection.triggerOpen({
      textDocument: {
        uri,
        languageId: 'liquid',
        version: 1,
        text: '{% assign a = 1 %}',
      },
    });
    const tokensV1 = documentManager.getTokens(uri, engine);

    connection.triggerChange({
      textDocument: {
        uri,
        version: 2,
      },
      contentChanges: [
        { text: '{% assign a = 1 %}{% assign b = 2 %}' },
      ],
    });
    const tokensV2 = documentManager.getTokens(uri, engine);

    expect(tokensV2).not.toBe(tokensV1);
    expect(tokensV2.length).toBeGreaterThan(tokensV1.length);
  });
});
