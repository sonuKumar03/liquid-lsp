# lsp-browser

Browser Web Worker entry for the Liquid LSP. Uses `vscode-languageserver/browser` transport instead of Node stdio.

## When to use

- **Monaco / browser editors** — run the LSP inside a Web Worker; post JSON-RPC messages via `postMessage`
- **express-server demo** — served at `/lsp-worker.js` after build
- **Not for** — VS Code desktop (use `lsp-node`)

Workspace schema files (`.liquid-schema.json`) are not loaded in the browser unless you pass schema via `initializationOptions` or `workspace/updateSchema`.

## Key exports

| Export | Purpose |
|--------|---------|
| `startWorkerServer(worker)` | Start LSP on a `Worker` global |
| `getWorkerConnection(worker)` | Build a browser LSP `Connection` |
| `startServer` | Re-export from `lsp-common` |

Bundled entry: `dist/worker.js` (esbuild, ~750KB) — includes `lsp-common`, `liquid-core`, and dependencies.

## Dependencies

- **Depends on:** `lsp-common`, `vscode-languageserver` (browser transport)
- **Used by:** Browser clients, express-server static route

## Build & test

```bash
npm run build --workspace=lsp-browser
npm run test --workspace=lsp-browser
```

## Usage

**Worker script** (`worker.ts` compiled to `dist/worker.js`):

```typescript
import { startWorkerServer } from 'lsp-browser';
startWorkerServer(self);
```

**Main thread** (Monaco language client pattern):

```typescript
const worker = new Worker('/lsp-worker.js', { type: 'module' });

worker.postMessage(JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { capabilities: {}, initializationOptions: { schema: { /* ... */ } } },
}));

worker.onmessage = (event) => {
  const message = JSON.parse(event.data);
  // route to Monaco language client
};
```

See `angular_integration.md` for the WebSocket gateway alternative (Node spawn, no worker bundle).
