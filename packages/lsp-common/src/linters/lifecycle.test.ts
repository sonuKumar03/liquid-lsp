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

  expect(
    diagnostics.some((d: any) =>
      d.message.includes('never used it before overwriting'),
    ),
  ).toBe(true);
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
    diagnostics.some((d: any) => d.message.includes('parent is optional')),
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
      d.message.includes(
        '"row" doesn\'t have a field called "non_existent_field".',
      ),
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

  expect(
    diagnostics.some((d: any) => d.code === 'liquid.linter.coercion_warning'),
  ).toBe(true);
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

  expect(
    diagnostics.some(
      (d: any) => d.code === 'liquid.linter.non_numeric_coercion',
    ),
  ).toBe(true);
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

  expect(
    diagnostics.some((d: any) => d.code === 'liquid.linter.nil_propagation'),
  ).toBe(true);
});

test('collectLifecycleDiagnostics nil propagation from optional filter arguments (Feature 3)', () => {
  const engine = createLiquidEngine();
  const schema = new Map<string, any>();
  schema.set('base_price', { kind: 'primitive', type: 'number' });
  schema.set('contract', {
    kind: 'composite',
    fields: new Map<string, any>([
      ['tax_rate', { kind: 'primitive', type: 'number', optional: true }],
    ]),
  });

  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{% assign tax = base_price | times: contract.tax_rate %}
    {{ tax }}`,
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine, schema);

  expect(
    diagnostics.some((d: any) => d.code === 'liquid.linter.nil_propagation'),
  ).toBe(true);
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

  console.log('DEBUG DIAGS:', JSON.stringify(diagnostics, null, 2));

  expect(
    diagnostics.some(
      (d: any) => d.code === 'liquid.linter.branch_type_mismatch',
    ),
  ).toBe(true);
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

  expect(
    diagnostics.some(
      (d: any) => d.code === 'liquid.linter.filter_argument_type_mismatch',
    ),
  ).toBe(true);
});

test('collectLifecycleDiagnostics branch consistency without filter usage', () => {
  const engine = createLiquidEngine();
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{% assign count = 10 %}
     {% if count == null %}
       {% assign is_fixed_term = "true" %}
     {% else %}
       {% assign is_fixed_term = false %}
     {% endif %}
     {{ is_fixed_term }}`,
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine);

  const branchMismatches = diagnostics.filter(
    (d: any) => d.code === 'liquid.linter.branch_type_mismatch',
  );
  expect(branchMismatches.length).toBe(2);
  expect(branchMismatches[0].message).toContain(
    'assigned as string in this branch',
  );
  expect(branchMismatches[1].message).toContain(
    'assigned as boolean in this branch',
  );
});

test('collectLifecycleDiagnostics does not report overwritten warning for sequential blocks if read inside first block (Bug A)', () => {
  const engine = createLiquidEngine();
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{% if true %}
      {% assign current_date = "now" %}
      {% if true %}
        {{ current_date }}
      {% endif %}
     {% endif %}
     {% if true %}
      {% assign current_date = "now" %}
     {% endif %}`,
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine);

  const overwritingDiags = diagnostics.filter((d: any) =>
    d.message.includes('never used it before overwriting'),
  );
  expect(overwritingDiags.length).toBe(0);
});

test('collectLifecycleDiagnostics reports unused variable when self-referenced (Bug B)', () => {
  const engine = createLiquidEngine();
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{% assign x = 10 %}
     {% assign x = x | plus: 1 %}`,
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine);

  const unusedDiags = diagnostics.filter((d: any) =>
    d.message.includes('never read it anywhere'),
  );
  expect(unusedDiags.length).toBe(2);
});

test('collectLifecycleDiagnostics conditional narrowing for optional variables', () => {
  const engine = createLiquidEngine();
  const globalSchema = new Map<string, any>([
    [
      'user',
      {
        kind: 'composite',
        fields: new Map<string, any>([
          ['first_name', { kind: 'primitive', type: 'string', optional: true }],
          ['age', { kind: 'primitive', type: 'number', optional: true }],
        ]),
        optional: true,
      },
    ],
  ]);

  // Case 1: Simple optional property checked in if condition
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `
      {{ user.first_name }}
      {% if user.first_name %}
        {{ user.first_name }}
      {% else %}
        {{ user.first_name }}
      {% endif %}
      {{ user.first_name }}
    `,
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine, globalSchema);

  // We expect warnings about nil propagation/optional rendering for:
  // - The first line (outside)
  // - Inside the {% else %} branch (since it's not narrowed there)
  // - After {% endif %} (since overrides are restored)
  // But NOT inside the {% if user.first_name %} truthy branch!

  const nilWarnings = diagnostics.filter(
    (d: any) => d.code === 'liquid.linter.nil_propagation',
  );

  const linesWithWarnings = nilWarnings.map((d: any) => d.range.start.line);
  expect(linesWithWarnings).toContain(1);
  expect(linesWithWarnings).not.toContain(3);
  expect(linesWithWarnings).toContain(5);
  expect(linesWithWarnings).toContain(7);
});

test('collectLifecycleDiagnostics conditional narrowing with logical and and comparison operators', () => {
  const engine = createLiquidEngine();
  const globalSchema = new Map<string, any>([
    [
      'user',
      {
        kind: 'composite',
        fields: new Map<string, any>([
          ['first_name', { kind: 'primitive', type: 'string', optional: true }],
          ['is_active', { kind: 'primitive', type: 'boolean', optional: true }],
        ]),
        optional: true,
      },
    ],
  ]);

  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `
      {% if user.first_name != nil and user.is_active == true %}
        {{ user.first_name }}
      {% elsif user.first_name %}
        {{ user.first_name }}
      {% endif %}
    `,
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine, globalSchema);

  const nilWarnings = diagnostics.filter(
    (d: any) => d.code === 'liquid.linter.nil_propagation',
  );
  const linesWithWarnings = nilWarnings.map((d: any) => d.range.start.line);

  // Both the if branch and elsif branch have conditions that narrow `user.first_name`.
  // So there should be no nil warnings inside either branch (lines 2 and 4).
  expect(linesWithWarnings).not.toContain(2);
  expect(linesWithWarnings).not.toContain(4);
});
