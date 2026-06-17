# Developer Reference: liquid-lsp

This document is the authoritative technical reference for developers contributing to the `liquid-lsp` monorepo. It covers the architecture, data flow, key APIs, and step-by-step guides for implementing new LSP features.

---

## 1. Monorepo Layout

```
liquid-lsp/
├── packages/
│   ├── key-pointer-schema/   # Schema wire-format parsing → LiquidType
│   ├── liquid-core/          # LiquidJS engine, tokenizer, tag parsers, metadata
│   ├── lsp-common/           # All LSP feature handlers (runtime-agnostic)
│   ├── lsp-node/             # Node stdio/socket transport
│   └── lsp-browser/          # Web Worker build + Monaco client wrappers
├── lsp-engine/               # Integration test runner (spawns lsp-node)
├── express-server/           # Monaco Editor playground (localhost:3000)
└── vscode-extension/         # VS Code extension client
```

**Dependency direction** (top → bottom, no upward imports):
```
key-pointer-schema → liquid-core → lsp-common → lsp-node / lsp-browser
```

---

## 2. Core Data Types

### `LiquidType` — [`liquid-types.ts`](file:///Users/sonukumar/project/liquid-lsp/packages/key-pointer-schema/src/liquid-types.ts)

The single type representation used everywhere in the LSP:

```typescript
type LiquidType =
  | 'string' | 'number' | 'boolean' | 'date' | 'currency' | 'unknown'
  | { kind: 'primitive'; type: 'string' | 'number' | ...; optional?: boolean }
  | { kind: 'dropdown';  options: string[];                 optional?: boolean }
  | { kind: 'composite'; fields: Map<string, LiquidType>;  optional?: boolean; open?: boolean }
```

- **`open: true`** on composite means unknown extra fields are allowed (dynamic table columns, repeating groups). Property access on open composites produces `'unknown'` instead of an error.
- **`optional: true`** triggers the *"accessed on optional parent"* warning in `lifecycle.ts`.

### `ActiveVar` — [`lifecycle.ts`](file:///Users/sonukumar/project/liquid-lsp/packages/lsp-common/src/linters/lifecycle.ts)

The in-flight runtime state of a variable during lifecycle linting:

```typescript
interface ActiveVar {
  name: string;
  type: LiquidType;
  hasBeenRead: boolean;
  declarationLine: number;
  token: TagToken;
  offsetInToken: number;
}
```

---

## 3. Server Bootstrap — [`startServer.ts`](file:///Users/sonukumar/project/liquid-lsp/packages/lsp-common/src/server/startServer.ts)

`startServer(connection, deps?)` is the single runtime-agnostic entry point. It wires together:

| Component | Class / Module | Role |
|---|---|---|
| **TypeSystem** | `TypeSystem` | Holds the merged `Map<string, LiquidType>` schema |
| **DocumentManager** | `DocumentManager` | Wraps `TextDocuments`, caches token streams |
| **DiagnosticsScheduler** | `DiagnosticsScheduler` | Debounces `validateTextDocument` (150 ms) |
| **Feature handlers** | `handle*` functions | One pure function per LSP capability |

Each LSP capability registers on `connection.on*`. All handlers receive the document, schema, and token stream — no global state.

---

## 4. Diagnostics Pipeline

A document validation pass has **four sequential stages**:

```
validateTextDocument()
      │
      ├─ 1. collectSyntaxDiagnostics()      — delimiter matching, parser errors
      ├─ 2. collectLifecycleDiagnostics()   — type checking, unused vars, flow
      ├─ 3. collectEngineValidationDiagnostics() — JSON validation, compute-column checks
      └─ 4. schemaLoadErrorsToDiagnostics() — .liquid-schema.json load errors
```

### Stage 2 in Detail — `collectLifecycleDiagnostics`

This is the most important stage. It does a **single linear pass** over the top-level token stream, maintaining `activeVars: Map<string, ActiveVar>`:

1. **`assign` / `assignVar` / `parseAssign`** → calls `processExpression` or `processParseAssignExpression`, infers the resulting type, sets `activeVars`.
2. **`capture`** → sets the variable to `'string'`.
3. **`for`** → resolves the collection type, propagates element type to the loop variable.
4. **`if` / `unless` / `elsif`** → validates the condition expression.
5. **Output tokens (`{{ }}`)** → validates property accesses and filter chains.
6. **End of pass** → `checkUnusedVariables()` scans for `hasBeenRead === false`.

---

## 5. Type Inference API

### `inferTypeFromAssignValue` — [`local-variable-types.ts`](file:///Users/sonukumar/project/liquid-lsp/packages/lsp-common/src/shared/local-variable-types.ts)

Used by `extractLocalVariableTypes` (static, for completions/hover) to resolve the `LiquidType` of the right-hand side of an assignment:

```typescript
inferTypeFromAssignValue(engine, tagName, valueExpr, localTypes): LiquidType
```

**Resolution order for `parseAssign`**:
1. Raw JSON literal → `JSON.parse` → `jsonValueToLiquidType`
2. Quoted string → `evalQuotedToken` → `JSON.parse` → `jsonValueToLiquidType`
3. Variable reference → `resolveTypeForPath`
4. Falls back to `'string'` / `'unknown'`

### `resolveTypeForPath` — [`hovers.ts`](file:///Users/sonukumar/project/liquid-lsp/packages/lsp-common/src/hovers/hovers.ts)

Resolves a dot-notation path (e.g. `"user.address.zipcode"`) against a `Map<string, LiquidType>`:

```typescript
resolveTypeForPath(path: string, schema: Map<string, LiquidType>): LiquidType
```

### `jsonValueToLiquidType` — [`local-variable-types.ts`](file:///Users/sonukumar/project/liquid-lsp/packages/lsp-common/src/shared/local-variable-types.ts)

Converts a parsed JSON value into a `LiquidType`:
- JSON array of objects → `composite` (merges all object keys across all items)
- JSON object → `composite`
- Primitive → matching primitive type

---

## 6. Diagnostic Codes — [`diagnostic-codes.ts`](file:///Users/sonukumar/project/liquid-lsp/packages/lsp-common/src/shared/diagnostic-codes.ts)

All diagnostic codes are string constants in `DIAGNOSTIC_CODES`:

```typescript
UNCLOSED_DELIMITER:              'liquid.syntax.unclosed_delimiter'
UNKNOWN_FILTER:                  'liquid.filter.unknown'
EXPECTED_FILTER_NAME:            'liquid.syntax.expected_filter_name'
CONDITIONAL_ASSIGNMENT:          'liquid.syntax.conditional_assignment'
INLINE_MATH:                     'liquid.syntax.inline_math'
UNKNOWN_TAG:                     'liquid.tag.unknown'
USE_BEFORE_ASSIGN:               'liquid.linter.use_before_assign'
INVALID_PARSE_ASSIGN_JSON:       'liquid.linter.invalid_parse_assign_json'
INVALID_DYNAMIC_TABLE_COMPUTATION: 'liquid.linter.invalid_dynamic_table_computation'
// + SCHEMA_ERROR_CODES from key-pointer-schema
```

> [!IMPORTANT]
> Always use `DIAGNOSTIC_CODES.*` constants — never raw string literals — so Quick Fix handlers can match them reliably via `diagnostic.code`.

---

## 7. Tag Argument Parsers — [`chevrotain-parser.ts`](file:///Users/sonukumar/project/liquid-lsp/packages/liquid-core/src/chevrotain-parser.ts)

The Chevrotain-based parser provides **offset-aware** parsing of tag argument strings. Use these (not regex) whenever you need exact character positions for diagnostics or symbols:

| Function | Input | Output |
|---|---|---|
| `parseAssignKeyValueWithOffsets(args)` | `"price = base \| plus: 10"` | `{ key, keyStart, keyEnd, value }` |
| `parseCaptureVariableWithOffsets(args)` | `"my_var"` | `{ key, keyStart, keyEnd }` |
| `parseForLoopVariableWithOffsets(args)` | `"row in items"` | `{ key, keyStart, keyEnd, collection }` |

---

## 8. Metadata & Filter Registry — [`metadata.ts`](file:///Users/sonukumar/project/liquid-lsp/packages/liquid-core/src/metadata.ts)

```typescript
isKnownLiquidFilter(name: string): boolean
isKnownLiquidTag(name: string): boolean
getFilterDocumentation(filter: string): string   // markdown doc string
getTagDocumentation(tag: string): string
getClosestFilter(name: string): string | null    // Levenshtein spelling suggestion
getClosestTag(name: string): string | null
```

---

## 9. How-To: Add a New Diagnostic

1. **Define a code** in [`diagnostic-codes.ts`](file:///Users/sonukumar/project/liquid-lsp/packages/lsp-common/src/shared/diagnostic-codes.ts):
   ```typescript
   MY_NEW_RULE: 'liquid.linter.my_new_rule',
   ```

2. **Implement detection** — the right place depends on what you're checking:

   | What you're checking | Where to add it |
   |---|---|
   | Variable types, filter chains, loops | `collectLifecycleDiagnostics` in `lifecycle.ts` |
   | JSON validity, compute-column integrity | `collectEngineValidationDiagnostics` in `engine-validations.ts` |
   | Delimiter/syntax/parse errors | `collectSyntaxDiagnostics` in `diagnostics.ts` |

3. **Push the diagnostic**:
   ```typescript
   diagnostics.push({
     severity: DiagnosticSeverity.Error,   // or Warning
     range: { start, end },
     message: 'Human-readable explanation of the problem.',
     code: DIAGNOSTIC_CODES.MY_NEW_RULE,
     source: 'liquid-lsp-linter',
     data: { /* any payload needed by Quick Fix */ },
   });
   ```

4. **Add a test** in `lifecycle.test.ts` or `diagnostics.test.ts`.

---

## 10. How-To: Add a New Quick Fix

Quick Fixes live in [`codeactions.ts`](file:///Users/sonukumar/project/liquid-lsp/packages/lsp-common/src/codeactions/codeactions.ts). `handleCodeAction` iterates over `params.context.diagnostics` and builds `CodeAction` objects.

```typescript
// Inside the for (const diagnostic of params.context.diagnostics) loop:

if (diagnostic.code === DIAGNOSTIC_CODES.MY_NEW_RULE) {
  const range = diagnostic.range;
  const originalText = doc.getText(range);

  codeActions.push({
    title: 'Human-readable fix title',
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [params.textDocument.uri]: [
          { range, newText: `fixed_replacement_text` },
        ],
      },
    },
  });
}
```

> [!TIP]
> Pass any data the Quick Fix needs (e.g. the suggested filter name) through `diagnostic.data` when you push the diagnostic. It is available as `diagnostic.data` in `handleCodeAction`.

---

## 11. How-To: Add a New Hover Card

`handleHover` in [`hovers.ts`](file:///Users/sonukumar/project/liquid-lsp/packages/lsp-common/src/hovers/hovers.ts) detects what is under the cursor and builds a `MarkupContent` response.

To add hover info for a new token type or tag:
1. Detect the token using `getVariablePathAtPosition` or by scanning `tokens`.
2. Resolve its type with `resolveTypeForPath` or `formatLiquidType`.
3. Return:
   ```typescript
   return {
     contents: {
       kind: 'markdown',
       value: `**my_var** \`number\`\n\nYour explanation here.`,
     },
     range: { start, end },
   };
   ```

---

## 12. How-To: Add a New Completion Provider

`handleCompletion` in [`completions.ts`](file:///Users/sonukumar/project/liquid-lsp/packages/lsp-common/src/completions/completions.ts) returns `CompletionItem[]`.

To add completions for a new context:
1. Detect the cursor context (e.g. inside a tag arg, after a `.`, after a `|`).
2. Build `CompletionItem` objects:
   ```typescript
   items.push({
     label: 'fieldName',
     kind: CompletionItemKind.Field,
     detail: 'string',
     documentation: { kind: 'markdown', value: 'Description of the field.' },
   });
   ```

---

## 13. Key Conventions

> [!IMPORTANT]
> All relative imports of local `.ts` files **must** use the `.js` extension (ES module rule):
> ```typescript
> import { foo } from './utils.js';   // ✅
> import { foo } from './utils';      // ❌
> ```

> [!IMPORTANT]
> Never use `any`. Use `unknown` + type guards for untrusted values (catch blocks, JSON payloads, client params).

> [!NOTE]
> Build commands use `tsconfig.build.json` (excludes tests). The primary `tsconfig.json` includes tests for IDE context. Always run `pnpm --filter <pkg> build` after changes before running integration tests.

---

## 14. Running the Stack

```bash
# Run all unit + integration tests
rtk proxy pnpm test

# Build all packages
rtk proxy pnpm run build

# Start Monaco Editor playground (localhost:3000)
rtk proxy pnpm run start:playground

# Run linter
rtk proxy pnpm run lint

# Format code
rtk proxy pnpm run format
```
