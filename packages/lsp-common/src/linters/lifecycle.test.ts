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

  expect(diagnostics.some((d: any) => d.message.includes('never used it before overwriting'))).toBe(
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
    diagnostics.some((d: any) => d.message.includes('only works on numbers')),
  ).toBe(true);
});

test('collectLifecycleDiagnostics reports string filter type mismatches', () => {
  const engine = createLiquidEngine();
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    '{% assign x = 42 %}\n{% assign y = x | upcase %}',
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine);

  expect(
    diagnostics.some((d: any) => d.message.includes('only works on text')),
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
      d.message.includes('cannot be set directly in the template'),
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
      d.message.includes('cannot be set directly in the template'),
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
      d.message.includes('parent is optional'),
    ),
  ).toBe(true);
});

test('collectLifecycleDiagnostics checks loop variable type access with parseAssign collection', () => {
  const engine = createLiquidEngine();
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{% parseAssign local_items = '[{"title": "License", "cost": 450}]' %}
{% for row in local_items %}
  {{ row.title }}
  {{ row.non_existent_field }}
{% endfor %}`,
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine, new Map());

  expect(
    diagnostics.some((d: any) =>
      d.message.includes('"row" doesn\'t have a field called "non_existent_field".'),
    ),
  ).toBe(true);

  expect(
    diagnostics.some((d: any) =>
      d.message.includes('"row" doesn\'t have a field called "title"'),
    ),
  ).toBe(false);
});

test('collectLifecycleDiagnostics coercion warnings (Feature 1)', () => {
  const engine = createLiquidEngine();
  const schema = new Map<string, any>();
  schema.set('price', { kind: 'primitive', type: 'number', optional: true });
  
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    '{{ price | plus: 5 }}',
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine, schema);

  expect(diagnostics.some((d: any) => d.code === 'liquid.linter.coercion_warning')).toBe(true);
});

test('collectLifecycleDiagnostics format-to-numeric warning (Feature 1)', () => {
  const engine = createLiquidEngine();
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    '{{ "123a" | plus: 5 }}',
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine);

  expect(diagnostics.some((d: any) => d.code === 'liquid.linter.non_numeric_coercion')).toBe(true);
});

test('collectLifecycleDiagnostics nil propagation (Feature 3)', () => {
  const engine = createLiquidEngine();
  const schema = new Map<string, any>();
  schema.set('contract', {
    kind: 'composite',
    optional: true,
    fields: new Map<string, any>([['items', 'number']]),
  });

  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{% assign subtotal = contract.items %}
    {% assign tax = subtotal | times: 10 %}
    {{ tax }}`,
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine, schema);

  expect(diagnostics.some((d: any) => d.code === 'liquid.linter.nil_propagation')).toBe(true);
});

test('collectLifecycleDiagnostics branch consistency (Feature 5)', () => {
  const engine = createLiquidEngine();
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{% if true %}
      {% assign rate = 0.15 %}
     {% else %}
      {% assign rate = "standard" %}
     {% endif %}
     {{ rate | times: 10 }}`,
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine);

  console.log("DEBUG DIAGS:", JSON.stringify(diagnostics, null, 2));

  expect(diagnostics.some((d: any) => d.code === 'liquid.linter.branch_type_mismatch')).toBe(true);
});

test('collectLifecycleDiagnostics filter argument validation (Feature 6)', () => {
  const engine = createLiquidEngine();
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{{ 100 | divided_by: "two" }}
     {{ "hello" | date: "2026-06-15" }}`,
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine);

  expect(diagnostics.some((d: any) => d.code === 'liquid.linter.filter_argument_type_mismatch')).toBe(true);
});
