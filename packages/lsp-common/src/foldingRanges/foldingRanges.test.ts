import { test, expect } from 'vitest';
import { handleFoldingRanges } from './foldingRanges.js';
import { DocumentManager } from '../server/document-manager.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { tokenizeTopLevelSafe, createLiquidEngine } from 'liquid-core';
import { FoldingRangeKind } from 'vscode-languageserver';

// Mock connection and document manager
const documentsMock = new Map<string, TextDocument>();
const documentManagerMock = {
  documents: {
    get: (uri: string) => documentsMock.get(uri),
    all: () => Array.from(documentsMock.values()),
  },
  getTokens: (uri: string, engine: any) => {
    const doc = documentsMock.get(uri);
    return doc ? tokenizeTopLevelSafe(doc.getText(), engine) : [];
  },
} as unknown as DocumentManager;

const engine = createLiquidEngine();

test('handleFoldingRanges folds multiline block tags', () => {
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{% if condition %}
  Hello
{% endif %}
{% for item in items %}
  {{ item }}
{% endfor %}`,
  );
  documentsMock.clear();
  documentsMock.set(doc.uri, doc);

  const ranges = handleFoldingRanges(
    documentManagerMock,
    {
      textDocument: { uri: doc.uri },
    },
    engine,
  );

  expect(ranges).not.toBeNull();
  expect(ranges?.length).toBe(2);

  // First range: if block (line 0 to line 2)
  expect(ranges?.[0]).toEqual({
    startLine: 0,
    endLine: 2,
    kind: undefined,
  });

  // Second range: for block (line 3 to line 5)
  expect(ranges?.[1]).toEqual({
    startLine: 3,
    endLine: 5,
    kind: undefined,
  });
});

test('handleFoldingRanges folds nested block tags correctly', () => {
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{% if outer %}
  {% if inner %}
    Hello
  {% endif %}
{% endif %}`,
  );
  documentsMock.clear();
  documentsMock.set(doc.uri, doc);

  const ranges = handleFoldingRanges(
    documentManagerMock,
    {
      textDocument: { uri: doc.uri },
    },
    engine,
  );

  expect(ranges).not.toBeNull();
  expect(ranges?.length).toBe(2);

  // Inner block: line 1 to line 3
  expect(ranges?.[0]).toEqual({
    startLine: 1,
    endLine: 3,
    kind: undefined,
  });

  // Outer block: line 0 to line 4
  expect(ranges?.[1]).toEqual({
    startLine: 0,
    endLine: 4,
    kind: undefined,
  });
});

test('handleFoldingRanges folds comment blocks with kind "comment"', () => {
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{% comment %}
  This is a block comment
  that spans multiple lines
{% endcomment %}`,
  );
  documentsMock.clear();
  documentsMock.set(doc.uri, doc);

  const ranges = handleFoldingRanges(
    documentManagerMock,
    {
      textDocument: { uri: doc.uri },
    },
    engine,
  );

  expect(ranges).not.toBeNull();
  expect(ranges?.length).toBe(1);

  expect(ranges?.[0]).toEqual({
    startLine: 0,
    endLine: 3,
    kind: FoldingRangeKind.Comment,
  });
});

test('handleFoldingRanges folds raw blocks', () => {
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{% raw %}
  {{ will_not_be_parsed }}
{% endraw %}`,
  );
  documentsMock.clear();
  documentsMock.set(doc.uri, doc);

  const ranges = handleFoldingRanges(
    documentManagerMock,
    {
      textDocument: { uri: doc.uri },
    },
    engine,
  );

  expect(ranges).not.toBeNull();
  expect(ranges?.length).toBe(1);

  expect(ranges?.[0]).toEqual({
    startLine: 0,
    endLine: 2,
    kind: undefined,
  });
});

test('handleFoldingRanges folds multiline inline comments with kind "comment"', () => {
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{#
  Multiline inline comment
#}`,
  );
  documentsMock.clear();
  documentsMock.set(doc.uri, doc);

  const ranges = handleFoldingRanges(
    documentManagerMock,
    {
      textDocument: { uri: doc.uri },
    },
    engine,
  );

  expect(ranges).not.toBeNull();
  expect(ranges?.length).toBe(1);

  expect(ranges?.[0]).toEqual({
    startLine: 0,
    endLine: 2,
    kind: FoldingRangeKind.Comment,
  });
});

test('handleFoldingRanges ignores single line tags and comments', () => {
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{% assign x = 1 %}
{% if cond %}{% endif %}
{# single line comment #}`,
  );
  documentsMock.clear();
  documentsMock.set(doc.uri, doc);

  const ranges = handleFoldingRanges(
    documentManagerMock,
    {
      textDocument: { uri: doc.uri },
    },
    engine,
  );

  expect(ranges).toBeNull();
});
