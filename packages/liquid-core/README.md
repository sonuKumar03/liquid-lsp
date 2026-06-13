# liquid-core

Runtime helpers for LiquidJS: engine creation, tokenization, tag/filter metadata, syntax rules, and error normalization.

## When to use

- **LSP features** — tokenize documents, resolve filter names, enhance parser errors
- **Any Node or bundled browser context** that needs shared Liquid semantics
- **Not for** — LSP transport or variable schema parsing (see `lsp-common`, `key-pointer-schema`)

## Key exports

| Export | Purpose |
|--------|---------|
| `createLiquidEngine()` | Single entry point for a configured `Liquid` instance |
| `tokenizeTopLevel(text, engine?)` | Top-level token stream for a template |
| `tokenizeTopLevelSafe(...)` | Same as above; returns `[]` on tokenizer failure |
| `LIQUID_TAG_NAMES`, `LIQUID_FILTER_METAS` | Tag/filter metadata for completions |
| `isKnownLiquidFilter(name)` | Filter allowlist check |
| `getEnhancedErrorMessage(msg, lineText)` | User-friendly syntax error messages |
| `convertToLiquidMath(lineText)` | Inline math → filter quick-fix helper |

## Dependencies

- **Depends on:** `liquidjs`, `fastest-levenshtein`
- **Used by:** `lsp-common`

## Build & test

```bash
npm run build --workspace=liquid-core
npm run test --workspace=liquid-core
```

## Usage

```typescript
import { createLiquidEngine, tokenizeTopLevelSafe, isKnownLiquidFilter } from 'liquid-core';

const engine = createLiquidEngine();
const tokens = tokenizeTopLevelSafe('{% assign x = 1 %}{{ x | plus: 2 }}', engine);
console.log(isKnownLiquidFilter('plus')); // true
```
