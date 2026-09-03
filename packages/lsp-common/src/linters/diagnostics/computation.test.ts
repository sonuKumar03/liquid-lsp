import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Diagnostic } from 'vscode-languageserver';
import { DiagnosticSeverity } from 'vscode-languageserver';
import type { LiquidType } from '../../shared/schema.js';
import { collectComputationDiagnostics } from './computation.js';

describe('collectComputationDiagnostics', () => {
  it('detects unclosed computeColumn block', () => {
    const doc = TextDocument.create(
      'file:///test.liquid',
      'liquid',
      1,
      '{% computeColumn line_items total %}\n{% assign $$answer = 10 %}',
    );
    const diagnostics: Diagnostic[] = [];
    collectComputationDiagnostics(doc, diagnostics);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.message).toContain('Unclosed computeColumn tag');
    expect(diagnostics[0]?.severity).toBe(DiagnosticSeverity.Error);
  });

  it('detects missing arguments in computeColumn', () => {
    const doc = TextDocument.create(
      'file:///test.liquid',
      'liquid',
      1,
      '{% computeColumn %}{% endcomputeColumn %}',
    );
    const diagnostics: Diagnostic[] = [];
    collectComputationDiagnostics(doc, diagnostics);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.message).toContain('computeColumn requires both a table name and a target column name');
  });

  it('warns when computeColumn target is a primitive type in schema', () => {
    const doc = TextDocument.create(
      'file:///test.liquid',
      'liquid',
      1,
      '{% computeColumn user_age total %}{% endcomputeColumn %}',
    );
    const schema = new Map<string, LiquidType>([
      ['user_age', 'number'],
    ]);
    const diagnostics: Diagnostic[] = [];
    collectComputationDiagnostics(doc, diagnostics, schema);

    expect(diagnostics.some((d) => d.message.includes('Cannot compute column on "user_age"'))).toBe(true);
  });

  it('passes cleanly on valid computeColumn with table schema', () => {
    const doc = TextDocument.create(
      'file:///test.liquid',
      'liquid',
      1,
      '{% computeColumn line_items total %}\n{% assign $$answer = self.price | plus: 5 %}\n{% endcomputeColumn %}',
    );
    const schema = new Map<string, LiquidType>([
      ['line_items', { kind: 'table', columns: new Map([['price', 'number']]) }],
    ]);
    const diagnostics: Diagnostic[] = [];
    collectComputationDiagnostics(doc, diagnostics, schema);

    expect(diagnostics.length).toBe(0);
  });
});
