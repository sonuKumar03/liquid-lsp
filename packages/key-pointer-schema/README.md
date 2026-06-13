# key-pointer-schema

Parse and validate key-pointer variable declarations for Liquid computation worksheets. Maps each `data_type` to an internal `LiquidType` used by the LSP for type checking and completions.

## When to use

- **LSP server** — load client variable schemas via `initializationOptions` or `workspace/updateSchema`
- **Angular / backend** — validate variable payloads before sending them to the LSP (share the same allowlist and parsing rules)
- **Not for** — runtime Liquid rendering (use `liquidjs` directly)

## Key exports

| Export | Purpose |
|--------|---------|
| `parseVariableSchema(raw)` | Parse `{ variables: [...] }`, flat map, or legacy liquid schema |
| `mergeVariableSchemas(base, overlay)` | Merge client schema with workspace file overlay |
| `keyPointerTypeToLiquid(dataType, options?)` | Map key-pointer type → `LiquidType` |
| `isKnownKeyPointerDataType(value)` | Check against the 19-type allowlist |
| `KNOWN_KEY_POINTER_DATA_TYPES` | Fixed type list |
| `SCHEMA_ERROR_CODES` | Stable error code strings for diagnostics |

## Dependencies

- **Depends on:** Node.js `fs` (registry loader only; not required for parsing)
- **Used by:** `liquid-core` (indirect), `lsp-common`, Angular apps (optional)

## Build & test

```bash
npm run build --workspace=key-pointer-schema
npm run test --workspace=key-pointer-schema
```

## Usage

```typescript
import { parseVariableSchema } from 'key-pointer-schema';

const result = parseVariableSchema({
  variables: [
    { field_name: 'sd_payment', data_type: 'currency' },
    { field_name: 'sd_term_type', data_type: 'dropdown', options: [{ label: 'Fixed', value: 'Fixed' }] },
  ],
});

if (result.errors.length === 0) {
  console.log(result.liquidSchema.get('sd_payment')); // 'currency'
}
```
