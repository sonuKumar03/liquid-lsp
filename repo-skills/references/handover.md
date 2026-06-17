# Project Handover Document: liquid-lsp

**Prepared for**: Incoming maintenance / extension team (3–4 engineers)  
**Branch**: `feature/chevrotain-parsing`  
**Last active**: June 2026

---

## 1. What This Project Is

`liquid-lsp` is a **Language Server Protocol (LSP) implementation** for a custom dialect of LiquidJS used in computational document worksheets. Think of it as the intelligence layer that gives a text editor (VS Code, Monaco) the ability to:

- Show **type errors** when a variable of the wrong type is used in a formula
- **Autocomplete** variable names, object fields, and filter names
- Show **inline documentation** on hover
- Apply **Quick Fixes** for common mistakes (bad filter syntax, missing fallbacks)
- Generate a **document outline** of all variables and blocks

The language is used by domain experts (contract writers, finance analysts) to embed live computations into documents — not by software engineers.

> [!IMPORTANT]
> The codebase uses a **custom fork of LiquidJS** (`github:sonuKumar03/liquidjs`) — not the public npm package. Do not upgrade liquidjs to the public package without understanding the fork's custom tags (`computeColumn`, `assignVar`, `parseAssign`).

---

## 2. Monorepo Architecture

This is a **pnpm workspace** monorepo. Package manager: `pnpm`. Build tool: `tsc`. Test runner: `vitest`.

```
liquid-lsp/
│
├── packages/
│   ├── key-pointer-schema/    # Wire-format schema parser → LiquidType
│   ├── liquid-core/           # Engine, tokenizer, Chevrotain tag parsers, metadata
│   ├── lsp-common/            # ALL LSP features (runtime-agnostic, the main package)
│   ├── lsp-node/              # Node.js stdio/socket transport
│   └── lsp-browser/           # Web Worker bundle + Monaco client
│
├── lsp-engine/                # Integration test harness (spawns lsp-node binary)
├── express-server/            # Monaco Editor playground at localhost:3000
└── vscode-extension/          # VS Code extension client (launches lsp-node)
```

**Dependency direction** — no package may import from a package to its right:

```
key-pointer-schema  →  liquid-core  →  lsp-common  →  lsp-node
                                                    →  lsp-browser
```

> [!NOTE]
> `lsp-common` contains all business logic. `lsp-node` and `lsp-browser` are thin transport adapters. If you are adding a feature, you almost certainly only need to touch `lsp-common` (and possibly `liquid-core`).

---

## 3. First-Time Setup

### Prerequisites
- Node.js ≥ 20
- pnpm ≥ 10 (`npm install -g pnpm`)

### Install & Build

```bash
git clone <repo-url>
cd liquid-lsp
pnpm install
pnpm run build
```

### Run the Playground

The fastest way to test the LSP end-to-end:

```bash
pnpm run start:playground
# Open http://localhost:3000 in your browser
```

The playground runs a Monaco Editor connected to the LSP via WebSocket. You can type Liquid computation code and see diagnostics, hover, and completions live.

### Run Tests

```bash
pnpm test          # All packages
pnpm --filter lsp-common test   # Just the core package
```

### Run Linter / Formatter

```bash
pnpm run lint
pnpm run format
```

---

## 4. Key Concepts to Understand First

### 4.1 Custom Tags

The LiquidJS fork adds three computation-specific tags that the entire LSP is built around:

| Tag | Purpose | Example |
|---|---|---|
| `{% assign %}` | Standard LiquidJS variable assignment | `{% assign price = 100 %}` |
| `{% assignVar %}` | Schema-bound assignment (validates against external schema) | `{% assignVar total = price %}` |
| `{% parseAssign %}` | Parses a JSON string or raw JSON literal into a typed composite | `{% parseAssign item = '{"cost": 450}' %}` |
| `{% computeColumn %}` | Performs matrix/table column computation | `{% computeColumn "tax" = price | times: 0.18 %}` |

### 4.2 LiquidType

Everything in the LSP flows through a single type union defined in `key-pointer-schema`:

```typescript
type LiquidType =
  | 'string' | 'number' | 'boolean' | 'date' | 'currency' | 'unknown'
  | { kind: 'primitive'; type: ...; optional?: boolean }
  | { kind: 'dropdown';  options: string[] }
  | { kind: 'composite'; fields: Map<string, LiquidType>; open?: boolean }
```

- **`composite`** is the key type for JSON objects and schema objects with named fields.
- **`open: true`** means the composite allows unknown extra fields (used for dynamic table columns).
- **`optional: true`** triggers nil-propagation warnings.

### 4.3 Schema Flow

The LSP receives the variable schema from the client (editor) at initialization time:

```
Client sends initializationOptions.schema (JSON)
       ↓
TypeSystem.applyVariableSchema()
       ↓
key-pointer-schema: parseSchema() / parseKeyPointerSchema()
       ↓
Map<string, LiquidType>   (the merged schema)
       ↓
Passed into all feature handlers: completions, hover, diagnostics
```

The schema can also be updated dynamically via `workspace/updateSchema` notification at any time.

---

## 5. Codebase Tour: `lsp-common`

This is the package you will spend 90% of your time in.

```
packages/lsp-common/src/
│
├── server/
│   ├── startServer.ts          ← Main entry point, wires everything together
│   ├── type-system.ts          ← Holds + merges the variable schema
│   ├── document-manager.ts     ← TextDocuments cache + token cache
│   ├── diagnostics-scheduler.ts ← Debounces validation (150ms)
│   └── capabilities.ts         ← Declares LSP capabilities to the client
│
├── linters/
│   ├── diagnostics.ts          ← Orchestrates all 4 validation stages
│   ├── lifecycle.ts            ← Core type-checking linter (most complex file)
│   └── engine-validations.ts   ← JSON validity, compute-column checks
│
├── shared/
│   ├── local-variable-types.ts ← Static type inference (assign/parseAssign/for)
│   ├── diagnostic-codes.ts     ← All diagnostic code constants
│   ├── schema.ts               ← Re-exports LiquidType
│   └── variable-declarations.ts ← Find-all-references support
│
├── hovers/hovers.ts            ← Hover card handler
├── completions/completions.ts  ← Autocomplete handler
├── codeactions/codeactions.ts  ← Quick Fix handler
├── formatters/formatting.ts    ← Document formatting handler
├── signatures/signatures.ts    ← Signature help handler
├── symbols/symbols.ts          ← Document outline (breadcrumbs)
└── definitions/definitions.ts  ← Go-to-definition handler
```

---

## 6. How Diagnostics Work (The Most Important Flow)

```
User types in editor
       ↓
DocumentManager detects change
       ↓
DiagnosticsScheduler debounces (150ms)
       ↓
validateTextDocument()
   │
   ├─ 1. collectSyntaxDiagnostics()        — delimiter matching, parser errors
   ├─ 2. collectLifecycleDiagnostics()     — type checking (the main linter)
   ├─ 3. collectEngineValidationDiagnostics() — JSON, compute-column
   └─ 4. schemaLoadErrorsToDiagnostics()   — schema file load errors
       ↓
connection.sendDiagnostics() → editor shows squiggles
```

`collectLifecycleDiagnostics` does a **single linear pass** over the token stream maintaining an `activeVars` map. It processes each tag (`assign`, `for`, `if`, etc.) in order, building up the type state as it goes.

---

## 7. Current Branch State (`feature/chevrotain-parsing`)

This branch is the most up-to-date. Here is the history of work done:

| Commit | What Was Built |
|---|---|
| `8664c43` | JSON type inference for `parseAssign` + named parent in property errors |
| `1c88178` | Loop variable type inference from composite collections |
| `ca9f456` | Simplified `keyPointerTypeToLiquid` with lookup tables |
| `8de6bdc` | Open-ended composite types for table/repeating schema fields |
| `9b6308a` | Chevrotain-powered precise `selectionRange` in document symbols |
| `34e3aa4` | Offset-aware diagnostic ranges using Chevrotain parsers |
| `7b69719` | Chevrotain tag argument parser integration |
| `b13fad0` | Fixed duplicate filter name warnings |
| `9b7b7fe` | Diagnostic squiggle alignment fix (exact line/col) |
| `5e42112` | Split Tags toggle in playground |
| `770f294` | Consecutive tag formatting |
| `db961b3` | Quick Fixes for quoted filter names |
| `d4284f2` | String filter on number type warnings |

---

## 8. Known Gaps & Next Priorities

The following features have been **designed and documented** but not yet implemented. See [`computation_lsp_features.md`](file:///Users/sonukumar/.gemini/antigravity/brain/7d235bf2-1a3c-44c7-87c8-24811c9c45da/computation_lsp_features.md) for full specs:

| Priority | Feature | Effort |
|---|---|---|
| 🔴 High | **Automatic Coercion & Fallback Quick Fixes** — warn + fix when optional/string vars are used in math | Medium |
| 🔴 High | **Nil Propagation Diagnostics** — trace nil from optional schema fields through assignment chains | High |
| 🟡 Medium | **Rename Collision & Shadowing Prevention** — collision check before rename + external schema guard | Medium |
| 🟡 Medium | **Semantic Flow Highlighting** — color-code source/intermediate/output/dead variables | Medium |
| 🟡 Medium | **Multi-Branch Type Consistency** — warn when if/else assigns same var with different types | Medium |
| 🟡 Medium | **Filter Argument Type Checking** — validate filter parameter types at call sites | Low |
| 🟢 Low | **Plain Language Diagnostic Messages** — rewrite all errors for domain experts | Low |
| 🟢 Low | **Contextual Examples in Hover** — schema-aware examples in filter hover cards | Low |

See [`lsp_refactoring_guide.md`](file:///Users/sonukumar/.gemini/antigravity/brain/7d235bf2-1a3c-44c7-87c8-24811c9c45da/lsp_refactoring_guide.md) for planned refactoring operations (Extract Variable, Inline Variable, Sort by Dependency, etc.).

---

## 9. Coding Conventions

> [!IMPORTANT]
> **ES Module `.js` imports**: All relative imports of local TypeScript files must use the `.js` extension even though the source is `.ts`:
> ```typescript
> import { foo } from './utils.js';   // ✅ correct
> import { foo } from './utils';      // ❌ will break at runtime
> ```

> [!IMPORTANT]
> **No `any`**: The codebase enforces a strict no-`any` policy. Use `unknown` with type guards for catch blocks, JSON payloads, and client params.

> [!NOTE]
> **Two tsconfig files per package**: `tsconfig.json` (includes tests, for IDE) and `tsconfig.build.json` (excludes tests, for production build). Always build with `tsconfig.build.json`.

> [!NOTE]
> **No access to private liquidjs internals**: Only use public properties on liquidjs tag tokens. Extract data from `token.args` or public `Token` properties.

---

## 10. Testing Strategy

| Test Type | Location | How to Run |
|---|---|---|
| **Unit tests** | `packages/*/src/**/*.test.ts` | `pnpm --filter <pkg> test` |
| **Integration tests** | `packages/lsp-common/src/linters/integration.test.ts` | Spawns `lsp-engine/dist/main.js` as a child process, sends JSON-RPC over stdio |
| **Playground** | `express-server/public/index.html` | Manual testing at `localhost:3000` |

When adding a new diagnostic or quick fix, you need:
1. A **unit test** in `lifecycle.test.ts` or `diagnostics.test.ts`
2. Optionally a **playground example** in `index.html` to visually confirm

---

## 11. Suggested Team Roles

Given a team of 3–4, here is a suggested division:

| Role | Focus Areas |
|---|---|
| **LSP Core** | `lsp-common/linters/`, type inference, new diagnostics, quick fixes |
| **Language Engine** | `liquid-core/`, Chevrotain parser, tokenizer, LiquidJS fork maintenance |
| **Schema & Types** | `key-pointer-schema/`, `LiquidType`, wire-format parsing, schema evolution |
| **DX / Playground** | `express-server/`, `vscode-extension/`, Monaco integration, playground examples |

---

## 12. Quick Reference Commands

```bash
pnpm install                          # Install all dependencies
pnpm run build                        # Build all packages
pnpm test                             # Run all tests
pnpm run start:playground             # Start playground at localhost:3000
pnpm run lint                         # Run ESLint
pnpm run format                       # Run Prettier
pnpm --filter lsp-common test         # Test only lsp-common
pnpm --filter liquid-core build       # Build only liquid-core
pnpm run package:extension            # Build the VS Code .vsix extension
```

---

## 13. Reference Documents

| Document | Purpose |
|---|---|
| [`AGENTS.md`](file:///Users/sonukumar/project/liquid-lsp/AGENTS.md) | Master architecture overview and coding conventions |
| [`developer_reference.md`](file:///Users/sonukumar/.gemini/antigravity/brain/7d235bf2-1a3c-44c7-87c8-24811c9c45da/developer_reference.md) | Deep technical API reference for all key functions |
| [`computation_lsp_features.md`](file:///Users/sonukumar/.gemini/antigravity/brain/7d235bf2-1a3c-44c7-87c8-24811c9c45da/computation_lsp_features.md) | Planned LSP feature roadmap (8 features, fully specced) |
| [`lsp_refactoring_guide.md`](file:///Users/sonukumar/.gemini/antigravity/brain/7d235bf2-1a3c-44c7-87c8-24811c9c45da/lsp_refactoring_guide.md) | Planned refactoring operations (10 refactors, fully specced) |
| [`packages/lsp-common/README.md`](file:///Users/sonukumar/project/liquid-lsp/packages/lsp-common/README.md) | lsp-common package reference |
| [`packages/liquid-core/README.md`](file:///Users/sonukumar/project/liquid-lsp/packages/liquid-core/README.md) | liquid-core package reference |
