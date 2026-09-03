import { createLiquidEngine, extractComputationIR } from 'liquid-core';
import { evaluateReferenceProgramWithOutputs } from './reference-language.js';
import {
  referenceProgramFromIR,
  referenceSourceFromIR,
} from './reference-from-ir.js';
import { describe, expect, it } from 'vitest';
import fixtures from '../../../docs/computation-migration/fixtures/liquidjs-computation-fixtures.json';

describe('referenceProgramFromIR', () => {
  it('converts computeColumn into isolated row evaluations', () => {
    const source =
      '{% computeColumn rows total %}{% assign $$answer = self.amount | plus: 1 %}{% endcomputeColumn %}';
    const program = referenceProgramFromIR(extractComputationIR(source));

    expect(
      evaluateReferenceProgramWithOutputs(program, {
        rows: [{ amount: 2 }, { amount: 4 }],
      }),
    ).toEqual({
      values: {
        rows: [
          { amount: 2, total: 3 },
          { amount: 4, total: 5 },
        ],
      },
      outputs: [],
    });
  });

  it('converts parseAssign literals into reference assignments', () => {
    const source = `{% parseAssign tax = 12 %}{{ tax }}`;
    const program = referenceProgramFromIR(extractComputationIR(source));

    expect(evaluateReferenceProgramWithOutputs(program, {})).toEqual({
      values: { tax: 12 },
      outputs: [12],
    });
  });

  it('converts LiquidJS assignments and if branches into the reference language', () => {
    const ir = extractComputationIR(
      '{% assign total = amount plus 5 %}{% if total > 10 %}{% assign result = total minus 2 %}{% else %}{% assign result = 0 %}{% endif %}{{ result }}',
    );

    const program = referenceProgramFromIR(ir);

    expect(
      evaluateReferenceProgramWithOutputs(program, { amount: 10 }),
    ).toEqual({
      values: { amount: 10, total: 15, result: 13 },
      outputs: [13],
    });
    expect(evaluateReferenceProgramWithOutputs(program, { amount: 2 })).toEqual(
      {
        values: { amount: 2, total: 7, result: 0 },
        outputs: [0],
      },
    );
  });

  it('exposes generated reference source for the visual workbench', () => {
    const ir = extractComputationIR(
      '{% assign total = amount | plus: 5 %}{{ total }}',
    );

    expect(referenceSourceFromIR(ir)).toBe(
      'total = Add(amount, 5); output total;',
    );
  });

  it('generates Specter-style calls for arithmetic filters', () => {
    const ir = extractComputationIR(
      '{% assign a = amount | minus: fee %}{% assign b = a | times: multiplier %}{% assign c = b | divided_by: divisor %}',
    );

    expect(referenceSourceFromIR(ir)).toBe(
      'a = Subtract(amount, fee); b = Multiply(a, multiplier); c = Divide(b, divisor);',
    );
  });

  it('generates Sum over a selected table column', () => {
    const ir = extractComputationIR(
      '{% assign total = rows | sumArray: "amount" %}',
    );

    expect(referenceSourceFromIR(ir)).toBe(
      'total = Sum(GetColumn(rows, "amount"));',
    );
  });

  it('generates If for simple conditional assignments', () => {
    const ir = extractComputationIR(
      '{% if enabled %}{% assign result = amount %}{% else %}{% assign result = 0 %}{% endif %}',
    );

    expect(referenceSourceFromIR(ir)).toBe(
      'result = If(Exists(enabled), amount, 0);',
    );
  });

  it('matches LiquidJS output for a supported arithmetic filter', async () => {
    const source = '{% assign total = amount | plus: 5 %}{{ total }}';
    const ir = extractComputationIR(source);
    const program = referenceProgramFromIR(ir);
    const reference = evaluateReferenceProgramWithOutputs(program, {
      amount: 8,
    });
    const liquid = await createLiquidEngine().parseAndRender(source, {
      amount: 8,
    });

    expect(Number(liquid.trim())).toBe(reference.outputs[0]);
  });

  it('matches LiquidJS output for subtraction', async () => {
    const source = '{% assign total = amount | minus: fee %}{{ total }}';
    const ir = extractComputationIR(source);
    const reference = evaluateReferenceProgramWithOutputs(
      referenceProgramFromIR(ir),
      { amount: 12, fee: 4 },
    );
    const liquid = await createLiquidEngine().parseAndRender(source, {
      amount: 12,
      fee: 4,
    });

    expect(Number(liquid.trim())).toBe(reference.outputs[0]);
  });

  it('matches LiquidJS output for multiplication', async () => {
    const source = '{% assign total = amount | times: multiplier %}{{ total }}';
    const ir = extractComputationIR(source);
    const reference = evaluateReferenceProgramWithOutputs(
      referenceProgramFromIR(ir),
      { amount: 12, multiplier: 4 },
    );
    const liquid = await createLiquidEngine().parseAndRender(source, {
      amount: 12,
      multiplier: 4,
    });

    expect(Number(liquid.trim())).toBe(reference.outputs[0]);
  });

  it('matches LiquidJS output for division', async () => {
    const source =
      '{% assign total = amount | divided_by: divisor %}{{ total }}';
    const ir = extractComputationIR(source);
    const reference = evaluateReferenceProgramWithOutputs(
      referenceProgramFromIR(ir),
      { amount: 10, divisor: 3 },
    );
    const liquid = await createLiquidEngine().parseAndRender(source, {
      amount: 10,
      divisor: 3,
    });

    expect(Number(liquid.trim())).toBe(reference.outputs[0]);
  });

  it('matches LiquidJS currency constructor fields', async () => {
    const source =
      '{% assign result = amount | toCurrency: code %}{{ result.value }}:{{ result.type }}';
    const input = { amount: 1000, code: 'INR' };
    const reference = evaluateReferenceProgramWithOutputs(
      referenceProgramFromIR(extractComputationIR(source)),
      input,
    );
    const liquid = await createLiquidEngine().parseAndRender(source, input);

    expect(reference.outputs.join(':')).toBe(liquid.trim());
    expect(liquid.trim()).toBe('1000:INR');
  });

  it('matches LiquidJS duration constructor fields', async () => {
    const source =
      '{% assign result = length | toDuration: unit %}{{ result.value }}:{{ result.type }}:{{ result.days }}';
    const input = { length: 2, unit: 'weeks' };
    const reference = evaluateReferenceProgramWithOutputs(
      referenceProgramFromIR(extractComputationIR(source)),
      input,
    );
    const liquid = await createLiquidEngine().parseAndRender(source, input);

    expect(reference.outputs.join(':')).toBe(liquid.trim());
    expect(liquid.trim()).toBe('2:WEEKS:14');
  });

  it('matches LiquidJS currency arithmetic shape', async () => {
    const source =
      '{% assign currency = amount | toCurrency: code %}{% assign total = currency | plus: fee %}{{ total.value }}:{{ total.type }}';
    const input = { amount: 10, code: 'INR', fee: 2 };
    const reference = evaluateReferenceProgramWithOutputs(
      referenceProgramFromIR(extractComputationIR(source)),
      input,
    );
    const liquid = await createLiquidEngine().parseAndRender(source, input);

    expect(reference.outputs.join(':')).toBe(liquid.trim());
    expect(liquid.trim()).toBe('12:INR');
  });

  it('matches LiquidJS sumArray and updateAttribute filters', async () => {
    const source =
      '{% assign total = rows | sumArray: "amount" %}{% assign updated = currency | updateAttribute: "type", "EUR" %}{{ total }}:{{ updated.type }}';
    const input = {
      rows: [{ amount: 2 }, { amount: 3 }],
      currency: { value: 10, type: 'INR' },
    };
    const reference = evaluateReferenceProgramWithOutputs(
      referenceProgramFromIR(extractComputationIR(source)),
      input,
    );
    const liquid = await createLiquidEngine().parseAndRender(source, input);

    expect(reference.outputs.join(':')).toBe(liquid.trim());
    expect(liquid.trim()).toBe('5:EUR');
  });

  it('matches LiquidJS output for comparison branches', async () => {
    const source =
      '{% if amount > threshold %}{% assign result = 1 %}{% else %}{% assign result = 0 %}{% endif %}{{ result }}';
    const ir = extractComputationIR(source);
    const reference = evaluateReferenceProgramWithOutputs(
      referenceProgramFromIR(ir),
      { amount: 12, threshold: 10 },
    );
    const liquid = await createLiquidEngine().parseAndRender(source, {
      amount: 12,
      threshold: 10,
    });

    expect(Number(liquid.trim())).toBe(reference.outputs[0]);
  });

  it('matches LiquidJS output for elsif branches', async () => {
    const source =
      '{% if amount > 10 %}{% assign result = 2 %}{% elsif amount > 5 %}{% assign result = 1 %}{% else %}{% assign result = 0 %}{% endif %}{{ result }}';
    const ir = extractComputationIR(source);
    const reference = evaluateReferenceProgramWithOutputs(
      referenceProgramFromIR(ir),
      { amount: 7 },
    );
    const liquid = await createLiquidEngine().parseAndRender(source, {
      amount: 7,
    });

    expect(Number(liquid.trim())).toBe(reference.outputs[0]);
  });

  it('matches LiquidJS output for null subtraction', async () => {
    const source = '{% assign total = amount | minus: 2 %}{{ total }}';
    const ir = extractComputationIR(source);
    const reference = evaluateReferenceProgramWithOutputs(
      referenceProgramFromIR(ir),
      { amount: null },
    );
    const liquid = await createLiquidEngine().parseAndRender(source, {
      amount: null,
    });

    expect(Number(liquid.trim())).toBe(reference.outputs[0]);
  });

  it('matches the shared differential fixtures for supported cases', async () => {
    const supportedIds = new Set([
      'primitive-addition',
      'null-subtraction',
      'date-subtraction',
      'date-plus-duration',
      'currency-addition',
      'parse-assign-object',
      'parse-assign-array',
      'reference-comparison-branch',
      'reference-null-left-subtraction',
      'currency-subtraction',
      'currency-multiplication',
      'currency-with-null',
      'duration-addition',
      'duration-with-null',
      'sum-array-empty',
      'sum-array-default',
      'sum-array-currencies',
      'sum-array-currency-null',
      'sum-array-durations',
      'for-loop-accumulation',
      'concat-filter',
      'uniq-filter',
      'strip-filter',
      'strip-html-filter',
    ]);
    const supported = fixtures.fixtures.filter((fixture) =>
      supportedIds.has(fixture.id),
    );

    for (const fixture of supported) {
      const ir = extractComputationIR(fixture.source);
      const reference = evaluateReferenceProgramWithOutputs(
        referenceProgramFromIR(ir),
        fixture.input,
      );
      const liquid = await createLiquidEngine().parseAndRender(
        fixture.source,
        fixture.input,
      );

      if (fixture.expected.kind === 'rendered-text') {
        expect(liquid.trim(), fixture.id).toBe(String(fixture.expected.value));
        expect(reference.outputs.join(':'), fixture.id).toBe(
          String(fixture.expected.value),
        );
      } else if (fixture.expected.kind === 'value') {
        expect(reference.outputs[0], fixture.id).toEqual(
          fixture.expected.value,
        );
      }
    }
  });
});
