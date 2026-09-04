# Project Audit and Issue Progress

Status: re-audit found unresolved issues; no fixes were made during the audit
Last reviewed: 2026-09-04
Branch: `feat/liquid-computation-ir`
Audit snapshot: `0df707244775bd43ea871393fd5d8f6e4352116f`
Current HEAD when this document was written: `3a61fe2e28e8f5b944076c525047c3205b04a34a`

## Purpose

This is the canonical reference for project audit findings and their progress.
Do not mark a finding resolved until its original failure has been reproduced,
fixed, and verified with the relevant focused and repository-wide checks.

## Re-audit boundary

The findings below were verified against the audit snapshot listed above.
Commit `3a61fe2` was created afterward and updated these files:

- `angular-playground/src/app/components/migration-workbench/migration-workbench.component.ts`
- `angular-playground/src/app/components/playground/playground.component.html`
- `angular-playground/src/app/components/playground/playground.component.ts`
- `packages/computation-ir/src/transpiler.ts`

These post-audit updates must be re-audited before any affected finding is
marked resolved. Their presence does not imply that the findings below are
fixed.

No implementation fixes were made as part of this re-audit.

## Verification snapshot

- [x] `rtk pnpm test` passes: 33 test files, 241 tests.
- [x] `rtk pnpm -r test` exits successfully.
- [x] Source lint passes when `angular-playground/out-tsc/**` is excluded.
- [ ] `rtk pnpm run build` passes. It currently aborts during the Angular build
  with `SIGABRT`; the preceding TypeScript workspace builds pass.
- [ ] `rtk pnpm run lint` passes in the current filesystem state. It reports 59
  errors from ignored generated files under `angular-playground/out-tsc/`.
- [ ] Recursive package testing is non-duplicative and covers every workspace.
- [ ] `rtk proxy git diff --check main...HEAD` passes. Three committed whitespace
  errors remain.
- [ ] A CI workflow exists on the current branch.

## Findings

### F-001 — Optimizer can double-apply filters

Priority: High
Status: Resolved and re-verified

`optimizeComputationIR` clears the filter list after folding a filtered
expression to a literal. A real extractor/optimizer check produced expression
`0.18` with zero remaining filters.

- [x] Define the folded IR representation.
- [x] Prevent repeated filter application.
- [x] Keep regression coverage.
- [x] Re-verify the original failure.

### F-002 — CFG branch modeling is incomplete

Priority: High
Status: Reopened

Simple `if`/`else` handling improved, but `elsif` and `case` are still modeled
incorrectly.

For `elsif`, the nested branch joins into its own terminal join block and does
not reconnect to the outer join. The outer Phi node consequently reads from an
empty outer `else` block instead of the nested branch results.

For `case`, the real extractor emits flat children such as `when`, `assign`,
`when`, `assign`, `else`, `assign`. The CFG builder treats every tag as a case
arm and only processes `child.children`, producing empty and spurious arms.

- [x] Support a simple `if`/`else` split.
- [ ] Connect nested `elsif` joins to the outer continuation.
- [ ] Build Phi inputs from the actual predecessor blocks.
- [ ] Model the extractor's real flat `case` representation.
- [ ] Add extractor-to-CFG integration tests for `elsif` and `case`.

### F-003 — Optimizer and CFG are not production execution paths

Priority: Medium
Status: Partial

The Angular playground and migration workbench display raw IR, optimized IR,
raw CFG, and optimized CFG. This is useful development visualization, but the
migration workbench still executes `referenceProgramFromIR(ir)` with the raw
IR. The reference language remains a verification consumer rather than a
production replacement target.

- [x] Expose optimizer and CFG data in the Angular development UI.
- [ ] Identify a real execution consumer that requires optimized IR or CFG.
- [ ] Integrate only when that consumer and its behavioral contract exist.
- [ ] Verify the selected execution path end to end.

### F-004 — Recursive tests contain duplication and coverage gaps

Priority: Medium
Status: Partial

`packages/computation-ir` now has a test script, and `rtk pnpm -r test` exits
successfully. However, that package invocation loads the root multi-project
Vitest configuration and reruns the full 33-file/241-test suite.
`lsp-engine` separately reruns `lsp-common`, while `angular-playground` reports
success by echoing that its tests are skipped.

- [x] Add a `computation-ir` package test command.
- [x] Confirm that the recursive command exits successfully.
- [ ] Make the `computation-ir` package test genuinely package-local.
- [ ] Remove the duplicate `lsp-common` test invocation from `lsp-engine`.
- [ ] Replace or remove the Angular placeholder test command.

### F-005 — No CI workflow exists on the current branch

Priority: Medium
Status: Pending

The current branch has no `.github` workflow. Candidate CI changes reportedly
exist on `agent/add-github-ci`, but they have not been merged or re-audited here.

- [ ] Review the candidate workflow against current commands.
- [ ] Merge or recreate the approved minimal workflow.
- [ ] Verify it in the CI environment.

### F-006 — Committed whitespace hygiene issues remain

Priority: Low
Status: Reopened

`rtk proxy git diff --check main...HEAD` reports:

- `docs/project-audit-progress.md`: blank line at EOF in the audited snapshot.
- `packages/computation-ir/src/transpiler.test.ts`: trailing whitespace.
- `packages/computation-ir/src/transpiler.test.ts`: blank line at EOF.

- [ ] Make `git diff --check` pass.

### F-007 — JavaScript `case` transpilation is invalid

Priority: High
Status: Open

The JavaScript transpiler assumes nested `when` and `else` children, while the
extractor emits flat siblings. With a real extracted `case` document, it emits
an invalid `} else else {` sequence and JavaScript compilation throws
`SyntaxError: Unexpected token 'else'`.

- [ ] Define `case` branch representation at the IR boundary.
- [ ] Generate valid mutually exclusive JavaScript branches.
- [ ] Add an extractor-to-JavaScript execution regression test.

### F-008 — JavaScript string concatenation produces `NaN`

Priority: High
Status: Open

The expression transpiler handles `ADD` and `CONCAT` through the same numeric
coercion path. A real `"a" | append: "b"` computation generates
`Number("a") + Number("b")` and evaluates to `NaN` instead of `"ab"`.

- [ ] Give `CONCAT` string/array semantics separate from numeric addition.
- [ ] Add a real extractor-to-JavaScript append regression test.

### F-009 — New computation tests use unsafe `any` casts

Priority: Low
Status: Open

The new CFG and optimizer tests contain multiple `as any` casts despite the
repository's no-`any` convention. Passing lint does not currently enforce that
policy.

- [ ] Replace new unsafe casts with discriminated-union narrowing.
- [ ] Decide whether the no-`any` policy should be lint-enforced.

## Progress log

| Date | Change | Result |
| --- | --- | --- |
| 2026-09-04 | Initial audit recorded | Six findings identified |
| 2026-09-04 | Earlier implementation pass | Tracker claimed F-001, F-002, F-003, F-004, and F-006 resolved |
| 2026-09-04 | Re-audit of `0df7072` | F-001 confirmed; F-002 and F-006 reopened; F-003 and F-004 partial; F-007 through F-009 added |
| 2026-09-04 | Post-audit commit `3a61fe2` detected | Angular playground and transpiler changes require another re-audit |

## Next audit pass

1. Re-audit the four updated working-tree files listed above.
2. Re-run the F-002, F-007, and F-008 reproductions against that updated tree.
3. Run build, root tests, recursive tests, lint, and `git diff --check`.
4. Update statuses only from the new command evidence; do not infer resolution
   from changed code alone.
