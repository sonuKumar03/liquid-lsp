# liquid-core

Runtime helpers for LiquidJS: engine creation, tokenization, tag/filter metadata, syntax rules, and error normalization.

## When to use

- **LSP features** — tokenize documents, resolve filter names, enhance parser errors
- **Any Node or bundled browser context** that needs shared Liquid semantics
- **Not for** — LSP transport or variable schema parsing (see `lsp-common`, `key-pointer-schema`)

## Key exports

| Export                                    | Purpose                                               |
| ----------------------------------------- | ----------------------------------------------------- |
| `createLiquidEngine()`                    | Single entry point for a configured `Liquid` instance |
| `tokenizeTopLevel(text, engine?)`         | Top-level token stream for a template                 |
| `tokenizeTopLevelSafe(...)`               | Same as above; returns `[]` on tokenizer failure      |
| `LIQUID_TAG_NAMES`, `LIQUID_FILTER_METAS` | Tag/filter metadata for completions                   |
| `isKnownLiquidFilter(name)`               | Filter allowlist check                                |
| `getEnhancedErrorMessage(msg, lineText)`  | User-friendly syntax error messages                   |
| `convertToLiquidMath(lineText)`           | Inline math → filter quick-fix helper                 |

## Dependencies

- **Depends on:** `liquidjs`, `fastest-levenshtein`
- **Used by:** `lsp-common`

## Build & test

```bash
pnpm --filter liquid-core build
pnpm --filter liquid-core test
```

## Usage

```typescript
import {
  createLiquidEngine,
  tokenizeTopLevelSafe,
  isKnownLiquidFilter,
} from 'liquid-core';

const engine = createLiquidEngine();
const tokens = tokenizeTopLevelSafe(
  '{% assign x = 1 %}{{ x | plus: 2 }}',
  engine,
);
console.log(isKnownLiquidFilter('plus')); // true
```

---

## Developer & Architecture Reference

### 1. LiquidJS Custom Fork Details

This workspace depends on a custom LiquidJS fork `"liquidjs": "github:sonuKumar03/liquidjs"`. This fork registers custom computational worksheet tags natively:

- **`computeColumn`**: Used for worksheet column-level evaluations.
- **`assignVar`**: Custom variable assignment.
- **`parseAssign`**: JSON-RPC and schema assignment tagging.

### 2. Type-safe Tag Checking

To enable safe runtime inspections without type-casting hacks, `liquid-core` re-exports the native classes from `liquidjs`:

- `Tag`
- `IfTag`
- `UnlessTag`
- `ForTag`
- `ComputeColumnTag`

This allows files in `lsp-common` to run clean `instanceof` checks (e.g. `template instanceof ComputeColumnTag`).

### 3. API Constraints

- **Private Fields Limitation**: Do not access internal, private-like variables directly on tag objects (such as `template.table` or `template.column`). Instead, extract the arguments from the public `token.args` property (e.g., splitting by whitespace).
