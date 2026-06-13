# lsp-node

Node.js stdio transport wrapper for the Liquid LSP. Creates a JSON-RPC connection over stdin/stdout and starts `lsp-common` with filesystem-backed workspace schema loading.

## When to use

- **VS Code extension** (local mode) — spawned as `node dist/main.js --stdio`
- **express-server** — WebSocket gateway spawns `lsp-engine/dist/main.js`
- **CLI / CI** — direct stdio LSP process

## Key exports

| Export | Purpose |
|--------|---------|
| `startNodeServer(connection?)` | Create stdio connection (if omitted) and start the LSP |

Node-only helper (not re-exported): `nodeWorkspaceSchemaLoader` reads `.liquid-schema.json` from the workspace root.

## Dependencies

- **Depends on:** `lsp-common`, `vscode-languageserver` (node transport)
- **Used by:** `lsp-engine` (thin shim)

## Build

```bash
npm run build --workspace=lsp-node
```

Tests run via `lsp-common` workspace.

## Usage

```typescript
import { startNodeServer } from 'lsp-node';

// Blocks and listens on stdin/stdout
startNodeServer();
```

Or from the shell after building `lsp-engine`:

```bash
node lsp-engine/dist/main.js --stdio
```
