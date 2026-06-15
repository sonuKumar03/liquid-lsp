# lsp-browser

Browser Web Worker entry for the Liquid LSP. Uses `vscode-jsonrpc` MessagePort transport instead of Node stdio.

## When to use

- **Monaco / browser editors** — run the LSP inside a Web Worker via `connectBrowserLspWorker`
- **express-server demo** — served at `/lsp-worker.js` and `/lsp-browser-client.js` after build
- **Not for** — VS Code desktop (use `lsp-node`)

Workspace schema files (`.liquid-schema.json`) are not loaded in the browser unless you pass schema via `initializationOptions` or `workspace/updateSchema`.

## Key exports

| Export                         | Purpose                                               |
| ------------------------------ | ----------------------------------------------------- |
| `connectBrowserLspWorker(url)` | Main-thread client (MessageChannel + framed JSON-RPC) |
| `startWorkerServer(port)`      | Start LSP on a `Worker` or `MessagePort`              |
| `getWorkerConnection(port)`    | Build a browser LSP `Connection`                      |
| `startServer`                  | Re-export from `lsp-common`                           |

Bundled artifacts (esbuild):

- `dist/worker.js` (~750KB) — full LSP server (`lsp-common`, `liquid-core`, liquidjs)
- `dist/browser-client.js` — thin host client (`vscode-jsonrpc` transport)

## Build & test

```bash
pnpm --filter lsp-browser build
pnpm --filter lsp-browser test
```

## Usage

**Playground / Monaco (recommended):**

```html
<script type="module">
  import { connectBrowserLspWorker } from '/lsp-browser-client.js';
  const client = await connectBrowserLspWorker('/lsp-worker.js');
  await client.sendRequest('initialize', {
    capabilities: {},
    initializationOptions: {
      schema: {
        /* ... */
      },
    },
  });
  client.sendNotification('initialized', {});
  client.onNotification((method, params) => {
    if (method === 'textDocument/publishDiagnostics') {
      // update editor markers
    }
  });
</script>
```

---

## Developer & Architecture Reference

### 1. Web Worker Handshake Protocol

To run the server inside a Web Worker, a MessageChannel handshake must take place:

1. **Host Client**: Creates a `MessageChannel` and spawns a new Web Worker (`new Worker(workerScriptUrl, { type: 'module' })`).
2. **Init Message**: The host sends `WORKER_INIT_MESSAGE_TYPE` (`'liquid-lsp-worker-init'`) transferring `channel.port1` via `worker.postMessage`.
3. **Worker Listener**: The worker receives the port, starts the LSP server on it using `startWorkerServer(port)`, and replies to the host with `WORKER_READY_SIGNAL` (`'liquid-lsp-worker-ready'`).
4. **JSON-RPC Transport**: Both sides establish communication on `port2` using `BrowserMessageReader` and `BrowserMessageWriter` from `vscode-jsonrpc/browser`.

### 2. Browser Bundling & Stubs

Because `liquidjs` and the LSP core import Node utilities (like `fs` for loading schemas, `path` for folder joining, and `url`), `build-worker.mjs` uses `esbuild` to stub these APIs out:

- **`fs` stub**: Returns a mocked `existsSync` (returns `false`) and `readFileSync` (returns `""`).
- **`path` stub**: Simple POSIX string path logic (`join` and `dirname`).
- **`url` stub**: Mocked `fileURLToPath`.
- **`module` stub**: Mocks `createRequire`.
- **`assert` stub**: Standard assertion helper.
