import { describe, expect, it } from 'vitest';
import {
  evaluateReferenceProgram,
  formatFieldValue,
  parseReferenceProgram,
} from './reference-language.js';

describe('reference computation language', () => {
  it('evaluates if/else with plus and minus', () => {
    const program = parseReferenceProgram(`
      if enabled {
        result = amount plus adjustment;
      } else {
        result = amount - adjustment;
      }
    `);

    expect(
      evaluateReferenceProgram(program, {
        enabled: true,
        amount: 10,
        adjustment: 2,
      }),
    ).toEqual({ enabled: true, amount: 10, adjustment: 2, result: 12 });
    expect(
      evaluateReferenceProgram(program, {
        enabled: false,
        amount: 10,
        adjustment: 2,
      }),
    ).toEqual({ enabled: false, amount: 10, adjustment: 2, result: 8 });
  });

  it('applies LiquidJS scalar null rules for addition and subtraction', () => {
    const program = parseReferenceProgram(`
      addResult = amount + missing;
      subtractResult = missing - amount;
      aliasAdd = amount add 1;
      aliasSubtract = amount subtract 1;
    `);

    expect(evaluateReferenceProgram(program, { amount: 10 })).toEqual({
      amount: 10,
      addResult: 10,
      subtractResult: -10,
      aliasAdd: 11,
      aliasSubtract: 9,
    });
  });

  it('resolves property paths and indexes in expressions', () => {
    const program = parseReferenceProgram(
      'result = contract.amount + rows[1].amount;',
    );

    expect(
      evaluateReferenceProgram(program, {
        contract: { amount: 10 },
        rows: [{ amount: 2 }, { amount: 3 }],
      }),
    ).toEqual({
      contract: { amount: 10 },
      rows: [{ amount: 2 }, { amount: 3 }],
      result: 13,
    });
  });

  it('uses comparison expressions to choose an if branch', () => {
    const program = parseReferenceProgram(`
      if contract.amount >= 100 {
        result = "large";
      } else {
        result = "small";
      }
    `);

    expect(
      evaluateReferenceProgram(program, { contract: { amount: 125 } }).result,
    ).toBe('large');
    expect(
      evaluateReferenceProgram(program, { contract: { amount: 25 } }).result,
    ).toBe('small');
  });

  it('evaluates currency and duration constructors', () => {
    const program = parseReferenceProgram(`
      currency = toCurrency(amount, code);
      duration = toDuration(length, unit);
    `);

    expect(
      evaluateReferenceProgram(program, {
        amount: 10,
        code: 'INR',
        length: 2,
        unit: 'weeks',
      }),
    ).toEqual({
      amount: 10,
      code: 'INR',
      length: 2,
      unit: 'weeks',
      currency: { value: 10, type: 'INR' },
      duration: { value: 2, type: 'WEEKS', days: 14 },
    });
  });

  it('preserves domain object shape during arithmetic', () => {
    const program = parseReferenceProgram(`
      currency = toCurrency(amount, code);
      total = currency + fee;
      duration = toDuration(length, unit);
      elapsed = duration + toDuration(extra, "days");
    `);

    expect(
      evaluateReferenceProgram(program, {
        amount: 10,
        code: 'INR',
        fee: 2,
        length: 2,
        unit: 'weeks',
        extra: 3,
      }),
    ).toMatchObject({
      total: { value: 12, type: 'INR' },
      elapsed: { value: 17, type: 'DAYS', days: 17 },
    });
  });

  it('evaluates array aggregation and attribute updates', () => {
    const program = parseReferenceProgram(`
      total = sumArray(rows, "amount");
      updated = updateAttribute(currency, "type", "EUR");
      typed = updateTypeAttribute(currency, "GBP");
    `);

    expect(
      evaluateReferenceProgram(program, {
        rows: [{ amount: 2 }, { amount: 3 }],
        currency: { value: 10, type: 'INR' },
      }),
    ).toMatchObject({
      total: 5,
      updated: { value: 10, type: 'EUR' },
      typed: { value: 10, type: 'GBP' },
    });
  });

  it('gets a named column from table rows', () => {
    const program = parseReferenceProgram(
      'amounts = GetColumn(rows, "amount");',
    );

    expect(
      evaluateReferenceProgram(program, {
        rows: [{ amount: 2 }, { amount: 3 }, { label: 'missing' }],
      }),
    ).toEqual({
      rows: [{ amount: 2 }, { amount: 3 }, { label: 'missing' }],
      amounts: [2, 3, undefined],
    });
  });

  it('evaluates Specter-style conditional and presence functions', () => {
    const program = parseReferenceProgram(`
      result = If(Exists(amount), amount, 0);
      valid = And(Exists(amount), Not(Equals(status, "")));
    `);

    expect(
      evaluateReferenceProgram(program, { amount: 12, status: 'ready' }),
    ).toEqual({
      amount: 12,
      status: 'ready',
      result: 12,
      valid: true,
    });
    expect(evaluateReferenceProgram(program, { status: '' })).toEqual({
      status: '',
      result: 0,
      valid: false,
    });
  });

  it('validates assignment results against field schema types', () => {
    const program = parseReferenceProgram('total = amount + fee;');

    expect(() =>
      evaluateReferenceProgram(
        program,
        {
          amount: 10,
          fee: 2,
        },
        {
          total: { type: 'currency' },
        },
      ),
    ).toThrow('Field total expects currency');
  });

  it('evaluates object and array literals', () => {
    const program = parseReferenceProgram(`
      item = { cost: 450, tax: 50 };
      list = [10, 20, 30];
      cost = item.cost;
      second = list[1];
    `);

    expect(evaluateReferenceProgram(program, {})).toEqual({
      item: { cost: 450, tax: 50 },
      list: [10, 20, 30],
      cost: 450,
      second: 20,
    });
  });

  it('evaluates date subtraction and date plus duration', () => {
    const program = parseReferenceProgram(`
      diff = Subtract(end, start);
      next = Add(start, duration);
    `);

    expect(
      evaluateReferenceProgram(program, {
        start: '2020-01-01',
        end: '2020-03-01',
        duration: { value: 20, type: 'DAYS', days: 20 },
      }),
    ).toEqual({
      start: '2020-01-01',
      end: '2020-03-01',
      duration: { value: 20, type: 'DAYS', days: 20 },
      diff: { type: 'DAYS', value: 60, days: 60 },
      next: '2020-01-21T00:00:00.000Z',
    });
  });

  it('evaluates sumArray edge cases: empty arrays, defaults, and null propagation', () => {
    const program = parseReferenceProgram(`
      empty = sumArray(emptyRows, "amount");
      withDefault = sumArray(emptyRows, "amount", 100);
      currencies = sumArray(currencyRows, "price");
      withNull = sumArray(nullRows, "price");
    `);

    expect(
      evaluateReferenceProgram(program, {
        emptyRows: [],
        currencyRows: [
          { price: { value: 1000, type: 'INR' } },
          { price: { value: 250, type: 'INR' } },
        ],
        nullRows: [{ price: { value: 1000, type: 'INR' } }, { price: null }],
      }),
    ).toEqual({
      emptyRows: [],
      currencyRows: [
        { price: { value: 1000, type: 'INR' } },
        { price: { value: 250, type: 'INR' } },
      ],
      nullRows: [{ price: { value: 1000, type: 'INR' } }, { price: null }],
      empty: 0,
      withDefault: 100,
      currencies: { value: 1250, type: 'INR' },
      withNull: null,
    });
  });

  it('evaluates for loops with accumulator mutations', () => {
    const program = parseReferenceProgram(`
      total = 0;
      for item in items {
        total = total + item;
      }
    `);

    expect(evaluateReferenceProgram(program, { items: [1, 2, 3, 4] })).toEqual({
      items: [1, 2, 3, 4],
      item: 4,
      total: 10,
    });
  });

  it('evaluates concat, uniq, strip, and strip_html filters', () => {
    const program = parseReferenceProgram(`
      combined = concat(a, b);
      unique = uniq(combined);
      trimmed = strip(text);
      clean = strip_html(html);
    `);

    expect(
      evaluateReferenceProgram(program, {
        a: ['x', 'y'],
        b: ['y', 'z'],
        text: '   hello world   ',
        html: '<div>Hello <b>world</b></div>',
      }),
    ).toEqual({
      a: ['x', 'y'],
      b: ['y', 'z'],
      text: '   hello world   ',
      html: '<div>Hello <b>world</b></div>',
      combined: ['x', 'y', 'y', 'z'],
      unique: ['x', 'y', 'z'],
      trimmed: 'hello world',
      clean: 'Hello world',
    });
  });

  it('validates currency metadata from field schema', () => {
    const program = parseReferenceProgram(
      'settlement = toCurrency(amount, currency);',
    );

    expect(() =>
      evaluateReferenceProgram(
        program,
        {
          amount: 12,
          currency: 'INR',
        },
        {
          settlement: { type: 'currency', currency: 'EUR' },
        },
      ),
    ).toThrow('Field settlement expects currency EUR');
  });

  it('validates number ranges and dropdown options from field schemas', () => {
    const program = parseReferenceProgram(`
      term = 1500;
      position = "invalid_option";
    `);

    expect(() =>
      evaluateReferenceProgram(
        program,
        {},
        {
          term: { type: 'number', minValue: 0, maxValue: 1200 },
        },
      ),
    ).toThrow('Field term expects number');

    expect(() =>
      evaluateReferenceProgram(
        program,
        {},
        {
          position: {
            type: 'dropdown',
            options: [
              { label: 'SDR', value: '0' },
              { label: 'Lead', value: '1' },
            ],
          },
        },
      ),
    ).toThrow('Field position expects dropdown');
  });

  it('formats field values according to format_option schemas', () => {
    expect(
      formatFieldValue(
        { value: 1234.567, type: 'USD' },
        {
          type: 'currency',
          precision: 2,
          isIsoPrefixEnabled: true,
        },
      ),
    ).toBe('USD 1234.57');

    expect(
      formatFieldValue(
        { value: 500, type: 'EUR' },
        {
          type: 'currency',
          precision: 0,
          isIsoPrefixEnabled: false,
        },
      ),
    ).toBe('500');

    expect(
      formatFieldValue(
        { value: 3, type: 'MONTHS', days: 90 },
        {
          type: 'duration',
        },
      ),
    ).toBe('3 Months');

    expect(
      formatFieldValue(45.678, {
        type: 'number',
        precision: 1,
      }),
    ).toBe('45.7');

    expect(
      formatFieldValue('1', {
        type: 'dropdown',
        options: [{ label: 'Team Lead', value: '1' }],
      }),
    ).toBe('Team Lead');
  });
});
