import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Connection } from 'vscode-languageserver';
import { createLiquidEngine } from 'liquid-core';
import { DocumentManager } from './document-manager.js';

function createMockConnection(): Connection {
  return {
    console: {
      log: () => {},
      error: () => {},
    },
  } as Connection;
}

describe('DocumentManager', () => {
  it('reuses cached tokens for the same document version', () => {
    const connection = createMockConnection();
    const documentManager = new DocumentManager(connection);
    const engine = createLiquidEngine();
    const uri = 'file:///cache-test.liquid';
    const doc = TextDocument.create(
      uri,
      'liquid',
      1,
      '{% assign cached = true %}{{ cached }}',
    );

    documentManager.registerDocument(doc);

    const first = documentManager.getTokens(uri, engine);
    const second = documentManager.getTokens(uri, engine);

    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);
  });

  it('re-tokenizes after document content changes', () => {
    const connection = createMockConnection();
    const documentManager = new DocumentManager(connection);
    const engine = createLiquidEngine();
    const uri = 'file:///cache-test.liquid';
    const docV1 = TextDocument.create(uri, 'liquid', 1, '{% assign a = 1 %}');
    documentManager.registerDocument(docV1);
    const tokensV1 = documentManager.getTokens(uri, engine);

    const docV2 = TextDocument.create(
      uri,
      'liquid',
      2,
      '{% assign a = 1 %}{% assign b = 2 %}',
    );
    documentManager.registerDocument(docV2);
    const tokensV2 = documentManager.getTokens(uri, engine);

    expect(tokensV2).not.toBe(tokensV1);
    expect(tokensV2.length).toBeGreaterThan(tokensV1.length);
  });
});
