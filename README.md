# LiquidJS Computational LSP

A specialized Language Server Protocol (LSP) server tailored specifically for non-technical users writing Liquid expressions for pure calculations (computational worksheets/sheets) rather than HTML pages. It enforces safety, auto-corrects syntax, provides filter assistance, and formats files to keep worksheets clean and error-free.

---

## Key Features & Capabilities

### 1. Type Mismatch Linter Warnings
The LSP statically infers variable types (`string`, `number`, `boolean`, `unknown`) based on literal assignments and filter outputs. It automatically flags warning squiggles if mathematical filters are applied to non-numeric variables.
* **Example:**
  ```liquid
  {% assign name = "john" %}
  {% assign age = name | plus: 25 %}
  ```
  *LSP Warning on `plus`:* `Type mismatch: Math filter "plus" is applied to a string value.`

### 2. Redundant Redefinition Warnings
To prevent logic errors, the LSP warns developers if they overwrite (re-assign) a variable before its previous value was ever read in the template.
* **Example:**
  ```liquid
  {% assign score = 100 %}
  {% assign score = 200 %}
  ```
  *LSP Warning on line 1:* `Variable "score" is overwritten here but its value was never read.`

### 3. Inline Math Auto-Converter (Quick-Fix)
Since Liquid does not native support inline mathematical operators (`+`, `-`, `*`, `/`), the LSP detects inline math expressions, flags them, and offers an automatic Quick-Fix to translate them into standard Liquid math filters.
* **Example:**
  ```liquid
  {% assign total = price + 5 %}
  ```
  *LSP Quick-Fix:* Converts the line to `{% assign total = price | plus: 5 %}`.

### 4. Filter Signature Help
When typing arguments for Liquid filters, a signature tooltip displays the list of parameters, their types, defaults, and usage documentation.
* **Example:** Typing `{{ description | truncate: ` displays:
  ```typescript
  truncate(length: number, truncate_string: string = "...")
  ```
  *Documentation:* `Truncates a string down to the number of characters passed as the first parameter. An optional second parameter can be passed to append to the truncated string.`

### 5. Document Spacing Formatter
Provides standard code formatting (`textDocument/formatting`) that cleans up double spaces and structures operators, pipes, and delimiters for optimal readability.
* **Before:**
  ```liquid
  {%assign  x=10%}
  {{name|upcase}}
  ```
* **After Formatting:**
  ```liquid
  {% assign x = 10 %}
  {{ name | upcase }}
  ```

### 6. Spelling Auto-Correction (Quick-Fix)
Uses Levenshtein edit distance to detect mistyped filter names and suggests the correct filter as a Quick-Fix.
* **Example:**
  ```liquid
  {{ "hello" | upcasee }}
  ```
  *LSP Warning & Quick-Fix:* `Unknown filter "upcasee". Did you mean "upcase"?` -> Suggests changing to `upcase`.

### 7. Multiple Syntax Error Diagnostics
Instead of failing on the first error, the LSP runs a token-by-token parser that isolates errors inside specific tags, reporting all syntax issues across the document concurrently.

### 8. Document Outline & Symbols
Translates control flows (`if`, `unless`, `for`, `case`, `capture`) and variable assignments (`assign`) into a nested visual Outline inside the editor's outline sidebar.

---

## Technical Details

* **Language**: TypeScript (ESModules, strictly typed)
* **Underlying Engines**: `liquidjs`, `vscode-languageserver`, `fastest-levenshtein`
* **Test Suite**: Fully verified integration test coverage running LSP JSON-RPC clients in child processes via Node's native test runner.
