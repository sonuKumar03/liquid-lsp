export type LiquidType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'currency'
  | { kind: 'dropdown'; options: string[] }
  | { kind: 'composite'; fields: Map<string, LiquidType> }
  | 'unknown';

export function parseType(value: any): LiquidType {
  if (typeof value === 'string') {
    if (value === 'string' || value === 'number' || value === 'boolean' || value === 'date' || value === 'currency') {
      return value;
    }
    return 'unknown';
  }
  if (value && typeof value === 'object') {
    if (value.type === 'dropdown' && Array.isArray(value.options)) {
      return { kind: 'dropdown', options: value.options.map((o: any) => String(o)) };
    }
    if (value.type === 'composite' && value.fields && typeof value.fields === 'object') {
      const fields = new Map<string, LiquidType>();
      for (const [k, v] of Object.entries(value.fields)) {
        fields.set(k, parseType(v));
      }
      return { kind: 'composite', fields };
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
