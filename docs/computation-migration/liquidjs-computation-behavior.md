# Language-Independent Computation Behavior Contract

This document records the custom computation behavior that every replacement
implementation must reproduce. This contract is language-independent and can be
used by any future consumer.
It covers the custom computation extensions in the local LiquidJS fork, not the
general Liquid template language.

The current LiquidJS fork is the reference implementation. A rule is considered
compatible when the existing regression tests and the fixtures in
`liquidjs-computation-fixtures.json` produce the same result, error category, and
observable dependency behavior.

The portable representation must preserve both the complete computation structure and
the behavior rules below. A consumer may generate source code, interpret the model,
or compile it to another language; it must not need to understand LiquidJS internals.

## Key-pointer types and rendering

Key-pointer `format_option` is the field's runtime type/schema contract as well as its
presentation configuration. It tells the runtime whether a value is a currency,
duration, date, dropdown, number, or repeating table, and also controls precision,
symbols, labels, date formatting, and number-to-words behavior.

The IR should remain field-schema agnostic, but consumers must receive the relevant
`format_option` when validating or evaluating a field. Computation results must conform
to the runtime shape required by that option; rendering is only the final use of the
same metadata. The type metadata also participates in operation dispatch: it can change
how `plus`, `minus`, `times`, `divided_by`, filters, and tags interpret their operands,
coerce values, preserve metadata, or reject an operation. These are typed operations,
not generic JavaScript arithmetic.

Important raw value shapes are currency `{ value, type }`, duration `{ value, type,
days }`, ISO-like dates, dropdown option values, numbers, and repeating fields as
arrays of row objects. A currency schema may also constrain the currency code, for
example `{ type: 'currency', currency: 'EUR' }`; an INR result for that field is
invalid even though it has the correct object shape.

```text
format_option schema -> typed computation value -> format_option renderer -> displayed value
```

For example, `plus` on two currency values adds their numeric `value` fields while
preserving currency metadata; date subtraction produces a duration; and a repeating
format option makes `computeColumn` operate row by row. The IR must preserve the
operation, operands, and field/type context so each consumer can reproduce that
dispatch consistently.

The reference evaluator accepts this field schema separately from the input values.
It currently validates assignment results against the declared type and currency
metadata; the computation nodes remain portable and do not contain field-specific
`format_option` objects.

See `angular-playground/liquidJs_keypointer_computations_real_examples_and_format_options.md`
for the verified examples and format-option reference. When both legacy LiquidJS and
the newer computation system are configured, LiquidJS runs first and the newer result
overwrites it. That ordering belongs to runtime orchestration, not an IR node.

## Supported computation constructs

| Construct                                            | Meaning                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `assign`                                             | Evaluate an expression and bind its result in the current scope.              |
| `assignVar`                                          | Resolve the named value from the context and bind it.                         |
| `parseAssign`                                        | Accept only a literal JSON-compatible value, parse it, and bind it.           |
| `if`, `unless`, `elsif`, `else`                      | Conditional control flow with branch-local analysis.                          |
| `for`                                                | Iterate a collection with a loop-local variable.                              |
| `computeColumn`                                      | Evaluate a body once per table row and write `$$answer` to the target column. |
| `plus`, `minus`, `times`, `divided_by`               | Custom computation arithmetic filters.                                        |
| `toCurrency`, `toDuration`                           | Construct domain values.                                                      |
| `sumArray`, `updateAttribute`, `updateTypeAttribute` | Aggregate or update values.                                                   |

## Runtime values

- Dates are valid `Date` values or ISO strings matching `YYYY-MM-DD` with an optional
  time suffix. Other date-looking strings remain strings.
- Durations have `{ value, type, days }`, where `type` is `DAYS`, `WEEKS`, `MONTHS`,
  or `YEARS`.
- `toDuration` normalizes units to uppercase and computes `days` using 1, 7, 30,
  and 365 day multipliers respectively.
- Currencies have `{ value, type }`. The numeric `value` is operated on while the
  object shape and `type` metadata are retained.
- Phone numbers compare by `{ number, code }`.
- Null and undefined are distinct from ordinary values but are both treated as
  non-values by numeric validation.

## Arithmetic rules

Primitive arithmetic coerces numeric strings. Addition and subtraction preserve the
maximum decimal precision of their operands. Multiplication preserves the maximum
operand precision. Division rounds to at least three decimal places. For primitive
values, invalid operands contribute `0`; division by numeric zero returns `null`.

Null handling is observable and must not be normalized away:

- add: missing values behave as zero;
- subtract: `value - null` keeps `value`, while `null - value` negates it;
- multiply/divide: missing values behave as zero;
- object plus/minus a missing value returns `null`;
- a missing value inside `sumArray` follows the same operation rules.

Date and duration arithmetic is separate from primitive arithmetic:

- date minus date returns a `DAYS` duration using start-of-day values and clamps
  negative results to zero;
- date plus/minus duration uses calendar `setDate`, `setMonth`, and `setFullYear`
  behavior; weeks are seven days;
- unsupported date operations return `null`;
- duration plus/minus duration uses normalized `days` and returns a `DAYS` duration;
- an empty or invalid duration leaves a date unchanged;
- numeric-keyed object values are operated on element by element; objects without
  common numeric keys use a `value` result based on their first numeric values.

## Comparisons

- Equality between different detected types uses strict equality.
- Arrays compare without regard to element order; arrays containing objects do not
  become deeply equal.
- Durations compare by normalized `days`.
- Dates compare by timestamp when both values are supported dates.
- Currencies compare by numeric value and currency type; ordering across different
  currency types is false.
- Phone numbers compare by number and code.
- Ordering with a nullish operand is false.
- Primitive ordering otherwise follows JavaScript ordering semantics.

## Assignment, scope, and dependencies

Assignments expose dependencies from variable paths and filter arguments. The
dependency graph maps each input variable to assignments affected by it, traversing
nested conditionals and loops. Cycles are reported rather than evaluated as a normal
acyclic dependency chain.

Assignment-before-use validation treats variables provided by the input context as
available. Variables introduced in a branch or loop are visible according to the
existing traversal rules; a missing dependency produces a validation diagnostic.

Portable consumers should eventually receive assignment targets and values as separate
fields instead of reparsing `args` text. This is especially important for `parseAssign`,
which creates literal arrays and objects used by later array operations.

## Special constructs

`parseAssign` accepts only literal values: numbers, booleans, `null`, quoted strings,
and quoted JSON arrays/objects. Computed expressions, unquoted variables, malformed
JSON, and trailing commas are invalid.

`computeColumn table column` evaluates its body once per row. The current row is
available as `self`, temporary assignments do not mutate the outer context, and the
target column receives the value assigned to `$$answer`. If no top-level `$$answer`
assignment exists, the target remains undefined.

`sumArray` behavior is observable for empty arrays, null row values, and currency
values; these cases need differential fixtures. The documented real-world patterns
also require `concat`, `uniq`, `strip_html`, `strip`, and LiquidJS's scope-chain rule
where an assignment inside a loop may update an already-declared outer variable.

## Compatibility evidence

The source of truth is the local LiquidJS fork and its computation source modules,
custom filters, custom tags, integration tests, and regression tests.

When a consumer intentionally differs, add a versioned rule and a fixture for the
difference. Do not silently reinterpret an existing rule.

## Migration roadmap

The work is intentionally staged so behavior can be verified before adding a new
language:

1. **Behavior contract** — record the existing computation rules and regression cases.
2. **Portable IR** — extract complete LiquidJS structure, source locations, and
   dependencies without deciding how a consumer should implement it.
3. **Reference computation language** — build a small language with arithmetic,
   property paths, comparisons, and `if`/`else`, plus an evaluator, to verify the IR
   and generated behavior. Its first arithmetic forms are `+`, `-`, `*`, `plus`,
   `minus`, `times`, `divided_by`, `add`, and `subtract`; conditions support `==`, `!=`, `>`,
   `<`, `>=`, and `<=`.
4. **Consumer generation** — generate the reference language first, then add any
   target language as an additional consumer of the same IR.
5. **Differential verification** — compare each consumer against LiquidJS using the
   shared fixtures for values, errors, and dependencies.
6. **Visual workbench** — use `angular-playground` to inspect LiquidJS input, the
   generated IR, selected consumer output, source ranges, dependencies, errors,
   and side-by-side behavior comparisons. This remains a development and
   validation tool, not part of the core conversion pipeline.

The reference language is a verification tool, not a replacement for the target
language. It lives in its own package so `liquid-core` remains focused on
LiquidJS parsing and extraction. Keep it small until the IR and behavior contract
are stable.
