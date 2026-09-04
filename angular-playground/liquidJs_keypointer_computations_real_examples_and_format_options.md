# LiquidJS Key-Pointer Computations — Real Examples, Format Options & Specter Comparison

> Grounded in the SpotDraft code in `/workspace/repos` (cfexporter, liquidjs, django-rest-api) and the compiled wiki at `/workspace/repos/spotdraft-wiki`.
> All Liquid syntax below is verified against the actual LiquidJS fork (`liquidjs/filters.js`, `liquidjs/tags/*`) and the computation mapper (`cfexporter/src/computation/computation-liquidjs-mapper.ts`).

---

## 1. The three things you're actually asking about

There are **three distinct concepts** that people frequently conflate:

| #   | Thing                                                  | Where it lives                                                                                        | What it does                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **Key-pointer `format_option`**                        | `historic_contracts.KeyPointer.format_option` (a JSON dict per field)                                 | The **runtime type/schema and rendering config** for one field: `type`, `label`, `precision`, `showInWords`, `formatting`, `options`, etc. It does not calculate the value, but it determines the value shape and runtime typing. |
| B   | **Workflow LiquidJS computation** (`computation_text`) | `public_workflow_v1_workflowsetting.computation_text` (also passed to cfexporter as `common_cf_text`) | The **formula** — LiquidJS template that derives new variable values from questionnaire inputs.                                                                                                                                   |
| C   | **Specter / Computation Library formula**              | `core_computation.formula` / `resolved_formula`                                                       | A **function-call DSL** (e.g. `If(Exists(x), Add(a,b), 0)`) that also derives values.                                                                                                                                             |

So "key pointer computation in LiquidJS form" = you take a **key pointer** (a field with a `format_option`), and write a **LiquidJS computation** that assigns a value to that field's slug; the `format_option` then controls how the computed value is displayed.

---

## 2. Key-pointer format options — the schema you care about

Each key pointer / questionnaire variable carries a `format_option` object. The shape is type-dependent. These are the exact fields seen in the cfexporter `FormatOption` model (`cfexporter/src/api/controllers/commonform-api.model.ts`) and the Django parser types (`django-rest-api/historic_contracts/types.py`).

### 2.1 `currency`

```json
{
  "type": "currency",
  "label": "Annual OTE",
  "precision": 0,
  "showInWords": false,
  "inWordsFormat": "CHICAGO_STYLE",
  "isIsoPrefixEnabled": true,
  "default": { "type": "INR", "value": 2300000 },
  "placeholder": "eg- 100000, 200000",
  "requiredOptions": { "type": "STATIC", "byParty": "SUBSCRIBER", "expression": "true" }
}
```

**Value shape in blanks:** `{ "type": "USD", "value": 1234.5 }`

### 2.2 `duration`

```json
{
  "type": "duration",
  "label": "Days During Period",
  "default": { "days": 0, "type": "DAYS", "value": null },
  "placeholder": "eg- 3, 4"
}
```

**Value shape in blanks:** `{ "days": 90, "type": "MONTHS", "value": 3 }` — `days` is always the normalized day count (MONTHS = 30 days, YEARS = 365, WEEKS = 7).

### 2.3 `date`

```json
{
  "type": "date",
  "label": "Plan End Date",
  "formatting": "MMMM Do, YYYY",
  "renderDateStringComponent": true
}
```

**Value shape in blanks:** an ISO-ish string, e.g. `"2022-02-21"`. Rendering honors `formatting` (and a workspace universal `date_format` unless `overrideUniversalConfig: true`).

### 2.4 `dropdown`

```json
{
  "type": "dropdown",
  "label": "Position Type",
  "options": [
    { "label": "Sales Development Representative", "value": "0" },
    { "label": "Team Lead - SDR", "value": "1" }
  ]
}
```

**Value shape in blanks:** a plain string = the option `value`.

### 2.5 `number`

```json
{ "type": "number", "label": "Term Months", "precision": 0, "minValue": 0, "maxValue": 1200 }
```

**Value shape in blanks:** a JS number.

### 2.6 `repeating` / dynamic table (`table`)

```json
{
  "type": "repeating",
  "label": "Services Breakdown",
  "attributes": {
    "sd_hourly_rate": { "type": "currency", "precision": 2 },
    "sd_hours": { "type": "number" },
    "sd_total": { "type": "currency", "computed": true, "computationText": "{% assign $$answer = self.sd_hourly_rate | times: self.sd_hours %}" }
  }
}
```

**Value shape in blanks:** an array of row objects. This is where `{% computeColumn %}` iterates.

> **Key mental model:** the `format_option` defines the field's runtime type and value shape, and that type participates in operation/filter/tag dispatch as well as display. The computation language (Liquid or Specter) produces a value that must conform to that type; currency arithmetic, duration arithmetic, table operations, coercion, and validation depend on the type context.

---

## 3. Lengthy LiquidJS key-pointer computations — real examples

These use **real variable slugs and real format options** taken from the cfexporter test fixtures (the actual `compensation_plan` template used in the export microservice test suite) and from documented customer patterns in the wiki (validated against the current LiquidJS fork code).

### 3.1 Currency: Annual OTE = base salary + variable (real fixture)

```liquid
{% assign sd_annual_ote = sd_annual_base_salary | plus: sd_variable_amount %}
```

**Real inputs (fixture values):**

- `sd_annual_base_salary` = `{ "type": "INR", "value": 2 }`
- `sd_variable_amount` = `{ "type": "INR", "value": 700000 }`

**Result:** `sd_annual_ote` = `{ "type": "INR", "value": 700002 }` (the `plus` filter merges the two currency objects and adds `value`).

**Format option** for `sd_annual_ote` = the currency block from §2.1 (`precision: 0`, `showInWords: false`, `isIsoPrefixEnabled: true`), so it renders as `INR 700002`.

### 3.2 Duration: total days = plan end − quota start (real fixture)

```liquid
{% assign sd_total_days = sd_plan_end_date | minus: sd_quota_start_date %}
```

**Real inputs:** both are date strings `"2022-02-21"`.
**Result:** `sd_total_days` = `{ "type": "DAYS", "value": 0, "days": 0 }` (subtracting two dates returns a duration object; `days` is the normalized difference).

**Format option** = the duration block from §2.2. Renders as `0 Days` via `DurationType.to_string`.

### 3.3 Build a currency value from a number (dot-notation limitation)

```liquid
{% assign sd_min_service_fee = sd_minimum_hours | times: 125 | toCurrency: "USD" %}
```

Produces `{ "type": "USD", "value": <hours × 125> }`.

> ⚠️ Do **not** write `{% assign sd_x.value = ... %}` — the LiquidJS `assign` tag only captures bare identifiers, so dot-notation property assignment silently breaks. Chain `| toCurrency: "USD"` instead.

### 3.4 Build a duration value

```liquid
{% assign sd_term = sd_term_value | toDuration: "MONTHS" %}
```

Produces `{ "value": <n>, "type": "MONTHS", "days": <n*30> }`.

### 3.5 Normalize a currency's type (currency-mismatch fix)

```liquid
{% assign sd_vat = sd_vat_amount | updateTypeAttribute: "EUR" %}
```

(Or `| updateAttribute: "type", "EUR"`.) Used when a static VAT field carries a hardcoded currency but the dynamic table switched currencies.

### 3.6 Date arithmetic + formatting inside Liquid

```liquid
{% assign sd_total_days = sd_plan_end_date | minus: sd_quota_start_date %}
{% assign sd_display_date = "now" | date: "%Y-%m-%d" %}
```

The `date` filter uses strftime codes (`%Y`, `%m`, `%d`, `%B`, `%A`, `%H`, `%M`, `%S`, etc. — verified in `liquidjs/src/util/strftime.js`). Note this is a _different_ format mechanism from the key-pointer `formatting: "MMMM Do, YYYY"` which is applied at render time, not inside the computation.

### 3.7 Conditional on a dropdown value (real fixture pattern)

```liquid
{% if sd_position_type == "1" %}
  {% assign sd_prorated_variable_amount = sd_variable_amount %}
{% else %}
  {% assign sd_prorated_variable_amount = 0 %}
{% endif %}
```

`sd_position_type` is a dropdown whose `format_option.options` are `[{label:"SDR", value:"0"}, {label:"Team Lead", value:"1"}]`. Compare against the **`value`**, not the label.

### 3.8 Dynamic-table per-row computation (`computeColumn`)

```liquid
{% computeColumn sd_breakdown_of_services_and_remuneration sd_total %}
  {% assign $$answer = self.sd_hourly_rate | times: self.sd_hours %}
{% endcomputeColumn %}
```

- `sd_breakdown_of_services_and_remuneration` = repeating field (table), rows have `sd_hourly_rate` (currency) and `sd_hours` (number).
- `self.*` = current row; `$$answer` = the per-row output written into the new `sd_total` column.
- Currency × number is handled correctly (currency type preserved).
- The closing `{% endcomputeColumn %}` is **mandatory** — missing it throws `tag computeColumn ... not closed`.

### 3.9 Aggregate a table column (`sumArray`)

```liquid
{% assign sd_grand_total = sd_breakdown_of_services_and_remuneration | sumArray: "sd_total" %}
```

With an explicit currency seed (only used when the array is empty):

```liquid
{% parseAssign sd_default_currency = '{"value": 0, "type": "EUR"}' %}
{% assign sd_grand_total = sd_breakdown_of_services_and_remuneration | sumArray: "sd_total", sd_default_currency %}
```

> Gotchas (documented customer bugs): (a) `sumArray`'s `defaultSum` param is **ignored when the array is non-empty**; (b) a `null` in any row propagates and collapses the sum — pre-fill empties with `| default: 0` inside `computeColumn`; (c) the result of `sumArray` may need `| toCurrency: "EUR"`.

### 3.10 Multi-select dropdown populated from table rows (array building)

```liquid
{% parseAssign _result = "[]" %}
{% for p in sd_commercials %}
  {% assign _prod = p.sd_product | strip_html | strip %}
  {% if _prod == "Group Coaching License" %}
    {% assign _result = _result | concat: "GROUP COACHING" %}
  {% endif %}
{% endfor %}
{% assign sd_prod_des = _result | uniq %}
```

Key facts: multi-select fields need **arrays** (not scalar `assign`); `parseAssign` initializes a real array; `concat` appends; `uniq` dedupes. `strip_html | strip` cleans paragraph fields that render HTML-wrapped.

### 3.11 Scope-chain climbing warning (loop variable overwrite)

```liquid
{% assign sd_dummy_band = nil %}
{% for row in pricing_tiers %}
  {% assign sd_dummy_band = row.band %}   {# OVERWRITES the outer variable every iteration #}
{% endfor %}
```

The SpotDraft Liquid fork does **scope-chain climbing**: `assign` inside a loop updates the _first scope that already declares the variable_, not a loop-local scope. Result: you only see the last row's value. **Fix:** one variable per iteration target, and a scratch variable reset each iteration.

---

## 4. How the computation pipeline actually runs (cfexporter)

Verified in `cfexporter/src/contract-data/blanks-generator.ts`:

1. Sanitize rich-text blanks; expand addresses (`$block`/`$inline`).
2. **Dynamic-table computations first** (`computeDynamicTableFields` → per-row `computationText`).
3. **Global Liquid computation** (`applyComputations` → `liquidEngine.parseAndRender(computationText, blanks)`).
4. Build table variables.
5. **Format options applied** (`formatAllBlanks`) — currency symbols, date format, words, precision.

So a computed value flows: _format-option type schema → typed Liquid result → format-option rendering → rendered string in docx/HTML_.

---

## 5. Workflow LiquidJS vs. Specter (Computation Library) — comparison

| Aspect           | Workflow LiquidJS (`computation_text`)                                                                               | Specter / Computation Library                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage          | `public_workflow_v1_workflowsetting.computation_text`                                                                | `core_computation.formula` / `resolved_formula`                                                                                                                               |
| Language         | LiquidJS (SpotDraft fork + custom filters/tags)                                                                      | Function-call DSL (`If`, `Add`, `Multiply`, `GetColumn`, `SortBy`, `Exists`, `IsNull`…)                                                                                       |
| Scope            | Embedded in one workflow/template                                                                                    | Reusable library entries, linked to workflows via `EntityDependencyMapping`                                                                                                   |
| Engine           | `liquidEngine.parseAndRender` in cfexporter `BlanksGenerator`                                                        | Specter evaluator (`evaluateSpecter`)                                                                                                                                         |
| Execution order  | Runs **first**                                                                                                       | Runs **after** Liquid and **overwrites** the same slug (verified in `questionnaire-form.service.ts`: "Always run computations v2 (specter) regardless of liquid computation") |
| Per-row / tables | `{% computeColumn %}` + `sumArray`, `map`, `concat`, `uniq`                                                          | `GetColumn` + `Add`/`Filter`; often needs an intermediate computed column                                                                                                     |
| Type system      | Explicit objects: currency `{value,type}`, duration `{days,type,value}`; `toCurrency`/`toDuration`/`updateAttribute` | Typed with inference (e.g. `DIVIDE` of two currencies infers `currency` — can surprise a `number` field)                                                                      |
| BigQuery sync    | ✅ `computation_text` is synced                                                                                      | ❌ formula text excluded (only IDs)                                                                                                                                           |
| UI behavior      | Computed but field not strictly locked                                                                               | Field locked/read-only in the questionnaire                                                                                                                                   |
| Best for         | String/currency-symbol formatting, complex table iteration, legacy templates                                         | Reusable shared formulas, enforced read-only fields, cleaner arithmetic chains                                                                                                |

**When both are configured on the same variable:** Liquid computes, then Specter overwrites — only the Specter result is visible. Use one or the other.

### Specter example (equivalent of §3.1)

```
Add(intake.sd_annual_base_salary, intake.sd_variable_amount)
```

### Specter null-handling (show "NA" when empty)

```
If(Exists(intake.sd_slug), intake.sd_slug, "NA")
```

For text/dropdown fields (catches empty strings too):

```
If(And(Exists(intake.sd_slug), Not(Equals(intake.sd_slug, ""))), intake.sd_slug, "NA")
```

---

## 6. On "real user data"

What I could verify with real data:

- ✅ **Real computation strings + real format options + real field values** from the cfexporter `compensation_plan` test fixture (used by the actual export microservice): `sd_annual_ote`, `sd_total_days`, `sd_annual_base_salary`, `sd_variable_amount`, `sd_quota_start_date`, `sd_plan_end_date`, `sd_position_type`, etc.
- ✅ **Real customer patterns** from the compiled wiki (variable slugs and behaviors), each re-validated against current code (`liquidjs/filters.js`, `computation-liquidjs-mapper.ts`, `blanks-generator.ts`).

What I could **not** do:

- ❌ Pull live production customer data from BigQuery. The `bq` CLI is read-only here, and the production project/dataset is not accessible to this sandbox's credentials (`Access Denied` on `public_workflow_v1_workflowsetting`). So I cannot paste actual customer `computation_text` values with real names/amounts from prod.

If you have a specific workspace/contract type you want real rows from, I can write the read-only BQ/Sentry query, but I'll need that access granted (or the workspace id + a confirm that the table is queryable).

---

## Sources

- `cfexporter/src/contract-data/blanks-generator.ts` — computation execution order
- `cfexporter/src/computation/computation-liquidjs-mapper.ts` — LiquidJS mapping (currency/duration literals, `parseAssign`, `sd_cb
