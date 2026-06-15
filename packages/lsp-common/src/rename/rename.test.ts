import { test, expect } from 'vitest';
import { handleRename } from './rename.js';
import { DocumentManager } from '../server/document-manager.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ResponseError } from 'vscode-languageserver';
import type { Liquid } from 'liquid-core';

// Mock connection and document manager
const documentsMock = new Map<string, TextDocument>();
const documentManagerMock = {
  documents: {
    get: (uri: string) => documentsMock.get(uri),
  },
  getTokens: () => [],
} as unknown as DocumentManager;

test('handleRename rejects renaming external schema variables', () => {
  const schema = new Map<string, any>([['contract_value', 'number']]);
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    '{{ contract_value }}',
  );
  documentsMock.set(doc.uri, doc);

  expect(() =>
    handleRename(
      documentManagerMock,
      {
        textDocument: { uri: doc.uri },
        position: { line: 0, character: 5 },
        newName: 'price',
      },
      schema,
    ),
  ).toThrowError(/external schema/);
});

test('handleRename rejects renaming to an existing variable name (collision)', () => {
  // We mock findVariableDeclarationsFromTokens via getTokens / findVariableDeclarations
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    '{% assign tax_rate = 0.18 %}\n{% assign temp = 10 %}',
  );
  documentsMock.set(doc.uri, doc);

  const documentManagerWithTokens = {
    documents: {
      get: (uri: string) => documentsMock.get(uri),
    },
    getTokens: (uri: string) => {
      // Return tag tokens to let findVariableDeclarations find them
      const { tokenizeTopLevelSafe, createLiquidEngine } = require('liquid-core');
      return tokenizeTopLevelSafe(doc.getText(), createLiquidEngine());
    }
  } as unknown as DocumentManager;

  expect(() =>
    handleRename(
      documentManagerWithTokens,
      {
        textDocument: { uri: doc.uri },
        position: { line: 1, character: 12 }, // 'temp'
        newName: 'tax_rate',
      },
      new Map(),
    ),
  ).toThrowError(/Naming collision/);
});
