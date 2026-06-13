# AGENTS.md - Project Context & Developer Guide

## Project Overview
This repository contains a specialized Language Server Protocol (LSP) implementation for LiquidJS computational worksheets. The project is organized as a monorepo using **npm workspaces**:

1. **`lsp-engine`**: The core language server protocol logic, AST tokenization, diagnostic linters, and integration tests.
2. **`vscode-extension`**: The VS Code client integration wrapper that activates the client and bundles the server output.

---

## Core Developer Commands

All workspace commands should be run from the repository root:

*   **Build Project**: `npm run build`
    *   Compiles `lsp-engine` TS files to `lsp-engine/dist/`.
    *   Compiles `vscode-extension` TS files to `vscode-extension/dist/client.js`.
    *   Copies server files from `lsp-engine/dist/` to `vscode-extension/dist/server/` using `build.js`.
*   **Run Linter**: `npm run lint` (runs ESLint recursively, ignoring `**/dist/` and `**/node_modules/`).
*   **Format Code**: `npm run format` (runs Prettier).
*   **Run Test Suite**: `npm run test` (runs Vitest test runner inside `lsp-engine`).

---

## Project Structure

```
├── lsp-engine/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── main.ts              (Server Entry Point)
│       ├── completions/         (Auto-completions & test)
│       ├── definitions/         (Go to Definition & test)
│       ├── hovers/              (Hover documentation & test)
│       ├── signatures/          (Filter signature help & test)
│       ├── codeactions/         (Quick fixes & test)
│       ├── symbols/             (Document outlines & test)
│       ├── formatters/          (Document formatters & test)
│       ├── linters/             (Type checkers, lifecycle diagnostics, & tests)
│       └── shared/              (Constants, utilities, and test-utils)
└── vscode-extension/
    ├── package.json
    ├── tsconfig.json
    ├── build.js                 (Bundling copy script)
    └── src/
        └── client.ts            (Extension Client Entry Point)
```

---

## Code Style & Development Guidelines

1. **Imports & Modules**:
   * Uses ES Modules (`type: module`).
   * Relative imports of local files must include the `.js` extension (e.g., `import { utils } from '../shared/utils.js';`).
2. **TypeScript Constraints**:
   * `exactOptionalPropertyTypes` is enabled. You cannot assign `undefined` to optional properties. Instead, check for existence before assigning or use optional chaining.
3. **ESLint / Type Safety**:
   * ESLint ignores compiled `dist/` directories.
   * `@typescript-eslint/no-explicit-any` is disabled to allow easy assertion of dynamic JSON-RPC payloads in test files.
4. **Agent Constraints**:
   * **Do NOT commit changes to git** without explicitly prompting the user first.
   * Use **`rtk`** (Rust Token Killer) commands directly (e.g., `rtk git status`, `rtk git add .`) to reduce token overhead.
