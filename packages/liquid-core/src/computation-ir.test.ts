import { describe, expect, it } from 'vitest';
import { extractComputationIR } from './computation-ir.js';

describe('extractComputationIR', () => {
  it('preserves assignment and output structure with source ranges', () => {
    const source = '{% assign total = price | plus: tax %}{{ total }}';
    const result = extractComputationIR(source);

    expect(result.version).toBe('1');
    expect(result.language).toBe('liquidjs-computation');
    expect(result.source).toBe(source);
    expect(result.errors).toEqual([]);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]).toMatchObject({
      kind: 'tag',
      name: 'assign',
      target: 'total',
      args: 'total = price | plus: tax',
      expression: 'price | plus: tax',
      dependencies: ['price', 'tax'],
      filters: [{ name: 'plus', raw: 'plus: tax' }],
      source: { start: { offset: 0 }, end: { offset: 38 } },
    });
    if (result.nodes[0]?.kind === 'tag') {
      expect(
        result.nodes[0].expressionTokens.map((token) => token.text),
      ).toEqual(['price']);
      expect(result.nodes[0].expressionTokens[0]?.source.start.offset).toBe(18);
    }
    expect(result.nodes[1]).toMatchObject({
      kind: 'output',
      expression: 'total',
      dependencies: ['total'],
      source: { start: { offset: 38 }, end: { offset: 49 } },
    });
  });

  it('keeps nested computation tags in source order', () => {
    const result = extractComputationIR(
      '{% if enabled %}{% assign value = input %}{% else %}{% assign value = 0 %}{% endif %}',
    );

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ kind: 'tag', name: 'if' });
    if (result.nodes[0]?.kind === 'tag') {
      expect(
        result.nodes[0].children?.map((node) =>
          node.kind === 'tag' ? node.name : node.kind,
        ),
      ).toEqual(['assign', 'else', 'assign']);
    }
  });

  it('preserves compute-column and parse-assign structure', () => {
    const result = extractComputationIR(
      `{% computeColumn rows total %}{% parseAssign value = '{"x": 1}' %}{% assign $$answer = value.x %}{% endcomputeColumn %}`,
    );

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      kind: 'tag',
      name: 'computeColumn',
    });
    if (result.nodes[0]?.kind === 'tag') {
      expect(
        result.nodes[0].children?.map((node) =>
          node.kind === 'tag' ? node.name : node.kind,
        ),
      ).toEqual(['parseAssign', 'assign']);
      expect(result.nodes[0].children?.[0]).toMatchObject({
        kind: 'tag',
        name: 'parseAssign',
        target: 'value',
        expression: `'{"x": 1}'`,
      });
    }
  });
});
