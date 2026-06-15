import { test, expect } from 'vitest';
import { createLiquidEngine } from 'liquid-core';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { collectLifecycleDiagnostics } from './lifecycle.js';
import { handleRename } from '../rename/rename.js';
import { handleSemanticTokens } from '../semanticTokens/semanticTokens.js';
import { Range } from 'vscode-languageserver';
import { DIAGNOSTIC_CODES } from '../shared/diagnostic-codes.js';

test('Sanity Check: Multi-Branch Type Consistency (String vs Boolean)', () => {
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

  // Assert branch mismatch warnings are reported on the assignments
  const branchMismatches = diagnostics.filter((d: any) => d.code === DIAGNOSTIC_CODES.BRANCH_TYPE_MISMATCH);
  expect(branchMismatches.length).toBe(2);
  
  // Verify plain language message content
  expect(branchMismatches[0].message).toContain("'is_fixed_term' is assigned as string in this branch");
  expect(branchMismatches[0].message).toContain("as boolean in another");
  
  expect(branchMismatches[1].message).toContain("'is_fixed_term' is assigned as boolean in this branch");
  expect(branchMismatches[1].message).toContain("as string in another");
});

test('Sanity Check: Nil Propagation & Output Default Warnings', () => {
  const engine = createLiquidEngine();
  const schema = new Map<string, any>();
  schema.set('sd_payment', { kind: 'primitive', type: 'currency', optional: true });

  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{{ sd_payment }}`
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine, schema);

  // Assert warning on output block with optional/nil variable
  const nilPropDiags = diagnostics.filter((d: any) => d.code === DIAGNOSTIC_CODES.NIL_PROPAGATION);
  expect(nilPropDiags.length).toBe(1);
  expect(nilPropDiags[0].message).toContain("is optional and might be blank");
});

test('Sanity Check: Implicit Coercion Warnings', () => {
  const engine = createLiquidEngine();
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{% assign name = "Alice" %}
     {{ name | plus: 10 }}`
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine);

  const coercionDiags = diagnostics.filter((d: any) => d.code === DIAGNOSTIC_CODES.TYPE_MISMATCH);
  expect(coercionDiags.length).toBe(1);
  expect(coercionDiags[0].message).toContain("only works on numbers. The value is text, not a number");
});

test('Sanity Check: Filter Argument Validation', () => {
  const engine = createLiquidEngine();
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{{ 100 | divided_by: "two" }}`
  );

  const diagnostics: any[] = [];
  collectLifecycleDiagnostics(doc, diagnostics, engine);

  const argDiags = diagnostics.filter((d: any) => d.code === DIAGNOSTIC_CODES.FILTER_ARGUMENT_TYPE_MISMATCH);
  expect(argDiags.length).toBe(1);
  expect(argDiags[0].message).toContain("expects a number argument");
});

test('Sanity Check: Rename Guards (Schema Collision)', () => {
  const schema = new Map<string, any>([['sd_company_name', 'string']]);
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{{ sd_company_name }}`
  );

  const documentsMock = new Map<string, TextDocument>();
  documentsMock.set(doc.uri, doc);
  const documentManagerMock = {
    documents: {
      get: (uri: string) => documentsMock.get(uri),
    },
    getTokens: () => [],
  } as any;

  // Attempt to rename schema variable should throw error per guards
  expect(() =>
    handleRename(
      documentManagerMock,
      {
        textDocument: { uri: doc.uri },
        position: { line: 0, character: 5 },
        newName: 'new_company_name',
      },
      schema
    )
  ).toThrowError(/external schema/);
});

test('Sanity Check: Semantic Tokens Classification', () => {
  const doc = TextDocument.create(
    'file:///t.liquid',
    'liquid',
    1,
    `{% assignVar total = 100 %}
     {{ total }}`
  );

  const documentsMock = new Map<string, TextDocument>();
  documentsMock.set(doc.uri, doc);
  const documentManagerMock = {
    documents: {
      get: (uri: string) => documentsMock.get(uri),
    },
  } as any;

  const tokens = handleSemanticTokens(documentManagerMock, { textDocument: { uri: doc.uri } });
  expect(tokens).toBeDefined();
  expect(tokens!.data.length).toBeGreaterThan(0);
});
