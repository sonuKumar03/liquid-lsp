---
name: liquidjs-v3-core-lsp
description: Use when changing this repository's LSP engine, VS Code client, diagnostics, completions, or parser-facing behavior. Keeps work aligned to the liquidjs runtime, preserves custom tags, filters, operators, and validation semantics, and avoids redesigning shared code around APIs this repo does not use.
---

# Liquid LSP

Read [references/architecture.md](references/architecture.md) before changing parser-facing code, diagnostics, completions, hover, signatures, or server startup.

## Default stance

- Treat the `liquidjs` dependency as the source of truth for language behavior.
- Preserve current tags, filters, operators, and validation semantics unless the task explicitly changes them.

## Required rules

- Do not reshape shared LSP behavior around LiquidJS APIs that this repo does not depend on.
- If parser behavior is touched, keep current token, parser, and tag behavior working first.
- Keep `lsp-engine` as the source of truth for language-server behavior. The VS Code extension should only select and launch the server.
- Prefer metadata-driven diagnostics, completions, and code actions over brittle message-string matching.

## Current target

- Build and validate features against the `liquidjs` package used by this repo.
- When adding an abstraction that may help later compatibility, keep the seam local and do not weaken current behavior.
- Keep custom tag and filter support first-class in tests and editor features.

## Repo workflow

- Use `rtk` for shell commands.
- Keep local TypeScript imports on `.js` extensions.
- Respect `exactOptionalPropertyTypes`.
- Add focused tests beside the feature you changed.
