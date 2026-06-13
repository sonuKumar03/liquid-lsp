import { describe, expect, it, vi } from 'vitest';
import { DIAGNOSTIC_CODES } from '../shared/diagnostic-codes.js';
import { TypeSystem } from './type-system.js';

describe('TypeSystem', () => {
  it('applies variable schema and exposes liquid types', () => {
    const typeSystem = new TypeSystem();
    typeSystem.applyVariableSchema({
      variables: [{ field_name: 'sd_payment', data_type: 'currency' }],
    });

    expect(typeSystem.getLiquidSchema().get('sd_payment')).toBe('currency');
    expect(typeSystem.getSchemaLoadErrors()).toHaveLength(0);
  });

  it('records unknown data_type as schema load errors', () => {
    const typeSystem = new TypeSystem();
    typeSystem.applyVariableSchema({
      variables: [{ field_name: 'bad', data_type: 'bogus' }],
    });

    expect(typeSystem.getLiquidSchema().size).toBe(0);
    expect(
      typeSystem
        .getSchemaLoadErrors()
        .some((e) => e.code === DIAGNOSTIC_CODES.UNKNOWN_KEY_POINTER_TYPE),
    ).toBe(true);
  });

  it('logs schema errors through the configured logger', () => {
    const error = vi.fn();
    const typeSystem = new TypeSystem({ log: vi.fn(), error });
    typeSystem.applyVariableSchema({
      variables: [{ field_name: 'bad', data_type: 'bogus' }],
    });

    expect(error).toHaveBeenCalled();
  });
});
