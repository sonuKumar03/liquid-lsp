# lsp-node

Node.js stdio/socket transport wrapper for the Liquid LSP. Creates a JSON-RPC connection over stdin/stdout or sockets and starts `lsp-common` with filesystem-backed workspace schema loading.

## When to use

- **VS Code extension** (local mode) — spawned as `node dist/main.js --stdio`
- **express-server** — WebSocket gateway spawns `lsp-engine/dist/main.js`
- **CLI / CI** — direct stdio LSP process

## Key exports

| Export                         | Purpose                                                |
| ------------------------------ | ------------------------------------------------------ |
| `startNodeServer(connection?)` | Create stdio connection (if omitted) and start the LSP |

Node-only helper (not re-exported): `nodeWorkspaceSchemaLoader` reads `.liquid-schema.json` from the workspace root.

## Dependencies

- **Depends on:** `lsp-common`, `vscode-languageserver` (node transport)
- **Used by:** `lsp-engine` (thin shim)

## Build

```bash
pnpm --filter lsp-node build
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

---

## Developer & Architecture Reference

### 1. Filesystem Workspace Schema Loader

Unlike the browser environment, `lsp-node` injects a filesystem-based schema loader:

- **`.liquid-schema.json`**: Located at the workspace root directory.
- **`nodeWorkspaceSchemaLoader`**: Implements the `WorkspaceSchemaLoader` interface from `lsp-common`.
- **Loading behavior**: On handshake (`onInitialize`), the server reads this file asynchronously/synchronously from the local filesystem, parses it using `key-pointer-schema`, and merges it into the LSP's active `TypeSystem`.

### 2. Transport Execution Modes

`lsp-node` can bind to two node communication flows:

- **Stdio (`--stdio`)**: Listens on standard process input/output. This is the default used by VS Code client instances.
- **Socket / Remote (`--port`)**: (Optional extension integration) Binds the LSP connection over a TCP net socket port.
