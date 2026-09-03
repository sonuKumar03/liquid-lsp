# Roadmap: Must-Have LSP Features for Computational Languages

This document outlines the highest-priority Language Server Protocol (LSP) features for a computation-focused templating language used by domain experts (lawyers, contract managers, finance analysts) who write Liquid computation text but are not software engineers.

---

## 1. Automatic Coercion & Fallback Quick Fixes

At runtime, forms and data models often contain blank fields or values of mismatching types (e.g., a text input used in currency calculations).

### Key Features

- **Implicit Coercion Warnings**: The linter raises a warning when an optional variable, string, or unknown value is directly passed into math filters (`plus`, `minus`, `times`, `divided_by`).
- **Interactive Fallback Quick Fixes**: One-click solutions to inject safe default filters:
  > [!TIP]
  > Offer to turn `{{ price | plus: tax }}` into `{{ price | default: 0 | plus: tax }}`.
- **Format-to-Numeric Validation**: Warnings if string literals containing non-numeric characters are used as inputs for mathematical operations.

---

## 2. Rename Collision & Shadowing Prevention

If a developer renames a helper variable to a name that already exists in scope, it accidentally shadows the existing computation, silently corrupting downstream calculations.

### Key Features

- **Scope Collision Check**: Before applying a rename, scan all active variables in the same file and parent blocks. If the target name conflicts, block and warn:
  > [!WARNING]
  > _Naming collision: renaming "temp" to "tax_rate" will shadow an existing variable defined on line 12. Proceed anyway?_
- **Block-Scope Awareness**: The check is block-aware — a name collision inside a `{% for %}` or `{% if %}` block only warns if the variable is also in the parent scope.
- **External Schema Guard**: If the rename target is an externally injected schema variable (e.g. `contract_value` from `.liquid-schema.json`), block the rename entirely:
  > [!CAUTION]
  > _Cannot rename "contract_value" — it is defined in the external schema and controlled by the backend. Renaming it here will break runtime data injection._

---

## 3. Nil Propagation & Optional Chain Diagnostics

When a chain of computations has a `nil` anywhere in the middle, the entire output silently becomes `nil`. This is the most common silent bug in worksheet engines.

### Key Features

- **Upstream Nil Tracing**: If a source variable is `optional` in the schema, trace all downstream assignments that depend on it and mark them with a ⚠️ nil-propagation warning:
  ```liquid
  {% assign subtotal = contract.items | sum: "price" %}
  {% assign tax = subtotal | times: tax_rate %}
  {# ↑ Warning: "tax" may be nil — "contract.items" is optional #}
  ```
- **Nil-Safe Filter Suggestions**: Quick fix to insert a `| default: 0` or `| default: ""` at the earliest nil entry point in the chain, preventing propagation.
- **Output Block Nil Warnings**: If a `{{ }}` output expression resolves to a potentially nil value with no default filter, warn that the rendered output will be blank.

---

## 4. Semantic Flow Highlighting

Color-code variables by their **role in the computation graph** so authors can instantly understand the shape of a document's computation at a glance.

### Key Features

- **Source inputs** 🟦 (from external schema — e.g. `contract_value`, `effective_date`): Highlighted in **blue**.
- **Intermediate computations** 🟨 (local `assign` / `assignVar` — calculated values): Highlighted in **yellow**.
- **Output variables** 🟩 (used in `{{ }}` output expressions — the final rendered values): Highlighted in **green**.
- **Dead variables** 🔴 (assigned but never read or rendered): Highlighted in **faded red**.

```liquid
{{ contract_value }}                                   ← 🟦 Source input
{% assign base = contract_value | minus: discount %}   ← 🟨 Intermediate
{% assign tax  = base | times: 0.18 %}                 ← 🟨 Intermediate
{{ tax }}                                              ← 🟩 Output
{% assign unused = base | plus: 1 %}                   ← 🔴 Dead variable
```

---

## 5. Multi-Branch Type Consistency

When the same output variable is assigned in both branches of an `{% if %}`, the resolved types must match — otherwise downstream filters may behave differently depending on the execution path.

### Key Features

- **Cross-Branch Type Comparison**: After an `{% if/else %}` block, compare the resolved types of all variables assigned in both branches.
- **Type Mismatch Diagnostic**: If types differ, raise an error at the downstream usage site:
  ```liquid
  {% if is_enterprise %}
    {% assign rate = 0.15 %}         {# number #}
  {% else %}
    {% assign rate = "standard" %}   {# string #}
  {% endif %}
  {{ rate | times: base_price }}
  {# ⚠️ "rate" is a string in the else-branch — | times: will break at runtime #}
  ```
- **Quick Fix**: Offer to align types across all branches to the same primitive type.

---

## 6. Filter Argument Type Checking

Filter arguments are currently unvalidated. The LSP should check that arguments match the expected type for each built-in and custom filter.

### Key Features

- **Argument Type Validation**: Match provided argument types against a filter's expected parameter types:

  ```liquid
  {{ price | divided_by: "two" }}
  {# ⚠️ "divided_by" expects a number argument, got a string literal "two" #}

  {{ name | truncate: "short" }}
  {# ⚠️ "truncate" expects a number for the length argument, got a string #}
  ```

- **Custom Filter Signatures**: Extend validation to custom worksheet filters (`toCurrency`, `toDate`, `plus`, etc.) using a declared type signature registry.
- **Named Argument Validation**: For filters that accept named keyword arguments (e.g. `date: "%Y-%m-%d"`), validate the format string patterns and warn on common mistakes.

---

## 7. Plain Language Diagnostic Messages

Technical error messages are meaningless to a non-developer domain expert. Every diagnostic should be written in the language of the user — not the language of the runtime.

### Key Features

- **Human-Readable Rewrites** for all diagnostics:

  | Technical Message                                 | Plain Language                                                                           |
  | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
  | `Property "x" does not exist on "items".`         | `"items" doesn't have a field called "x". Available fields are: title, price, quantity.` |
  | `Type mismatch: string filter applied to number.` | `"upcase" only works on text. "contract_value" is a number, not text.`                   |
  | `Variable "rate" used before assignment.`         | `You used "rate" before defining it. Move the {% assign rate = ... %} line above this.`  |
  | `Nil propagation warning on "tax".`               | `"tax" might be blank if "contract.items" has no data. Add a fallback value.`            |

- **Actionable Messages**: Every warning includes a suggested next step, not just a description of the problem.
- **Severity Tone Calibration**: Errors feel urgent; warnings feel advisory — using friendly, non-alarming language for warnings.

---

## 8. Contextual Examples in Hover & Autocomplete

When a domain expert hovers over a filter or sees it in autocomplete, they need a **concrete, domain-relevant example** — not a type signature or API reference.

### Key Features

- **Rich Hover Cards** with inline examples for every filter:

  ```
  | times:
  ─────────────────────────────────────
  Multiply a number by another value.

  Example:
    {{ 5000 | times: 0.18 }}  →  900.0
    {{ base_salary | times: 1.3 }}  →  (30% raise)

  ⚠️  Both values must be numbers. Use | default: 0 if either might be blank.
  ```

- **Schema-Aware Examples**: When the document schema is available, the hover card uses **real variable names from the current schema** instead of generic placeholders:
  ```
  Instead of:  {{ value | divided_by: divisor }}
  Shows:       {{ contract_value | divided_by: term_length }}
  ```
- **Autocomplete Preview**: Inline filter suggestions in the autocomplete list show a one-line result preview next to each option so the expert can pick the right filter by output, not by name.
