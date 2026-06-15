# liquid-lsp-engine

Thin compatibility shim that preserves the historical `lsp-engine/dist/main.js` entry point. All LSP logic lives in workspace packages; this package only delegates to `lsp-node`.

## When to use

- **Existing integrations** that spawn `lsp-engine/dist/main.js --stdio` (VS Code extension build, express-server, integration tests)
- **Do not import** this package for new code — depend on `lsp-common` or `lsp-node` directly

## What it does

```typescript
import { startNodeServer } from 'lsp-node';
startNodeServer();
```

The VS Code extension copies `lsp-engine/dist/` (plus bundled workspace packages) into `vscode-extension/dist/server/`.

## Dependencies

- **Depends on:** `lsp-node` only
- **Used by:** `vscode-extension`, `express-server`, `lsp-common` integration tests

## Build & test

```bash
pnpm --filter lsp-engine build
pnpm --filter lsp-engine test   # delegates to lsp-common
```

## Package graph (simplified)

```
key-pointer-schema ──┐
liquid-core ─────────┼── lsp-common ──┬── lsp-node ── lsp-engine (this)
                     │                └── lsp-browser
```

---

## Developer & Architecture Reference

### 1. Compatibility Wrapper Role

`lsp-engine` exists to maintain structural compatibility with tools (such as IDE extensions and server launchers) that expect the Language Server executable entry point to reside at `lsp-engine/dist/main.js`. It contains a single source file `main.ts` that boots the Node server from `lsp-node`.

### 2. Integration Testing Host

Although the core tests live under `lsp-common`, `lsp-engine` acts as the test execution workspace context:

- Integration tests in `lsp-common` spawn the compiled `lsp-engine/dist/main.js` output in a subprocess to run end-to-end JSON-RPC client-server testing.
- Ensure `pnpm run build` is run to compile `lsp-engine` and its dependencies before running the integration tests.
