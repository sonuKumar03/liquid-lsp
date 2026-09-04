import { describe, it, expect } from 'vitest';
import { generateLiquidFromIR } from './transpiler.js';
import type { ComputationIRDocument } from './index.js';

describe('Computation IR Transpilers', () => {
  const sampleDoc: ComputationIRDocument = {
    format: 'computation-interchange',
    version: '1',
    language: 'liquidjs-computation',
    source: '',
    nodes: [
      {
        kind: 'tag',
        name: 'assign',
        target: 'subtotal',
        args: 'subtotal = 100',
        expression: '100',
        expressionTokens: [],
        filters: [],
        dependencies: [],
        source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
        original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
      },
      {
        kind: 'tag',
        name: 'assign',
        target: 'tax',
        args: 'tax = subtotal | times: 0.18',
        expression: 'subtotal',
        expressionTokens: [],
        filters: [
          {
            name: 'times',
            raw: 'times: 0.18',
            source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
          },
        ],
        dependencies: ['subtotal'],
        source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
        original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
      },
      {
        kind: 'tag',
        name: 'if',
        args: 'is_vip',
        expression: 'is_vip',
        expressionTokens: [],
        filters: [],
        dependencies: ['is_vip'],
        children: [
          {
            kind: 'tag',
            name: 'assign',
            target: 'discount',
            args: 'discount = 20',
            expression: '20',
            expressionTokens: [],
            filters: [],
            dependencies: [],
            source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
            original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
          },
          {
            kind: 'tag',
            name: 'else',
            args: '',
            expression: '',
            expressionTokens: [],
            filters: [],
            dependencies: [],
            source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
            original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
          },
          {
            kind: 'tag',
            name: 'assign',
            target: 'discount',
            args: 'discount = 5',
            expression: '5',
            expressionTokens: [],
            filters: [],
            dependencies: [],
            source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
            original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
          },
        ],
        source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
        original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
      },
      {
        kind: 'output',
        expression: 'subtotal | plus: tax | minus: discount',
        expressionTokens: [],
        filters: [
          {
            name: 'plus',
            raw: 'plus: tax',
            source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
          },
          {
            name: 'minus',
            raw: 'minus: discount',
            source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
          },
        ],
        dependencies: ['subtotal', 'tax', 'discount'],
        source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
        original: { dialect: 'liquidjs-computation', kind: 'output', text: '' },
      },
    ],
    errors: [],
  };

  describe('generateLiquidFromIR', () => {
    it('generates clean, canonical LiquidJS source from IR', () => {
      const liquid = generateLiquidFromIR(sampleDoc);
      expect(liquid).toContain('{% assign subtotal = 100 %}');
      expect(liquid).toContain('{% assign tax = subtotal | times: 0.18 %}');
      expect(liquid).toContain('{% if is_vip %}');
      expect(liquid).toContain('{% else %}');
      expect(liquid).toContain('{% endif %}');
      expect(liquid).toContain('{{ subtotal | plus: tax | minus: discount }}');
    });
  });
});

