# Liquid playground — backlog & direction

## Status (2026-06-14)

- **Angular playground** (`playground/`) — shell done: Monaco + ngx-monaco, WebSocket + worker LSP toggle, diagnostics shelf, mock context JSON, live preview. Run `npm run start:playground` (proxies LSP assets from express on `:3000`).
- **Worker LSP parity** — demo template shows **16** diagnostics on WebSocket and worker (express `:3000` and Angular `:4200`). Root cause fixed: `key-pointer-schema` loaded the type registry via `readFileSync`; the browser worker FS stub returned empty JSON and `loadTypeRegistry()` threw mid-lifecycle, aborting schema-aware checks.

## Remaining / optional

- `playground/README.md` — replace Angular CLI boilerplate with dev instructions.
- Prod build: copy `lsp-browser` worker bundles into Angular `assets` (dev proxies `/lsp-worker.js` from express).
- `computeColumn` / non-computable assign edge cases — re-verify if adding those tags to the demo template.

## Reference URLs

| App | WebSocket | Worker |
|-----|-----------|--------|
| Express HTML | `http://localhost:3000/?lsp=websocket` | `http://localhost:3000/?lsp=worker` |
| Angular | `http://localhost:4200/?lsp=websocket` | `http://localhost:4200/?lsp=worker` |

Schema fixture: `express-server/public/playground-variables.json`

## Dev commands

```bash
# Terminal 1 — LSP backend + static playground
cd express-server && rtk node dist/server.js

# Terminal 2 — Angular playground (optional)
npm run start:playground
```
