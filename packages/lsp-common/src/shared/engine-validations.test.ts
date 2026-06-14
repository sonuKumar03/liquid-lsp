import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createLiquidEngine, tokenizeTopLevel } from 'liquid-core';
import { collectEngineValidationDiagnostics } from './engine-validations.js';

describe('collectEngineValidationDiagnostics', () => {
  it('reports use-before-assign for assignVar dependencies', () => {
    const engine = createLiquidEngine();
    const text = '{% assignVar y = x | plus: 1 %}';
    const doc = TextDocument.create('file:///t.liquid', 'liquid', 1, text);
    const tokens = tokenizeTopLevel(text, engine);
    const diagnostics: Array<{ message: string; code?: string }> = [];

    collectEngineValidationDiagnostics(
      doc,
      engine,
      diagnostics as never,
      tokens,
      new Set(),
    );

    expect(
      diagnostics.some(
        (d) =>
          d.code === 'liquid.linter.use_before_assign' &&
          d.message.includes('"x"'),
      ),
    ).toBe(true);
  });

  it('reports invalid parseAssign JSON with line-backed range', () => {
    const engine = createLiquidEngine();
    const text = '{% parseAssign x2 = [1, 2,] %}';
    const doc = TextDocument.create('file:///t.liquid', 'liquid', 1, text);
    const tokens = tokenizeTopLevel(text, engine);
    const diagnostics: Array<{
      code?: string;
      range: { start: { line: number } };
    }> = [];

    collectEngineValidationDiagnostics(
      doc,
      engine,
      diagnostics as never,
      tokens,
      new Set(),
    );

    const jsonDiag = diagnostics.find(
      (d) => d.code === 'liquid.linter.invalid_parse_assign_json',
    );
    expect(jsonDiag).toBeDefined();
    expect(jsonDiag?.range.start.line).toBe(0);
  });

  it('reports invalid computeColumn when $$answer is only assigned inside branches', () => {
    const engine = createLiquidEngine();
    const text = [
      '{% computeColumn testTable test_column %}',
      '{% if x %}{% assign $$answer = 1 %}{% endif %}',
      '{% for i in items %}{% assign $$answer = 2 %}{% endfor %}',
      '{% endcomputeColumn %}',
    ].join('\n');
    const doc = TextDocument.create('file:///t.liquid', 'liquid', 1, text);
    const tokens = tokenizeTopLevel(text, engine);
    const diagnostics: Array<{ code?: string; message: string }> = [];

    collectEngineValidationDiagnostics(
      doc,
      engine,
      diagnostics as never,
      tokens,
      new Set(),
    );

    expect(
      diagnostics.some(
        (d) =>
          d.code === 'liquid.linter.invalid_dynamic_table_computation' &&
          d.message.includes('$$answer is not assigned outside'),
      ),
    ).toBe(true);
  });

  it('allows computeColumn with a top-level $$answer assignment', () => {
    const engine = createLiquidEngine();
    const text = [
      '{% computeColumn testTable test_column %}',
      '{% assign $$answer = row.base %}',
      '{% if x %}{% assign $$answer = 1 %}{% endif %}',
      '{% endcomputeColumn %}',
    ].join('\n');
    const doc = TextDocument.create('file:///t.liquid', 'liquid', 1, text);
    const tokens = tokenizeTopLevel(text, engine);
    const diagnostics: Array<{ code?: string }> = [];

    collectEngineValidationDiagnostics(
      doc,
      engine,
      diagnostics as never,
      tokens,
      new Set(),
    );

    expect(
      diagnostics.some(
        (d) => d.code === 'liquid.linter.invalid_dynamic_table_computation',
      ),
    ).toBe(false);
  });
});
