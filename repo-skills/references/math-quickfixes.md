# Math and Tag Spelling Typos & Quick Fixes

This document records the standard typos and patterns for Liquid mathematical operations and tag spelling checks, along with the rules for automatically converting them to valid Liquid filters via Quick Fixes.

---

## 1. Math Typos & Expected Conversions

Since Liquid does not support inline mathematical operators, the LSP detects them and suggests corrections:

| Typo Pattern | Example | Expected Liquid Filter Conversion |
| :--- | :--- | :--- |
| **Standard Math** | `a + b` | `a \| plus: b` |
| **Pipe Operator** | `a \| + b` | `a \| plus: b` |
| **Chained Math** | `1 + 2 + 3` | `1 \| plus: 2 \| plus: 3` |
| **Compound Assignment** | `a += 5` | `a = a \| plus: 5` |
| **Increment** | `a++` | `a = a \| plus: 1` |
| **Decrement** | `a--` | `a = a \| minus: 1` |

---

## 2. Token-Based Lexer Approach

To avoid fragile regular expressions that can trigger false matches inside quoted strings, comments, or nested constructs, the math quick-fix parser relies on LiquidJS's native `Tokenizer`:

### Token Classification
1. **Value**: Numbers, quoted strings, or identifier variables (parsed as `NumberToken`, `QuotedToken`, or `PropertyAccessToken`).
2. **Operator**: Valid Liquid built-in operators.
3. **Other**: Any single characters (like `+`, `-`, `*`, `/`, `=`, or `|`) that the Tokenizer yields as separate characters.

### Pattern Processing Rules
- **Decrement Normalization**: Because `-` is allowed in variable names, `a--` is parsed as a single `PropertyAccessToken` with text `"a--"`. The parser normalizes this by splitting it into `Value("a")`, `Other("-")`, `Other("-")`.
- **Compound Assignment**: Matches sequence `Value(var) Other(op) Other(=) Value(val)`. Rewrites to `var = var \| filterName: val`.
- **Increments**: Matches sequence `Value(var) Other(op) Other(op)`. Rewrites to `var = var \| filterName: 1`.
- **Chained Math**: Recursively parses `Value(op1) [Optional Other("\|")] Other(operator) Value(op2)`. Replaces matches with a single folded `Value` token from left to right.

---

## 3. Tag Spelling Gaps

If a tag is misspelled (e.g. `{% asign x = 1 %}`):
- The parser fails to recognize the tag and logs an `UNKNOWN_TAG` diagnostic.
- The LSP computes the closest tag using Levenshtein distance against `LIQUID_TAG_NAMES`.
- Suggests a Quick Fix: `Change tag to "assign"`.
