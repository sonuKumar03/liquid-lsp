# key-pointer-schema

Parse and validate key-pointer variable declarations for Liquid computation worksheets. Maps each `data_type` to an internal `LiquidType` used by the LSP for type checking and completions.

## When to use

- **LSP server** — load client variable schemas via `initializationOptions` or `workspace/updateSchema`
- **Angular / backend** — validate variable payloads before sending them to the LSP (share the same allowlist and parsing rules)
- **Not for** — runtime Liquid rendering (use `liquidjs` directly)

## Key exports

| Export                                       | Purpose                                                         |
| -------------------------------------------- | --------------------------------------------------------------- |
| `parseVariableSchema(raw)`                   | Parse `{ variables: [...] }`, flat map, or legacy liquid schema |
| `mergeVariableSchemas(base, overlay)`        | Merge client schema with workspace file overlay                 |
| `keyPointerTypeToLiquid(dataType, options?)` | Map key-pointer type → `LiquidType`                             |
| `isKnownKeyPointerDataType(value)`           | Check against the 19-type allowlist                             |
| `KNOWN_KEY_POINTER_DATA_TYPES`               | Fixed type list                                                 |
| `SCHEMA_ERROR_CODES`                         | Stable error code strings for diagnostics                       |

## Dependencies

- **Depends on:** Node.js `fs` (registry loader only; not required for parsing)
- **Used by:** `liquid-core` (indirect), `lsp-common`, Angular apps (optional)

## Build & test

```bash
pnpm --filter key-pointer-schema build
pnpm --filter key-pointer-schema test
```

## Usage

```typescript
import { parseVariableSchema } from 'key-pointer-schema';

const result = parseVariableSchema({
  variables: [
    { field_name: 'sd_payment', data_type: 'currency' },
    {
      field_name: 'sd_term_type',
      data_type: 'dropdown',
      options: [{ label: 'Fixed', value: 'Fixed' }],
    },
  ],
});

if (result.errors.length === 0) {
  console.log(result.liquidSchema.get('sd_payment')); // 'currency'
}
```

---

## Developer & Architecture Reference

### 1. Supported Wire Formats

`parseVariableSchema(raw: unknown)` accepts three wire formats:

- **Variables Array Format**:
  ```json
  {
    "variables": [
      { "field_name": "my_var", "data_type": "string", "options": [] }
    ]
  }
  ```
- **Flat Map Format**:
  ```json
  {
    "sd_payment": "currency",
    "sd_term_length": "duration"
  }
  ```
- **Legacy Liquid Schema Format**:
  ```json
  {
    "user": {
      "type": "composite",
      "fields": {
        "id": "number",
        "name": "string"
      }
    }
  }
  ```

### 2. Type Mapping Table

We map 19 key-pointer data types to internal LSP `LiquidType` markers:

- `string`, `text-box`, `rich-text`, `image` → `'string'`
- `number` → `'number'`
- `check-box` → `'boolean'`
- `date`, `date-range` → `'date'`
- `currency` → `'currency'`
- `dropdown` → `{ kind: 'dropdown', options: string[] }`
- `duration` → `{ kind: 'composite', fields: { value: 'number', type: 'string', days: 'number' } }`
- `address` → `{ kind: 'composite', fields: { street: 'string', city_name: 'string', pincode: 'string', ... } }`
- `phone-number` → `{ kind: 'composite', fields: { number: 'string', code: 'string', ... } }`
- `multi-file` → `{ kind: 'composite', fields: { name: 'string', id: 'string', sizeBytes: 'number' } }`

### 3. Implementation Details

- **Strict type narrowing**: `parseType` and `parseSchema` take `unknown` and perform strict type-guards to parse values safely, avoiding `any` completely.
- **Type registry**: A detailed list of capabilities for each type is loaded from [key-pointer-types.registry.json](file:///Users/sonukumar/project/liquid-lsp/packages/key-pointer-schema/src/key-pointer-types.registry.json).
