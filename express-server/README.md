# express-server

Local Node Express development server hosting the Liquid LSP Monaco Editor web playground.

## When to use

- **Playground Testing** — testing language server features inside a browser editor interface.
- **WebSocket Gateway Testing** — debugging server transports and WebSocket proxies.

---

## Developer & Architecture Reference

### 1. Monaco Editor Web Playground

The server hosts a static playground under `public/`:

- Integrates Monaco Editor to edit `.liquid` templates.
- Loads the browser worker client script (`/lsp-browser-client.js`) and connects it to the worker server (`/lsp-worker.js`).
- Updates diagnostics, hover hints, completions, and formatting directly in the browser sandbox.

### 2. WebSocket Gateway Server

In addition to the browser sandbox worker, the express server implements a WebSocket server wrapper:

- Listens for WebSocket connections.
- Spawns the compiled Node server subprocess (`node lsp-engine/dist/main.js --stdio`).
- Proxies JSON-RPC messages bi-directionally between the WebSocket connection and the subprocess standard input/output.
- This allows remote web client instances to connect to a fully functional, server-side Node LSP.

### 3. Developer Commands

- Run the server: `pnpm start` (or `pnpm run start:playground` from the repository root).
- Access the playground at **http://localhost:3000**.
