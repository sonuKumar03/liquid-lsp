# Running the Liquid Parser & Tokenizer

This document explains how developers or scripts can parse and tokenize Liquid computational worksheets locally in the repository.

---

## 1. Quick Start

The `run-parser-demo.js` helper script has been removed. To inspect tokenization and parsing results, run the existing unit tests in `packages/liquid-core/src`:

```bash
# From the repo root
pnpm --filter liquid-core test
```

To write a one-off exploration script, import directly from the built package:

```bash
# Build first
pnpm run build

# Then run a temporary script via node
cd packages/liquid-core
node --input-type=module <<'EOF'
import { createLiquidEngine, tokenizeTopLevel } from './dist/index.js';
const tokens = tokenizeTopLevel('{% assign x = 1 %}{{ x }}');
tokens.forEach(t => console.log(`Kind: ${t.kind}, Text: "${t.getText()}"`));
EOF
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
