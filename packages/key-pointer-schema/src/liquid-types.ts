export type LiquidType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'currency'
  | {
      kind: 'primitive';
      type: 'string' | 'number' | 'boolean' | 'date' | 'currency';
      optional?: boolean;
    }
  | { kind: 'dropdown'; options: string[]; optional?: boolean }
  | { kind: 'composite'; fields: Map<string, LiquidType>; optional?: boolean }
  | 'unknown';

export function parseType(value: any): LiquidType {
  if (typeof value === 'string') {
    if (
      value === 'string' ||
      value === 'number' ||
      value === 'boolean' ||
      value === 'date' ||
      value === 'currency'
    ) {
      return value;
    }
    return 'unknown';
  }
  if (value && typeof value === 'object') {
    const optional = value.optional === true || value.nullable === true;
    if (value.type === 'dropdown' && Array.isArray(value.options)) {
      return {
        kind: 'dropdown',
        options: value.options.map((o: any) => String(o)),
        ...(optional ? { optional } : {}),
      };
    }
    if (
      value.type === 'composite' &&
      value.fields &&
      typeof value.fields === 'object'
    ) {
      const fields = new Map<string, LiquidType>();
      for (const [k, v] of Object.entries(value.fields)) {
        fields.set(k, parseType(v));
      }
      return {
        kind: 'composite',
        fields,
        ...(optional ? { optional } : {}),
      };
    }
    if (
      typeof value.type === 'string' &&
      (value.type === 'string' ||
        value.type === 'number' ||
        value.type === 'boolean' ||
        value.type === 'date' ||
        value.type === 'currency')
    ) {
      if (optional) {
        return {
          kind: 'primitive',
          type: value.type as any,
          optional: true,
        };
      }
      return value.type;
    }
  }
  return 'unknown';
}

export function parseSchema(rawSchema: any): Map<string, LiquidType> {
  const schema = new Map<string, LiquidType>();
  if (rawSchema && typeof rawSchema === 'object') {
    for (const [k, v] of Object.entries(rawSchema)) {
      schema.set(k, parseType(v));
    }
  }
  return schema;
}
