import { test, expect } from 'vitest';
import { handleRename } from './rename.js';
import { DocumentManager } from '../server/document-manager.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { tokenizeTopLevelSafe, createLiquidEngine } from 'liquid-core';

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
    getTokens: () => {
      // Return tag tokens to let findVariableDeclarations find them
      return tokenizeTopLevelSafe(doc.getText(), createLiquidEngine());
    },
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

test('handleRename allows renaming in sibling scopes but blocks shadowing', () => {
  const doc = TextDocument.create(
    'file:///sibling.liquid',
    'liquid',
    1,
    `{% if cond_a %}
  {% assign temp = 10 %}
{% endif %}
{% if cond_b %}
  {% assign local_val = 20 %}
{% endif %}`,
  );
  documentsMock.set(doc.uri, doc);

  const documentManagerWithTokens = {
    documents: {
      get: (uri: string) => documentsMock.get(uri),
    },
    getTokens: () => {
      return tokenizeTopLevelSafe(doc.getText(), createLiquidEngine());
    },
  } as unknown as DocumentManager;

  // Renaming 'local_val' to 'temp' should be allowed because they are in disjoint sibling scopes
  const edit = handleRename(
    documentManagerWithTokens,
    {
      textDocument: { uri: doc.uri },
      position: { line: 4, character: 15 }, // 'local_val'
      newName: 'temp',
    },
    new Map(),
  );

  expect(edit).not.toBeNull();
  expect(edit?.changes?.[doc.uri]).toBeDefined();

  // Now let's test shadowing a global variable
  const docShadow = TextDocument.create(
    'file:///shadow.liquid',
    'liquid',
    1,
    `{% assign global_var = 100 %}
{% for item in items %}
  {% assign temp = item.price %}
{% endfor %}`,
  );
  documentsMock.set(docShadow.uri, docShadow);

  const documentManagerShadow = {
    documents: {
      get: (uri: string) => documentsMock.get(uri),
    },
    getTokens: () => {
      return tokenizeTopLevelSafe(docShadow.getText(), createLiquidEngine());
    },
  } as unknown as DocumentManager;

  // Renaming 'temp' to 'global_var' should be blocked because 'global_var' is in the parent scope (shadowing)
  expect(() =>
    handleRename(
      documentManagerShadow,
      {
        textDocument: { uri: docShadow.uri },
        position: { line: 2, character: 15 }, // 'temp'
        newName: 'global_var',
      },
      new Map(),
    ),
  ).toThrowError(/Naming collision/);
});

test('handleRename only edits occurrences in the cursor sibling scope', () => {
  const doc = TextDocument.create(
    'file:///scope-limited.liquid',
    'liquid',
    1,
    `{% if cond_a %}
  {% assign temp = 10 %}
  {{ temp }}
{% endif %}
{% if cond_b %}
  {% assign temp = 20 %}
  {{ temp }}
{% endif %}`,
  );
  documentsMock.set(doc.uri, doc);

  const documentManagerWithTokens = {
    documents: {
      get: (uri: string) => documentsMock.get(uri),
    },
    getTokens: () => tokenizeTopLevelSafe(doc.getText(), createLiquidEngine()),
  } as unknown as DocumentManager;

  const edit = handleRename(
    documentManagerWithTokens,
    {
      textDocument: { uri: doc.uri },
      position: { line: 5, character: 13 },
      newName: 'right_temp',
    },
    new Map(),
  );

  const edits = edit?.changes?.[doc.uri] ?? [];
  expect(edits).toHaveLength(2);
  expect(edits.map((e) => e.range.start.line)).toEqual([5, 6]);
});

test('handleRename root-scope variable skips same name in nested shadowing scope', () => {
  const doc = TextDocument.create(
    'file:///root-scope.liquid',
    'liquid',
    1,
    `{% assign temp = 1 %}
{{ temp }}
{% if cond %}
  {% assign temp = 2 %}
  {{ temp }}
{% endif %}
{{ temp }}`,
  );
  documentsMock.set(doc.uri, doc);

  const documentManagerWithTokens = {
    documents: {
      get: (uri: string) => documentsMock.get(uri),
    },
    getTokens: () => tokenizeTopLevelSafe(doc.getText(), createLiquidEngine()),
  } as unknown as DocumentManager;

  const edit = handleRename(
    documentManagerWithTokens,
    {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: 12 },
      newName: 'outer_temp',
    },
    new Map(),
  );

  const edits = edit?.changes?.[doc.uri] ?? [];
  expect(edits).toHaveLength(3);
  expect(edits.map((e) => e.range.start.line)).toEqual([0, 1, 6]);
});
