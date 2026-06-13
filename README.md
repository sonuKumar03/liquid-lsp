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

### 9. Predefined Variable Schemas
Statically load global variables and their types during server initialization or from a workspace `.liquid-schema.json` configuration file. Supported types include:
* **Primitive Types**: `'string'`, `'number'`, `'boolean'`, `'date'`, `'currency'`
* **Dropdown List Options**: `{ type: 'dropdown', options: string[] }` (automatically warns on string assignment mismatches)
* **Composite Object Structure**: `{ type: 'composite', fields: { ... } }`

### 10. parseAssign Tag & Type Coercion
Statically resolves nested dot-notation properties on composite objects (e.g. `user.address.zipcode`) and supports type coercion for custom objects:
* **Composite -> String**: Coerces composite objects to `string` (equivalent to `.toString()`).
* **Currency -> Number**: Coerces `currency` variables to `number` (equivalent to `.toValueOf()`).
* Includes full support for bracket access/list index lookups (e.g. `user.items[0].title`) and filters on assignments.

---

## Client Connection & Deployment Modes

The Liquid LSP supports three different configuration modes depending on your client workspace:

### 1. Local Stdio Mode (Default)
By default, the VS Code extension runs locally. It automatically compiles and spawns the local LSP server process in the background and communicates over `stdio`. No setup is required.

### 2. Remote TCP Socket Mode
If you host the LSP server on a remote server/VM, you can configure the VS Code client to connect directly over a TCP socket:
1. Start the LSP server in Socket mode on the remote VM:
   ```bash
   node lsp-engine/dist/main.js --socket=6009
   ```
2. Configure your VS Code settings:
   ```json
   "liquid.server.mode": "remote",
   "liquid.server.host": "your-remote-server-ip",
   "liquid.server.port": 6009
   ```

### 3. Express WebSocket Gateway (Monaco Editor / Browsers)
For browser-based editors (like Monaco Editor) that cannot launch local child processes or use raw TCP sockets, run the included `express-server` WebSocket gateway:
1. Start the gateway server:
   ```bash
   npm start --workspace=express-server
   ```
   This exposes a WebSocket LSP gateway endpoint at `ws://localhost:3000/lsp`.
2. Connect your Monaco Editor (or web client) to the WebSocket endpoint to receive real-time lints, diagnostics, completions, and hover documentation.
3. **Angular Integration**: For a step-by-step example of setting up Monaco Editor inside an Angular application and linking it to this WebSocket gateway, refer to the [Angular Integration Guide](./angular_integration.md).

---

## Debugging Extension and LSP Server

You can debug the VS Code client extension and the LSP server concurrently inside VS Code:

1. Open this repository root folder in VS Code.
2. Go to the **Run and Debug** view in the sidebar (`Ctrl+Shift+D` or `Cmd+Shift+D`).
3. Select **`Debug Client & Server`** from the dropdown menu and press `F5`.
4. This will:
   * Run the root build command to compile all files.
   * Open a new **[Extension Development Host]** window with the extension activated.
   * Spawn the LSP server in debug mode listening on inspect port `6009`.
   * Automatically attach VS Code's debugger to the LSP server process.
5. You can now set breakpoints in:
   * `vscode-extension/src/client.ts` (client extension code)
   * `lsp-engine/src/**/*.ts` (LSP server logic)

---

## Technical Details

* **Language**: TypeScript (ESModules, strictly typed)
* **Underlying Engines**: `liquidjs`, `vscode-languageserver`, `fastest-levenshtein`
* **Test Suite**: Fully verified integration test coverage running LSP JSON-RPC clients in child processes via Vitest.
