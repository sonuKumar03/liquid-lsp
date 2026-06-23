# LSP Refactoring Guide for Computational Liquid Templates

This document outlines refactoring operations the LSP should support for Liquid computation worksheets. Each refactor is designed to improve **correctness**, **readability**, and **maintainability** of formula-heavy templates written by domain experts.

---

## 1. Extract Variable

**Trigger**: A filter chain or sub-expression is used more than once across the document.

**Operation**: The LSP detects repeated sub-expressions and offers to extract them into a named intermediate variable, placing the `{% assign %}` tag directly above the first usage.

```liquid
{# Before #}
{{ price | minus: discount | times: 1.18 }}
...
{{ price | minus: discount | divided_by: 12 }}

{# After: "Extract to variable" → name it "net_price" #}
{% assign net_price = price | minus: discount %}
{{ net_price | times: 1.18 }}
...
{{ net_price | divided_by: 12 }}
```

> [!TIP]
> Reduces the risk of one copy of the formula being updated while the other is missed.

---

## 2. Inline Variable

**Trigger**: A variable is assigned once and used in exactly one place.

**Operation**: The LSP offers to inline the variable's definition directly at its usage site, removing the intermediate `{% assign %}` tag.

```liquid
{# Before #}
{% assign tax = price | times: 0.18 %}
{{ tax }}

{# After: "Inline variable" #}
{{ price | times: 0.18 }}
```

> [!NOTE]
> Only safe when the variable is used exactly once and has no side effects.

---

## 3. Simplify Redundant Filter Chain

**Trigger**: A filter chain contains redundant, no-op, or duplicate filters that can be safely collapsed.

**Operation**: The LSP detects and removes or merges redundant filter steps.

```liquid
{# Before — redundant defaults #}
{{ value | default: 0 | default: 0 | plus: 10 }}

{# After #}
{{ value | default: 0 | plus: 10 }}
```

```liquid
{# Before — chained upcase/downcase cancel each other #}
{{ name | upcase | downcase }}

{# After #}
{{ name | downcase }}
```

---

## 4. Convert `if/else` to `default` Filter

**Trigger**: An `{% if/else %}` block only exists to provide a fallback value for a variable.

**Operation**: Collapse the entire conditional into a single `| default:` filter expression.

```liquid
{# Before #}
{% if contract_value %}
  {{ contract_value }}
{% else %}
  N/A
{% endif %}

{# After #}
{{ contract_value | default: "N/A" }}
```

> [!TIP]
> Dramatically reduces document length in templates heavy on conditional fallbacks.

---

## 5. Sort Assignments by Dependency Order

**Trigger**: `{% assign %}` / `{% assignVar %}` / `{% parseAssign %}` tags are out of natural dependency order — a variable is used before it is defined.

**Operation**: The LSP analyzes the dependency graph of all assignments and reorders them so every variable is defined before its first use.

```liquid
{# Before — "net" uses "discount" which is defined later #}
{% assign net = price | minus: discount %}
{% assign discount = price | times: 0.1 %}

{# After: "Sort by dependency order" #}
{% assign discount = price | times: 0.1 %}
{% assign net = price | minus: discount %}
```

> [!IMPORTANT]
> The LSP performs a topological sort of the variable dependency graph and will warn if a circular dependency prevents sorting.

---

## 6. Remove Dead Assignments

**Trigger**: A variable is assigned but never read or rendered anywhere in the document.

**Operation**: The LSP offers to delete the dead `{% assign %}` tag entirely, or to add a `{{ variable }}` output if the omission looks accidental.

```liquid
{# Before #}
{% assign unused_rate = base | times: 0.05 %}   {# never used #}
{% assign tax = base | times: 0.18 %}

{# After: "Remove dead assignment" #}
{% assign tax = base | times: 0.18 %}
```

---

## 7. Split Long Filter Chain into Steps

**Trigger**: A filter chain exceeds a configurable number of pipes (e.g. more than 4), making it hard to read and debug.

**Operation**: Break the chain into labeled intermediate variables that each perform one logical step.

```liquid
{# Before #}
{% assign result = base | minus: discount | times: tax_rate | divided_by: 12 | round: 2 %}

{# After: "Split into steps" #}
{% assign after_discount  = base | minus: discount %}
{% assign with_tax        = after_discount | times: tax_rate %}
{% assign monthly         = with_tax | divided_by: 12 %}
{% assign result          = monthly | round: 2 %}
```

> [!TIP]
> Each intermediate step becomes individually debuggable and hover-evaluatable by the LSP.

---

## 8. Normalize `parseAssign` JSON

**Trigger**: The JSON string inside a `{% parseAssign %}` tag is minified, inconsistently spaced, or has keys in a non-alphabetical order.

**Operation**: Reformat the JSON string literal to be consistently structured.

```liquid
{# Before #}
{% parseAssign item = '{"cost":450,"title":"License","active":true}' %}

{# After: "Format JSON" #}
{% parseAssign item = '{"active": true, "cost": 450, "title": "License"}' %}
```

---

## 9. Flatten Nested Conditionals

**Trigger**: Nested `{% if %}` blocks can be collapsed into a single condition using `and`.

**Operation**: Merge redundant nested conditions into a single flat conditional.

```liquid
{# Before #}
{% if user %}
  {% if user.is_active %}
    {{ user.name }}
  {% endif %}
{% endif %}

{# After: "Flatten conditionals" #}
{% if user and user.is_active %}
  {{ user.name }}
{% endif %}
```

---

## 10. Align `if/else` Variable Assignments

**Trigger**: A variable is assigned inside an `{% if %}` branch but missing from the `{% else %}` branch (or vice versa), leaving it potentially `nil` on one code path.

**Operation**: The LSP offers to scaffold the missing assignment in the other branch with a sensible default, ensuring the variable is always defined regardless of path.

```liquid
{# Before — "final_price" is nil when is_enterprise is false #}
{% if is_enterprise %}
  {% assign final_price = price | times: 0.8 %}
{% else %}
  {# nothing here #}
{% endif %}

{# After: "Add missing else assignment" #}
{% if is_enterprise %}
  {% assign final_price = price | times: 0.8 %}
{% else %}
  {% assign final_price = price %}
{% endif %}
```
