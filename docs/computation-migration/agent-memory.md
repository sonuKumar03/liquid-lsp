# LiquidJS Computation Migration: Agent Context

This file is the short handoff note for agents working on the computation
migration. Keep it updated when an architecture decision or supported behavior
changes.

## Goal

Convert computation-only LiquidJS input into a portable intermediate
representation (IR). Other languages can then interpret the IR or generate
their own equivalent code. The target language is one consumer, not the owner
of the IR or the behavior contract.

The local LiquidJS implementation and its regression tests remain the behavior
reference. Compatibility means preserving results, errors, scopes, and
observable dependencies.

## Architecture decisions

```text
LiquidJS source
  -> LiquidJS extractor
  -> computation-ir
  -> consumer (reference language, target language, or another language)
```

- `liquid-core` owns LiquidJS parsing and extraction.
- `computation-ir` owns portable IR types, schema, and validation. It must not
  depend on LiquidJS or a consumer language.
- `computation-reference` is a small test consumer. It is useful for checking
  arithmetic, paths, comparisons, and `if`/`else`; it is not the production
  target language.
- Consumer-specific generation belongs in the consumer package, not in the IR
  package.
- Keep the first implementation small. Add behavior only when a fixture or
  compatibility requirement needs it.

## Current files

- `docs/computation-migration/liquidjs-computation-behavior.md` — behavior
  contract and migration phases.
- `docs/computation-migration/computation-ir.schema.json` — version 1 interchange
  schema.
- `docs/computation-migration/fixtures/liquidjs-computation-fixtures.json` — shared
  compatibility examples.
- `packages/computation-ir/` — portable IR package currently under development.
- `packages/liquid-core/src/computation-ir.ts` — LiquidJS computation
  extraction currently under development.
- `packages/liquid-core/src/computation-ir.test.ts` — extractor tests.
- `packages/computation-reference/src/reference-language.ts` — small recursive
  descent reference language and evaluator.
- `packages/computation-reference/src/reference-from-ir.ts` — reference
  consumer entry point for IR, including generated source text.
- `packages/computation-reference/src/reference-language.test.ts` and
  `reference-from-ir.test.ts` — reference consumer tests.
- `scripts/computation-benchmark.ts` — lightweight performance baseline.
- `docs/computation-migration/benchmark.md` — benchmark method and interpretation.
- `angular-playground/src/app/components/migration-workbench/` — visual route
  for comparing input, IR, generated source, results, and timings.

## Initial supported reference-language slice

- Assignments.
- Numeric and string literals, variables, property paths, and indexes.
- `+`, `-`, `plus`, `minus`, `add`, and `subtract`.
- `times` multiplication.
- `divided_by` division with zero-division handling and three-decimal minimum precision.
- `==`, `!=`, `>`, `<`, `>=`, and `<=`.
- `if` / `else` blocks.
- `elsif` branches through nested conditional conversion.
- Output expressions, returned separately from assigned values.
- `toCurrency` and `toDuration` constructors, including currency type
  preservation and duration type normalization plus day conversion.
- Simple `plus`, `minus`, `add`, and `subtract` filter forms are normalized by
  the reference adapter for differential checks.
- Liquid-like truthiness and basic null arithmetic rules.

This slice is a verification aid. It does not claim to implement every
LiquidJS computation construct.

## Roadmap

1. Keep the behavior contract and fixtures current.
2. Stabilize the version 1 IR model and validation.
3. Ensure the LiquidJS extractor preserves structure, source locations,
   original text, dependencies, filters, and unsupported/error information.
4. Use the reference consumer to verify IR meaning and generated behavior.
5. Add consumer-specific generation for the target language.
6. Run differential checks against LiquidJS for values, errors, scope, and
   dependencies.
7. Later, use `angular-playground` as a visual workbench for inspecting the
   input, IR, consumer output, diagnostics, and behavior comparisons. Keep it
   outside the core conversion pipeline.

For UI verification, use the existing Chrome remote-debugging session only;
do not launch a separate browser session.

Do not hide unsupported behavior. Record it in the IR or as a diagnostic and
add a fixture before expanding a consumer.

## Verification commands

Run from the repository root. Direct local binaries are preferred when package
manager metadata or network access prevents the workspace scripts from running:

```sh
rtk node_modules/.bin/vitest run
rtk node_modules/.bin/tsc -p packages/computation-ir/tsconfig.build.json
rtk node_modules/.bin/tsc -p packages/computation-reference/tsconfig.build.json
rtk node_modules/.bin/tsc -p packages/liquid-core/tsconfig.build.json
rtk git diff --check
```

When dependencies are available, the normal checks are:

```sh
rtk pnpm run build
rtk pnpm run test
rtk pnpm run lint
```

## Important constraints

- Documentation and fixtures must describe language-independent behavior.
- Do not make `liquid-core` depend on the reference language.
- Keep local TypeScript imports on `.js` extensions because packages use ESM.
- Keep implementation files as `.ts`; `.js` files should only be generated under
  `dist/`, never added to package `src/` directories.
- Do not use unsafe `any`; use `unknown` and type guards at trust boundaries.
- Avoid private LiquidJS tag properties; use public token data.
- Preserve source ranges and original text where behavior or diagnostics may
  depend on them.
- Keep unrelated worktree changes untouched and do not commit unless asked.
