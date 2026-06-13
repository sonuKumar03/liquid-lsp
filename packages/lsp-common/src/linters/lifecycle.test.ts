import { test, expect } from 'vitest';
import { createLiquidEngine } from 'liquid-core';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { collectLifecycleDiagnostics } from './lifecycle.js';

test('collectLifecycleDiagnostics reports overwritten variables', () => {
  const engine = createLiquidEngine();
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    '{% assign x = "hello" %}\n{% assign x = 20 %}',
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine);

  expect(diagnostics.some((d: any) => d.message.includes('overwritten'))).toBe(
    true,
  );
});

test('collectLifecycleDiagnostics reports math filter type mismatches', () => {
  const engine = createLiquidEngine();
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    '{% assign x = "hello" %}\n{% assign y = x | plus: 5 %}',
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine);

  expect(
    diagnostics.some((d: any) => d.message.includes('Type mismatch')),
  ).toBe(true);
});

test('collectLifecycleDiagnostics reports optional property path warnings', () => {
  const engine = createLiquidEngine();
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    '{{ user.address.zipcode }}',
  );

  const schema = new Map<any, any>();
  schema.set('user', {
    kind: 'composite',
    fields: new Map<string, any>([
      [
        'address',
        {
          kind: 'composite',
          optional: true,
          fields: new Map<string, any>([['zipcode', 'string']]),
        },
      ],
    ]),
  });

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine, schema);

  expect(
    diagnostics.some((d: any) =>
      d.message.includes('accessed on optional parent'),
    ),
  ).toBe(true);
});
