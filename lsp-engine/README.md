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
npm run build --workspace=liquid-lsp-engine
npm run test --workspace=liquid-lsp-engine   # delegates to lsp-common
```

## Package graph (simplified)

```
key-pointer-schema ──┐
liquid-core ─────────┼── lsp-common ──┬── lsp-node ── lsp-engine (this)
                     │                └── lsp-browser
```
