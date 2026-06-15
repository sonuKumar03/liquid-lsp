# AGENTS.md - Monorepo Master Roadmap & Developer Guide

Welcome, developer or AI agent! This repository contains a specialized Language Server Protocol (LSP) implementation for LiquidJS computational worksheets.

This document serves as the master roadmap. For specific code documentation, refer to the local `README.md` inside each workspace directory.

---

## Monorepo Architecture

This project is organized as a monorepo using **pnpm workspaces**. It consists of 5 core libraries under `packages/` and 3 application/wrapper projects:

```
                  ┌────────────────────────┐
                  │  key-pointer-schema    │
                  └───────────┬────────────┘
                              │ Types & Mapping
                              ▼
                  ┌────────────────────────┐
                  │      liquid-core       │
                  └───────────┬────────────┘
                              │ Lexical & Parsing
                              ▼
                  ┌────────────────────────┐
                  │       lsp-common       │
                  └───────────┬────────────┘
                              │ Core Handlers
             ┌────────────────┴────────────────┐
             ▼                                 ▼
┌────────────────────────┐        ┌────────────────────────┐
│        lsp-node        │        │      lsp-browser       │
└────────────┬───────────┘        └────────────┬───────────┘
             │ Node Engine                     │ Browser Worker
             ▼                                 ▼
┌────────────────────────┐        ┌────────────────────────┐
│       lsp-engine       │        │     express-server     │
└────────────┬───────────┘        └────────────────────────┘
             │ Server Bundle
             ▼
┌────────────────────────┐
│    vscode-extension    │
└────────────────────────┘
```

### 1. Libraries (`packages/*`)

- [**`key-pointer-schema`**](file:///Users/sonukumar/project/liquid-lsp/packages/key-pointer-schema/README.md): Parses, validates, and merges client-supplied variable schemas in various wire formats.
- [**`liquid-core`**](file:///Users/sonukumar/project/liquid-lsp/packages/liquid-core/README.md): Integrates our custom fork of LiquidJS, implements computational tags (`computeColumn`, `assignVar`, `parseAssign`), parses expressions, and exports tokenization utilities.
- [**`lsp-common`**](file:///Users/sonukumar/project/liquid-lsp/packages/lsp-common/README.md): Contains the core runtime-agnostic language server features (hover, completions, signature help, code actions, diagnostics, etc.) and state management (`TypeSystem`, `DocumentManager`).
- [**`lsp-node`**](file:///Users/sonukumar/project/liquid-lsp/packages/lsp-node/README.md): Node-specific transport layer (stdio/socket JSON-RPC) and workspace schema filesystem loader.
- [**`lsp-browser`**](file:///Users/sonukumar/project/liquid-lsp/packages/lsp-browser/README.md): Web Worker build config and client wrappers for running the LSP server inside browser environments (e.g. Monaco Editor).

### 2. Applications & Wrappers

- [**`lsp-engine`**](file:///Users/sonukumar/project/liquid-lsp/lsp-engine/README.md): Legacy npm workspace wrapper used to compile the node server and run integration tests.
- [**`vscode-extension`**](file:///Users/sonukumar/project/liquid-lsp/vscode-extension/README.md): The VS Code extension client wrapper contributing configurations and launching the server process.
- [**`express-server`**](file:///Users/sonukumar/project/liquid-lsp/express-server/README.md): Local development express server hosting the web-based Monaco Editor playground.

---

## Coding Conventions & Constraints

All workspaces adhere to the following rules:

1. **ES Modules (`type: module`)**:
   - Relative imports of local TypeScript files **must** include the `.js` extension (e.g. `import { x } from './utils.js';`).
2. **TSConfig Restructuring**:
   - Primary `tsconfig.json` files must include all test and utility files to ensure IDE context and type-checking remain functional.
   - Separate `tsconfig.build.json` files must be used for compilation builds (excluding test/utility files). Production build scripts run `tsc -p tsconfig.build.json`.
3. **No Unsafe Casts (`any`)**:
   - We enforce a **strict no `any` policy**. Use `unknown` and type guards (e.g. `isLiquidParserError(err)`) to type-safely inspect untrusted values, catch block errors, and client JSON payloads.
4. **AST / Parser Access**:
   - Avoid accessing private properties on `liquidjs` tag objects. Extract properties from the public `token.args` or public `Token` properties to remain compile-safe.

---

## Core Developer Commands

Run all workspace commands from the repository root:

- **Build all packages**: `pnpm run build`
- **Run all unit tests**: `pnpm run test` (or `pnpm -r test`)
- **Run linter**: `pnpm run lint`
- **Format code**: `pnpm run format`
- **Start Playground**: `pnpm run start:playground` (starts the playground express server at http://localhost:3000)

> [!IMPORTANT]
> **Token Optimization**: Always run git/development commands prefixed with `rtk` (e.g., `rtk proxy pnpm test`) to optimize LLM/dev context token usage.
