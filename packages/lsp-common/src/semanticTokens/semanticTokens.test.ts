import { test, expect } from 'vitest';
import { handleSemanticTokens } from './semanticTokens.js';
import { DocumentManager } from '../server/document-manager.js';
import { TextDocument } from 'vscode-languageserver-textdocument';

const documentsMock = new Map<string, TextDocument>();
const documentManagerMock = {
  documents: {
    get: (uri: string) => documentsMock.get(uri),
  },
  getTokens: (uri: string, engine: any) => {
    const { tokenizeTopLevelSafe, createLiquidEngine } = require('liquid-core');
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
