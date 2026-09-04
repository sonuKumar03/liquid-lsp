# Computation Migration: Implementation Status

Last checked: 2026-09-04
Branch: `feat/liquidjs-computation-contract`

## Goal

Convert computation-only LiquidJS input into a portable representation that
any consumer language can interpret or generate from while preserving behavior.

## Implemented

- Behavior contract: `docs/computation-migration/liquidjs-computation-behavior.md`
- Real key-pointer examples and format options:
  `angular-playground/liquidJs_keypointer_computations_real_examples_and_format_options.md`
- Version 1 interchange schema:
  `docs/computation-migration/computation-ir.schema.json`
- Shared compatibility fixtures:
  `docs/computation-migration/fixtures/liquidjs-computation-fixtures.json`
- Portable IR package: `packages/computation-ir/`
- LiquidJS extractor: `packages/liquid-core/src/computation-ir.ts`
- Extractor tests: `packages/liquid-core/src/computation-ir.test.ts`
- Small reference consumer: `packages/computation-reference/`
- Visual workbench route: `angular-playground/src/app/components/migration-workbench/`

The extractor currently preserves computation nodes, nesting, source ranges,
original text, expressions, filters, dependencies, and extraction errors.
The reference consumer currently covers assignments, literals, variable paths,
indexes, arithmetic aliases, comparisons, `if`/`else` evaluation, currency and
duration constructors, and output values. It exposes both an evaluable program
and generated reference source text for the visual workbench.

The Angular workbench is available at `/migration`. It accepts a computation and
context JSON, displays the IR and generated reference source, compares outputs,
and shows per-run timings. Its page can scroll while a compact workbench header
stays visible with the route context and run status; the input and side-by-side
results lead the page, followed by side-by-side LiquidJS/reference source and
the IR in a full-width panel below them.

## Package boundaries

```text
LiquidJS source
  -> liquid-core extractor
  -> computation-ir
  -> reference consumer or another language consumer
```

- `liquid-core` owns LiquidJS parsing and extraction.
- `computation-ir` owns portable IR types and its package boundary.
- `computation-reference` is only a verification consumer.
- Consumer-specific generation does not belong in `liquid-core` or the IR.

## Verification

The focused IR and Reference Consumer tests pass: 40 tests, including differential checks for
addition, subtraction, multiplication, comparisons, `elsif`, null-input
subtraction, date subtraction, date plus duration, currency addition/subtraction/multiplication,
currency and duration with nulls, object/array `parseAssign` literals, `sumArray` folds,
`for` loop accumulation, filters (`concat`, `uniq`, `strip`, `strip_html`), and
`format_option` field schema validation and formatting. The package type-checks pass for
`computation-ir`, `liquid-core`, `computation-reference`, `lsp-common`, and `key-pointer-schema`.
The full Vitest suite passes: 28 files and 204 tests.

The benchmark setup is at `scripts/computation-benchmark.ts`; it measures
LiquidJS rendering, IR extraction, reference compilation, and reference
evaluation over 500 iterations. Record future baseline results in
`docs/computation-migration/benchmark.md` or this status note.

The local workspace dependency needed to resolve LiquidJS from the available
checkout before running the full suite. This is local setup, not a source-code
change.

The worktree also contains pre-existing or in-progress changes to package
manifests, the lockfile, generated package files, and `.pnpm-store/`. They are
not part of this status-document update and must be reviewed separately.

## Migration Roadmap Progress

Completed slices:

- [x] 1. Normalize assignment nodes into explicit targets and expressions (including `parseAssign` object/array literals).
- [x] 2. Add typed currency/duration literal coverage and edge-case fixtures (date arithmetic, currency/duration null propagation).
- [x] 3. Complete `sumArray` behavior for empty arrays, defaults, nulls, and currency/duration sequences.
- [x] 4. Add `for`, array construction, `concat`, `uniq`, `strip_html`, and `strip`.
- [x] 5. Verify LiquidJS scope-chain assignment behavior inside loops.
- [x] 6. Pass `format_option` as field schema/type metadata to consumers; keep field-specific
     options out of the portable computation nodes while using them for runtime typing
     and final rendering.
- [x] 7. Complete Reference Consumer verification and visual migration workbench integration.
