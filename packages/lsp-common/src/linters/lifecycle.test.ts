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

test('collectLifecycleDiagnostics flags assign to non-computable schema variable', () => {
  const engine = createLiquidEngine();
  const schemaVariables = new Map([
    [
      'sd_registered_address',
      { field_name: 'sd_registered_address', data_type: 'address' as const },
    ],
  ]);
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    '{% assignVar sd_registered_address = "bad" %}',
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(
    doc,
    diagnostics,
    engine,
    undefined,
    schemaVariables,
  );

  expect(
    diagnostics.some((d: any) =>
      d.message.includes('does not support liquid computation assignments'),
    ),
  ).toBe(true);
  expect(
    diagnostics.some(
      (d: any) => d.code === 'key_pointer.computation.assign_not_supported',
    ),
  ).toBe(true);
});

test('collectLifecycleDiagnostics allows assign to computable schema variable', () => {
  const engine = createLiquidEngine();
  const schema = new Map<any, any>();
  schema.set('sd_company_name', 'string');
  const schemaVariables = new Map([
    [
      'sd_company_name',
      { field_name: 'sd_company_name', data_type: 'string' as const },
    ],
  ]);
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    '{% assignVar sd_company_name = "Acme" %}',
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(
    doc,
    diagnostics,
    engine,
    schema,
    schemaVariables,
  );

  expect(
    diagnostics.some((d: any) =>
      d.message.includes('does not support liquid computation assignments'),
    ),
  ).toBe(false);
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
