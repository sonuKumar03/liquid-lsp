# lsp-common

Runtime-agnostic Liquid LSP core: server lifecycle, variable type state, document token cache, diagnostics scheduling, and all LSP feature handlers (completions, hover, lint, etc.).

## When to use

- **Custom LSP transports** — call `startServer(connection, deps)` from Node stdio, browser worker, or tests
- **Not directly** from VS Code extension or express-server (use `lsp-node` or `lsp-browser` entry points)

## Key exports

| Export                                   | Purpose                                            |
| ---------------------------------------- | -------------------------------------------------- |
| `startServer(connection, deps?)`         | Wire all LSP handlers and start listening          |
| `TypeSystem`                             | Variable schema state + optional workspace loader  |
| `DocumentManager`                        | `TextDocuments` sync + per-URI token cache         |
| `DiagnosticsScheduler`                   | Debounced validation (default 150ms)               |
| `WorkspaceSchemaLoader`                  | Inject filesystem access for `.liquid-schema.json` |
| `SERVER_CAPABILITIES`                    | LSP capability declaration                         |
| `collectVariableNamesFromTokens(tokens)` | Extract assign/capture/for vars from token stream  |

## Dependencies

- **Depends on:** `key-pointer-schema`, `liquid-core`, `vscode-languageserver`
- **Used by:** `lsp-node`, `lsp-browser`

## Build & test

```bash
pnpm --filter lsp-common build
pnpm --filter lsp-common test
```

Integration tests spawn `lsp-engine/dist/main.js` as a child process.

## Usage

```typescript
import { createConnection } from 'vscode-languageserver/node';
import { startServer } from 'lsp-common';

const connection = createConnection();
startServer(connection, {
  workspaceSchemaLoader: {
    load(rootPath) {
      // return parsed .liquid-schema.json or null
      return null;
    },
  },
});
```

Custom notification supported: `workspace/updateSchema` with `{ schema, contextData? }`.

---

## Developer & Architecture Reference

### 1. Document Caching & Tokenizer Sync

`DocumentManager` wraps the native `TextDocuments` collection. To optimize performance, it caches token streams:

- `getTokens(uri, engine)` checks if the cached version is still fresh. It tokenizes on-demand and saves the result.
- Key handlers (Hover, Completions, Symbols) retrieve cached token streams to analyze lines and bounds, avoiding duplicate parsing.

### 2. Type Inference Engine

Type inferences and validation are managed by:

- **`TypeSystem`**: Resolves type scopes from client variable schema payloads and filesystem schema file merges.
- **`local-variable-types.ts`**: Infers local worksheet variable assignments (`assign`, `assignVar`, `parseAssign`, `capture`, `for`).
- **`lifecycle.ts`**: Runs the linter validator tracking variable writes, reads, and warnings (e.g. use before assignment, unread variables, dropdown value mismatches).

### 3. Diagnostics Pipeline

`DiagnosticsScheduler` manages debounced updates:

- Runs validation debounced by **150ms** upon document changes to protect CPU usage.
- Orchestrates:
  - Delimiter matching (e.g., matching unclosed tags/output expressions).
  - Parser validation (calling `liquidEngine.parse` and mapping parsing errors back to tokens).
  - Lifecycle lint rules (variables assignments and type warnings).
  - Custom worksheet engine validations (e.g., unclosed computations on tables).
