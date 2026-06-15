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

export function parseType(value: unknown): LiquidType {
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
    const valObj = value as Record<string, unknown>;
    const optional = valObj.optional === true || valObj.nullable === true;
    if (valObj.type === 'dropdown' && Array.isArray(valObj.options)) {
      return {
        kind: 'dropdown',
        options: valObj.options.map((o: unknown) => String(o)),
        ...(optional ? { optional } : {}),
      };
    }
    if (
      valObj.type === 'composite' &&
      valObj.fields &&
      typeof valObj.fields === 'object'
    ) {
      const fields = new Map<string, LiquidType>();
      for (const [k, v] of Object.entries(
        valObj.fields as Record<string, unknown>,
      )) {
        fields.set(k, parseType(v));
      }
      return {
        kind: 'composite',
        fields,
        ...(optional ? { optional } : {}),
      };
    }
    if (
      typeof valObj.type === 'string' &&
      (valObj.type === 'string' ||
        valObj.type === 'number' ||
        valObj.type === 'boolean' ||
        valObj.type === 'date' ||
        valObj.type === 'currency')
    ) {
      const primType = valObj.type as
        | 'string'
        | 'number'
        | 'boolean'
        | 'date'
        | 'currency';
      if (optional) {
        return {
          kind: 'primitive',
          type: primType,
          optional: true,
        };
      }
      return primType;
    }
  }
  return 'unknown';
}

export function parseSchema(rawSchema: unknown): Map<string, LiquidType> {
  const schema = new Map<string, LiquidType>();
  if (rawSchema && typeof rawSchema === 'object' && !Array.isArray(rawSchema)) {
    for (const [k, v] of Object.entries(rawSchema as Record<string, unknown>)) {
      schema.set(k, parseType(v));
    }
  }
  return schema;
}
