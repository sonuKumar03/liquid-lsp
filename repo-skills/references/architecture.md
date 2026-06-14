# Architecture

## Decision

This repository targets the `liquidjs` package declared in workspace dependencies.

The LSP depends on the parser layout, custom tags, custom filters, custom operators, and validation behavior exposed by that runtime. Shared LSP code should preserve those semantics by default.

## Design boundary

Keep these areas runtime-aware:

- engine creation
- tag and filter registration
- operator registration
- token or AST normalization
- syntax-error normalization
- runtime metadata for completions, hover, and signatures
- validation behavior tied to liquidjs

Keep these areas shared when possible:

- LSP transport and lifecycle
- diagnostics framework
- code action framework
- schema and variable type analysis
- completion ranking
- hover rendering

## Practical rule

When adding parser-facing logic, ask:

1. Is this required for current liquidjs behavior?
2. Is this generic LSP behavior?
3. Is this a future compatibility seam?

If it is a future compatibility seam, isolate it without changing current behavior.
