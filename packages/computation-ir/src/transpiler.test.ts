import { describe, it, expect } from 'vitest';
import {
  generateLiquidFromIR,
  transpileIRToJS,
  transpileExpressionToSQL,
} from './transpiler.js';
import { parseExpressionToAST } from './expressions.js';
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

  describe('transpileIRToJS', () => {
    it('generates and evaluates executable JavaScript from IR', () => {
      const jsCode = transpileIRToJS(sampleDoc, { functionName: 'runCalc' });
      expect(jsCode).toContain('function runCalc(context = {})');

      // Execute the generated JS module via Function constructor
      const runner = new Function(`${jsCode}; return runCalc;`)();
      
      const resVip = runner({ is_vip: true });
      expect(resVip.scope.subtotal).toBe(100);
      expect(resVip.scope.tax).toBe(18);
      expect(resVip.scope.discount).toBe(20);
      expect(resVip.outputs[0]).toBe(98); // 100 + 18 - 20 = 98

      const resRegular = runner({ is_vip: false });
      expect(resRegular.scope.discount).toBe(5);
      expect(resRegular.outputs[0]).toBe(113); // 100 + 18 - 5 = 113
    });

    it('transpiles and executes computeColumn and sumArray correctly in JS', () => {
      const docWithCompute: ComputationIRDocument = {
        format: 'computation-interchange',
        version: '1',
        language: 'liquidjs-computation',
        source: '',
        nodes: [
          {
            kind: 'tag',
            name: 'computeColumn',
            args: 'items total',
            expression: '',
            expressionTokens: [],
            filters: [],
            dependencies: [],
            children: [
              {
                kind: 'tag',
                name: 'assign',
                target: '$$answer',
                args: '$$answer = self.qty | times: self.price',
                expression: 'self.qty',
                expressionTokens: [],
                filters: [
                  {
                    name: 'times',
                    raw: 'times: self.price',
                    source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
                  },
                ],
                dependencies: ['self'],
                source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
                original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
              },
            ],
            source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
            original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
          },
          {
            kind: 'tag',
            name: 'assign',
            target: 'grand_total',
            args: 'grand_total = items | sumArray: "total"',
            expression: 'items',
            expressionTokens: [],
            filters: [
              {
                name: 'sumArray',
                raw: 'sumArray: "total"',
                source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
              },
            ],
            dependencies: ['items'],
            source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
            original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
          },
        ],
        errors: [],
      };

      const jsCode = transpileIRToJS(docWithCompute, { functionName: 'runTableCalc' });
      const runner = new Function(`${jsCode}; return runTableCalc;`)();

      const context = {
        items: [
          { qty: 2, price: 50 },
          { qty: 3, price: 20 },
        ],
      };

      const result = runner(context);
      expect(result.scope.items[0].total).toBe(100);
      expect(result.scope.items[1].total).toBe(60);
      expect(result.scope.grand_total).toBe(160);
    });
  });

  describe('transpileExpressionToSQL', () => {
    it('transpiles binary arithmetic and comparison expressions to SQL', () => {
      const ast = parseExpressionToAST('price > 100 and discount <= 20');
      const sql = transpileExpressionToSQL(ast);
      expect(sql).toBe('(("price" > 100) AND ("discount" <= 20))');
    });

    it('transpiles filter pipelines to SQL scalar operations', () => {
      const ast = parseExpressionToAST('subtotal', [
        {
          name: 'times',
          raw: 'times: 1.18',
          source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
        },
        {
          name: 'minus',
          raw: 'minus: 10',
          source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
        },
      ]);
      const sql = transpileExpressionToSQL(ast);
      expect(sql).toBe('(("subtotal" * 1.18) - 10)');
    });

    it('transpiles sumArray and divided_by with zero protection in SQL', () => {
      const ast = parseExpressionToAST('items', [
        {
          name: 'sumArray',
          raw: 'sumArray: "amount"',
          source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
        },
      ]);
      const sql = transpileExpressionToSQL(ast);
      expect(sql).toBe('SUM("items")');

      const divAst = parseExpressionToAST('total', [
        {
          name: 'divided_by',
          raw: 'divided_by: count',
          source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
        },
      ]);
      const divSql = transpileExpressionToSQL(divAst);
      expect(divSql).toBe('("total" / NULLIF("count", 0))');
    });
  });
});

