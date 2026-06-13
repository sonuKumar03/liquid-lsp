# lsp-common

Runtime-agnostic Liquid LSP core: server lifecycle, variable type state, document token cache, diagnostics scheduling, and all LSP feature handlers (completions, hover, lint, etc.).

## When to use

- **Custom LSP transports** — call `startServer(connection, deps)` from Node stdio, browser worker, or tests
- **Not directly** from VS Code extension or express-server (use `lsp-node` or `lsp-browser` entry points)

## Key exports

| Export | Purpose |
|--------|---------|
| `startServer(connection, deps?)` | Wire all LSP handlers and start listening |
| `TypeSystem` | Variable schema state + optional workspace loader |
| `DocumentManager` | `TextDocuments` sync + per-URI token cache |
| `DiagnosticsScheduler` | Debounced validation (default 150ms) |
| `WorkspaceSchemaLoader` | Inject filesystem access for `.liquid-schema.json` |
| `SERVER_CAPABILITIES` | LSP capability declaration |
| `collectVariableNamesFromTokens(tokens)` | Extract assign/capture/for vars from token stream |

## Dependencies

- **Depends on:** `key-pointer-schema`, `liquid-core`, `vscode-languageserver`
- **Used by:** `lsp-node`, `lsp-browser`

## Build & test

```bash
npm run build --workspace=lsp-common
npm run test --workspace=lsp-common
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
