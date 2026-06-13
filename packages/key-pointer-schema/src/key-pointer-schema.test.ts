import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  mergeVariableSchemas,
  parseVariableSchema,
  SCHEMA_ERROR_CODES,
} from './index.js';
import {
  isKnownKeyPointerDataType,
  KNOWN_KEY_POINTER_DATA_TYPES,
  loadTypeRegistry,
  supportsKeyPointerComputation,
} from './key-pointer-types.js';
import { keyPointerTypeToLiquid } from './key-pointer-to-liquid.js';

const packageRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

describe('key-pointer-types', () => {
  it('loads the bundled type registry', () => {
    const registry = loadTypeRegistry();
    expect(registry.size).toBe(KNOWN_KEY_POINTER_DATA_TYPES.length);
  });

  it('rejects unknown type strings', () => {
    expect(isKnownKeyPointerDataType('currency')).toBe(true);
    expect(isKnownKeyPointerDataType('bogus')).toBe(false);
  });

  it('reports computation support from the type registry', () => {
    expect(supportsKeyPointerComputation('currency')).toBe(true);
    expect(supportsKeyPointerComputation('address')).toBe(false);
    expect(supportsKeyPointerComputation('rich-text')).toBe(false);
  });
});

describe('parseVariableSchema', () => {
  it('parses variables array with known types', () => {
    const result = parseVariableSchema({
      variables: [
        { field_name: 'sd_payment', data_type: 'currency' },
        {
          field_name: 'sd_term_type',
          data_type: 'dropdown',
          options: [
            { label: 'Perpetual', value: 'Perpetual' },
            { label: 'Fixed', value: 'Fixed' },
          ],
        },
      ],
    });

    expect(result.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
    expect(result.variables.size).toBe(2);
    expect(result.liquidSchema.get('sd_payment')).toBe('currency');
    expect(result.liquidSchema.get('sd_term_type')).toEqual({
      kind: 'dropdown',
      options: ['Perpetual', 'Fixed'],
    });
  });

  it('parses flat key-pointer map', () => {
    const result = parseVariableSchema({
      sd_payment: 'currency',
      sd_term_length: 'duration',
    });

    expect(result.variables.size).toBe(2);
    expect(result.variables.get('sd_payment')?.data_type).toBe('currency');
    expect(result.variables.get('sd_term_length')?.data_type).toBe('duration');
  });

  it('parses bundled fixture file', () => {
    const fixturePath = join(packageRoot, 'fixtures', 'key-pointer-variables.json');
    const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const result = parseVariableSchema(raw);

    expect(result.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
    expect(result.variables.size).toBe(4);
    expect(result.variables.get('sd_payment')?.data_type).toBe('currency');
    expect(result.variables.get('effective_execution_same')?.data_type).toBe(
      'check-box',
    );
  });

  it('errors on unknown data_type', () => {
    const result = parseVariableSchema({
      variables: [{ field_name: 'custom_field', data_type: 'bogus' }],
    });

    expect(result.variables.size).toBe(0);
    expect(result.errors).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: SCHEMA_ERROR_CODES.UNKNOWN_KEY_POINTER_TYPE,
        field_name: 'custom_field',
      }),
    ]);
  });

  it('errors on duplicate field_name', () => {
    const result = parseVariableSchema({
      variables: [
        { field_name: 'sd_payment', data_type: 'currency' },
        { field_name: 'sd_payment', data_type: 'number' },
      ],
    });

    expect(result.variables.size).toBe(1);
    expect(
      result.errors.some((e) => e.code === SCHEMA_ERROR_CODES.DUPLICATE_VARIABLE),
    ).toBe(true);
  });

  it('supports legacy liquid schema objects', () => {
    const result = parseVariableSchema({
      user: {
        type: 'composite',
        fields: {
          first_name: 'string',
        },
      },
    });

    expect(result.usedLegacyLiquidSchema).toBe(true);
    expect(result.variables.size).toBe(0);
    expect(result.liquidSchema.get('user')).toEqual({
      kind: 'composite',
      fields: new Map([['first_name', 'string']]),
    });
  });

  it('warns when dropdown has no options', () => {
    const result = parseVariableSchema({
      variables: [{ field_name: 'sd_term_type', data_type: 'dropdown' }],
    });

    expect(result.variables.size).toBe(1);
    expect(result.errors.some((e) => e.severity === 'warning')).toBe(true);
  });
});

describe('mergeVariableSchemas', () => {
  it('merges variables from base and overlay', () => {
    const base = parseVariableSchema({
      variables: [{ field_name: 'sd_payment', data_type: 'currency' }],
    });
    const overlay = parseVariableSchema({
      variables: [{ field_name: 'sd_term_length', data_type: 'duration' }],
    });
    const merged = mergeVariableSchemas(base, overlay);

    expect(merged.variables.size).toBe(2);
    expect(merged.liquidSchema.get('sd_payment')).toBe('currency');
    expect(merged.liquidSchema.get('sd_term_length')).toEqual({
      kind: 'composite',
      fields: new Map([
        ['value', 'number'],
        ['type', 'string'],
        ['days', 'number'],
      ]),
    });
  });

  it('errors when overlay duplicates a base variable', () => {
    const base = parseVariableSchema({
      variables: [{ field_name: 'sd_payment', data_type: 'currency' }],
    });
    const overlay = parseVariableSchema({
      variables: [{ field_name: 'sd_payment', data_type: 'number' }],
    });
    const merged = mergeVariableSchemas(base, overlay);

    expect(merged.variables.size).toBe(1);
    expect(
      merged.errors.some((e) => e.code === SCHEMA_ERROR_CODES.DUPLICATE_VARIABLE),
    ).toBe(true);
  });
});

describe('keyPointerTypeToLiquid', () => {
  it('maps duration to composite fields', () => {
    const liquidType = keyPointerTypeToLiquid('duration');
    expect(liquidType).toEqual({
      kind: 'composite',
      fields: new Map([
        ['value', 'number'],
        ['type', 'string'],
        ['days', 'number'],
      ]),
    });
  });

  it('maps currency to liquid currency primitive', () => {
    expect(keyPointerTypeToLiquid('currency')).toBe('currency');
  });
});
