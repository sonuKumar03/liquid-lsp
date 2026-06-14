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
rtk npm run build --workspace=lsp-browser
rtk npm run test --workspace=lsp-browser
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

The host transfers a `MessagePort` to the worker (`liquid-lsp-worker-init`); LSP JSON-RPC uses Content-Length framed `Uint8Array` on that port.

See `angular_integration.md` for the WebSocket gateway alternative (Node spawn, no worker bundle).
