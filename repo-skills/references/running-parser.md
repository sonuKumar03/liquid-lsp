# Running the Liquid Parser & Tokenizer

This document explains how developers or scripts can parse and tokenize Liquid computational worksheets locally in the repository.

---

## 1. Quick Start

We have created a helper script inside `packages/liquid-core/run-parser-demo.js`. You can use it to test and print the tokenization and parsing results of any Liquid code snippet.

To run it:
```bash
# Make sure the packages are built first
rtk proxy pnpm run build

# Run the demo script using Node
cd packages/liquid-core
node run-parser-demo.js
```

---

## 2. API Usage Reference

If you want to write your own scripts to inspect templates or analyze tokens, import the following helpers from `liquid-core`:

```typescript
import { createLiquidEngine, tokenizeTopLevel } from 'liquid-core';
```

### A. Tokenization (`tokenizeTopLevel`)
Tokenizes standard template contents into top-level tokens (HTML/text, Liquid Tag, or Liquid Output blocks).

```typescript
const tokens = tokenizeTopLevel('{% assign x = 1 %}{{ x }}');
tokens.forEach(t => {
  console.log(`Kind: ${t.kind}, Text: "${t.getText()}"`);
});
```

### B. Parsing to AST (`createLiquidEngine`)
Parses template contents into an Abstract Syntax Tree (AST) using our LiquidJS computational parser.

```typescript
const engine = createLiquidEngine();
const templates = engine.parse('{% assign x = 1 %}{% if x == 1 %}Hello{% endif %}');

// Root-level templates
templates.forEach(tpl => {
  console.log(`Type: ${tpl.constructor.name}`);
  
  // Tag tokens are accessible via:
  if (tpl.token) {
    console.log(`Tag Name: ${tpl.token.name}`);
  }
  
  // Inner templates (for conditional blocks, loops, etc.) are in:
  if (tpl.templates) {
    console.log(`Has ${tpl.templates.length} child template(s)`);
  }
});
```
