---
name: liquidjs-v3-core-lsp
description: Use when changing this repository's LSP engine, VS Code client, diagnostics, completions, or parser-facing behavior. This skill keeps work aligned to the current LiquidJS v3 core runtime used by this branch, preserves its custom tags, filters, operators, and validation semantics, and avoids redesigning shared code around newer LiquidJS APIs.
---

# LiquidJS v3 Core LSP

Read [references/architecture.md](references/architecture.md) before changing parser-facing code, diagnostics, completions, hover, signatures, or server startup.

## Default stance

- Treat the current `liquidjs/` workspace as the source of truth for language behavior on this branch.
- Refer to this runtime as the LiquidJS v3 core line.
- Preserve current tags, filters, operators, and validation semantics unless the task explicitly changes them.

## Required rules

- Do not reshape shared LSP behavior around newer LiquidJS APIs from later versions.
- If parser behavior is touched, keep the current v3 token, parser, and tag behavior working first.
- Keep `lsp-engine` as the source of truth for language-server behavior. The VS Code extension should only select and launch the server.
- Prefer metadata-driven diagnostics, completions, and code actions over brittle message-string matching.

## Current target

- Build and validate features against the in-repo LiquidJS v3 core workspace.
- When adding an abstraction that may help later-version compatibility, keep the seam local and do not weaken current v3 behavior.
- Keep custom tag and filter support first-class in tests and editor features.

## Repo workflow

- Use `rtk` for shell commands.
- Keep local TypeScript imports on `.js` extensions.
- Respect `exactOptionalPropertyTypes`.
- Add focused tests beside the feature you changed.

