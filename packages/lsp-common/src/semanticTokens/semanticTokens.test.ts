import { test, expect } from 'vitest';
import { handleSemanticTokens, handleSemanticTokensDelta, tokenCache } from './semanticTokens.js';
import { DocumentManager } from '../server/document-manager.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { tokenizeTopLevelSafe, createLiquidEngine } from 'liquid-core';

const documentsMock = new Map<string, TextDocument>();
const documentManagerMock = {
  documents: {
    get: (uri: string) => documentsMock.get(uri),
  },
  getTokens: (uri: string) => {
    return tokenizeTopLevelSafe(documentsMock.get(uri)!.getText(), createLiquidEngine());
  }
} as unknown as DocumentManager;

test('handleSemanticTokens delta encodes variable occurrences', () => {
  const schema = new Map<string, any>([['contract_value', 'number']]);
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{{ contract_value }}
     {% assign base = contract_value | minus: 5 %}
     {{ base }}`,
  );
  documentsMock.set(doc.uri, doc);

  const result = handleSemanticTokens(documentManagerMock, { textDocument: { uri: doc.uri } }, schema);
  expect(result).toBeDefined();
  expect(result?.data).toBeInstanceOf(Array);
  expect(result?.data.length).toBeGreaterThan(0);
});

test('handleSemanticTokensDelta calculates incremental edits correctly', () => {
  tokenCache.clear();

  const schema = new Map<string, any>([['contract_value', 'number']]);
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{{ contract_value }}`
  );
  documentsMock.set(doc.uri, doc);

  // 1. Initial request (full tokens)
  const fullResult = handleSemanticTokens(
    documentManagerMock,
    { textDocument: { uri: doc.uri } },
    schema
  );
  expect(fullResult).toBeDefined();
  expect(fullResult?.resultId).toBeDefined();
  const initialResultId = fullResult?.resultId;

  // 2. Modify the document to add a local assignment
  const updatedDoc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    2,
    `{{ contract_value }}\n{% assign x = 10 %}`
  );
  documentsMock.set(updatedDoc.uri, updatedDoc);

  // 3. Request delta updates using the previousResultId
  const deltaResult = handleSemanticTokensDelta(
    documentManagerMock,
    {
      textDocument: { uri: doc.uri },
      previousResultId: initialResultId!,
    },
    schema
  );

  // Check that the returned result is indeed a delta response (has edits)
  expect(deltaResult).toBeDefined();
  expect(deltaResult).not.toBeNull();
  expect((deltaResult as any).edits).toBeDefined();
  expect((deltaResult as any).edits.length).toBeGreaterThan(0);

  // 4. Request delta updates with a mismatching/invalid previousResultId should fall back to full tokens
  const fallbackResult = handleSemanticTokensDelta(
    documentManagerMock,
    {
      textDocument: { uri: doc.uri },
      previousResultId: 'invalid-id-mismatch',
    },
    schema
  );

  expect(fallbackResult).toBeDefined();
  expect((fallbackResult as any).data).toBeDefined();
  expect((fallbackResult as any).edits).toBeUndefined();
});
