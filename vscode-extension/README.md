# vscode-extension

The VS Code client integration wrapper for the Liquid LSP server. It handles extension activation, client lifecycle, config settings contribution, and bundling.

## When to use

- **VS Code Extension Development** — testing, debugging, or packaging the client extension (`.vsix`)
- **Not for** — server transport or engine features (see library packages under `packages/`)

## Configuration Contribution

The extension contributes the following configurations (`liquid.*`) under Settings:

- **`liquid.schema`**: Predefined variable schemas and types. Supported types: `'string'`, `'number'`, `'boolean'`, `'date'`, `'currency'`, dropdown objects, and composite nested objects.
- **`liquid.server.mode`**: Run the server process locally (`'local'`) or connect to a remote deployed server (`'remote'`).
- **`liquid.server.host`**: Host address of the remote deployed LSP server (default `'localhost'`).
- **`liquid.server.port`**: Port number of the remote deployed LSP server (default `6009`).

---

## Developer & Architecture Reference

### 1. Build and Bundling Flow

The build script [build.js](file:///Users/sonukumar/project/liquid-lsp/vscode-extension/build.js) coordinates bundling:

1. Compiles the client code (`src/client.ts`) into `dist/client.cjs`.
2. Bundles the Liquid language server (`lsp-engine`) into `dist/server/main.cjs` using `esbuild`.
3. Copies all necessary assets to ensure self-contained operation.

### 2. Client Launch Sequence

In [client.ts](file:///Users/sonukumar/project/liquid-lsp/vscode-extension/src/client.ts), `activate(context)` reads the current settings:

- **`mode === 'local'`**: Spawns the server module as a child process: `node dist/server/main.cjs --stdio`.
- **`mode === 'remote'`**: Establishes a TCP net connection to the host/port server (e.g. for remote debugging/hosting).
- Passes the Contribution Schema (`liquid.schema`) as `initializationOptions` to the language client.

### 3. CLI Commands

From the `vscode-extension` directory:

- **Build**: `pnpm build`
- **Package VSIX**: `pnpm package` (builds and runs `vsce package --no-dependencies --out dist/liquid-lsp.vsix` to generate the installable extension bundle).
