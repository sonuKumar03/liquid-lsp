import { test, expect } from 'vitest';
import { handleReferences } from './references.js';
import { DocumentManager } from '../server/document-manager.js';
import { TextDocument } from 'vscode-languageserver-textdocument';

// Mock connection and document manager
const documentsMock = new Map<string, TextDocument>();
const documentManagerMock = {
  documents: {
    get: (uri: string) => documentsMock.get(uri),
    all: () => Array.from(documentsMock.values()),
  },
  getTokens: () => [],
} as unknown as DocumentManager;

test('handleReferences returns null if cursor is not on a valid word or block', () => {
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    'Plain text without tags',
  );
  documentsMock.clear();
  documentsMock.set(doc.uri, doc);

  const refs = handleReferences(documentManagerMock, {
    textDocument: { uri: doc.uri },
    position: { line: 0, character: 5 },
    context: { includeDeclaration: true },
  });

  expect(refs).toBeNull();
});

test('handleReferences finds references of a local variable (including declaration)', () => {
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    '{% assign username = "Sonu" %}\n{{ username }} and {{ username }}',
  );
  documentsMock.clear();
  documentsMock.set(doc.uri, doc);

  const refs = handleReferences(documentManagerMock, {
    textDocument: { uri: doc.uri },
    position: { line: 1, character: 5 }, // on 'username' in {{ username }}
    context: { includeDeclaration: true },
  });

  expect(refs).not.toBeNull();
  expect(refs?.length).toBe(3);

  // First reference: declaration
  expect(refs?.[0]?.range.start.line).toBe(0);
  expect(refs?.[0]?.range.start.character).toBe(10);
  expect(refs?.[0]?.range.end.character).toBe(18);

  // Second reference: first usage
  expect(refs?.[1]?.range.start.line).toBe(1);
  expect(refs?.[1]?.range.start.character).toBe(3);
  expect(refs?.[1]?.range.end.character).toBe(11);

  // Third reference: second usage
  expect(refs?.[2]?.range.start.line).toBe(1);
  expect(refs?.[2]?.range.start.character).toBe(22);
  expect(refs?.[2]?.range.end.character).toBe(30);
});

test('handleReferences finds references of a local variable (excluding declaration)', () => {
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    '{% assign username = "Sonu" %}\n{{ username }} and {{ username }}',
  );
  documentsMock.clear();
  documentsMock.set(doc.uri, doc);

  const refs = handleReferences(documentManagerMock, {
    textDocument: { uri: doc.uri },
    position: { line: 1, character: 5 }, // on 'username' in {{ username }}
    context: { includeDeclaration: false },
  });

  expect(refs).not.toBeNull();
  // Should only return the two usages in the output tag, not the declaration
  expect(refs?.length).toBe(2);

  expect(refs?.[0]?.range.start.line).toBe(1);
  expect(refs?.[0]?.range.start.character).toBe(3);

  expect(refs?.[1]?.range.start.line).toBe(1);
  expect(refs?.[1]?.range.start.character).toBe(22);
});

test('handleReferences ignores matches inside strings and comments', () => {
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{% assign my_var = 10 %}
{{ my_var }}
{% comment %}
  This is my_var inside a comment
{% endcomment %}
{# my_var in inline comment #}
{{ "my_var inside string" }}
{{ 'my_var inside single-quoted string' }}`,
  );
  documentsMock.clear();
  documentsMock.set(doc.uri, doc);

  const refs = handleReferences(documentManagerMock, {
    textDocument: { uri: doc.uri },
    position: { line: 1, character: 4 }, // on 'my_var' inside {{ my_var }}
    context: { includeDeclaration: true },
  });

  expect(refs).not.toBeNull();
  // Should find exactly 2: the declaration (line 0) and the usage (line 1)
  expect(refs?.length).toBe(2);

  expect(refs?.[0]?.range.start.line).toBe(0);
  expect(refs?.[1]?.range.start.line).toBe(1);
});

test('handleReferences works across multiple open documents', () => {
  const doc1 = TextDocument.create(
    'file:///doc1.liquid',
    'liquid',
    1,
    '{{ global_user.name }}',
  );
  const doc2 = TextDocument.create(
    'file:///doc2.liquid',
    'liquid',
    1,
    '{{ global_user.age }}',
  );

  documentsMock.clear();
  documentsMock.set(doc1.uri, doc1);
  documentsMock.set(doc2.uri, doc2);

  const refs = handleReferences(documentManagerMock, {
    textDocument: { uri: doc1.uri },
    position: { line: 0, character: 5 }, // global_user
    context: { includeDeclaration: true },
  });

  expect(refs).not.toBeNull();
  expect(refs?.length).toBe(2);

  const uris = refs?.map((r) => r.uri);
  expect(uris).toContain('file:///doc1.liquid');
  expect(uris).toContain('file:///doc2.liquid');
});
