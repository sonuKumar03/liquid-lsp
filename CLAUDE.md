# CLAUDE.md - Project Context & Developer Guide

Repository skill for code changes: [repo-skills/liquidjs-v3-core-lsp/SKILL.md](repo-skills/liquidjs-v3-core-lsp/SKILL.md)

## Project Overview

This repository contains a specialized Language Server Protocol (LSP) implementation for LiquidJS computational worksheets. The project is organized as a monorepo using **pnpm workspaces**:

### 1. Libraries (`packages/*`)
- **`key-pointer-schema`**: Parses, validates, and merges client-supplied variable schemas.
- **`liquid-core`**: Integrates our custom fork of LiquidJS, implements computational tags (`computeColumn`, `assignVar`, `parseAssign`), parses expressions, and exports tokenization utilities.
- **`lsp-common`**: Contains the core runtime-agnostic language server features (hover, completions, signature help, code actions, diagnostics, etc.) and state management.
- **`lsp-node`**: Node-specific transport layer (stdio/socket JSON-RPC) and workspace schema filesystem loader.
- **`lsp-browser`**: Web Worker build config and client wrappers for running the LSP server inside browser environments (e.g. Monaco Editor).

### 2. Applications & Wrappers
- **`lsp-engine`**: Legacy npm workspace wrapper used to compile the node server and run integration tests.
- **`vscode-extension`**: The VS Code extension client wrapper contributing configurations and launching the server process.
- **`express-server`**: Local development express server hosting the web-based Monaco Editor playground.
- **`angular-playground`**: Local development Angular web client playground integrating Monaco Editor with the in-browser Worker LSP.

---

## Core Developer Commands

All workspace commands should be run from the repository root:

- **Build Project**: `pnpm run build`
  - Compiles packages and wrappers into their respective `dist/` or build directories.
- **Run Linter**: `pnpm run lint` (runs ESLint recursively).
- **Format Code**: `pnpm run format` (runs Prettier).
- **Run Test Suite**: `pnpm run test` (runs Vitest test runner across workspaces).
- **Start Playground**: `pnpm run start:playground` (starts the playground express server at http://localhost:3000).

---

## Project Structure

```
├── packages/
│   ├── key-pointer-schema/   (Schema parsing & type mapping)
│   ├── liquid-core/          (LiquidJS engine & Chevrotain parser)
│   ├── lsp-common/           (Core LSP handlers: completions, hover, linters, etc.)
│   ├── lsp-node/             (Node transport layer & schema loader)
│   └── lsp-browser/          (Browser worker bundles)
├── lsp-engine/               (Test & entry shim)
├── express-server/           (Monaco Editor web playground)
├── vscode-extension/         (VS Code Extension client)
└── angular-playground/       (Angular web client playground)
```

---

## Code Style & Development Guidelines

1. **Imports & Modules**:
   - Uses ES Modules (`type: module`).
   - Relative imports of local TypeScript files **must** include the `.js` extension (e.g., `import { x } from './utils.js';`).
2. **TypeScript Constraints**:
   - `exactOptionalPropertyTypes` is enabled. You cannot assign `undefined` to optional properties. Use optional chaining or delete/check property existence.
3. **ESLint / Type Safety**:
   - We enforce a **strict no `any` policy**. Use `unknown` and type guards (e.g., `isLiquidParserError(err)`) to type-safely inspect untrusted values.
4. **AST / Parser Access**:
   - Avoid accessing private properties on `liquidjs` tag objects. Extract properties from the public `token.args` or public `Token` properties to remain compile-safe.
5. **Agent Constraints**:
   - **Do NOT commit changes to git** without explicitly prompting the user first.
   - Before changing code in this repository, read and follow [repo-skills/liquidjs-v3-core-lsp/SKILL.md](repo-skills/liquidjs-v3-core-lsp/SKILL.md).
   - Use **`rtk`** (Rust Token Killer) commands directly (e.g., `rtk proxy pnpm test`) to reduce token overhead.
