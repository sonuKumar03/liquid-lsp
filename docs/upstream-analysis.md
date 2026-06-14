## Project Goal

Build a Language Server Protocol (LSP) implementation for the SpotDraft Liquid computation language.

The focus is:

* Computation analysis
* Validation
* Dependency analysis
* Type checking

Not:

* Template rendering
* Shopify compatibility
* Theme development

---

## High-Level Architecture

```txt
Editor
  │
  ▼
LSP Server
  │
  ▼
Analyzer
  │
  ▼
AST
  │
  ▼
Tokenizer / Parser
```

---

## Core Principle

Do not build a full Liquid renderer.

Build a computation analyzer.

---

## Phase 1

### Tokenizer

Responsibilities:

* Liquid tags
* Output tags
* Identifiers
* Operators
* Filters
* Numbers
* Strings

Output:

```ts
Token[]
```

---

### Parser

Responsibilities:

Convert tokens into AST.

Supported initially:

* assign
* parseAssign
* computeColumn
* output expressions
* variables
* filters

Output:

```ts
DocumentNode
```

---

### AST

Example:

```ts
AssignNode
FilterExpressionNode
VariableNode
LiteralNode
OutputNode
```

---

## Phase 2

### Symbol Table

Tracks:

```txt
variable name
type
definition location
references
```

---

### Type System

Custom types:

```txt
number
string
boolean
date
duration
currency
unknown
```

---

### Operation Rules

Examples:

```txt
date + duration => date
date - date => duration
currency + currency => currency
date + date => invalid
```

---

### Dependency Graph

Example:

```txt
renewal_date
 ├─ start_date
 └─ term
```

---

## Phase 3

### Diagnostics

Examples:

```txt
undefined variable
invalid arithmetic
cyclic dependency
invalid type usage
```

---

### Completion

Examples:

```txt
customer.name
customer.email
customer.phone_number
```

---

### Hover

Examples:

```txt
renewal_date: date
```

---

### Go To Definition

Navigate:

```txt
usage -> declaration
```

---

### References

Find all usages of a symbol.

---

### Rename

Rename variable safely.

---

## Initial Scope

Support:

```txt
assign
parseAssign
computeColumn
if
for
variables
filters
comparisons
```

Ignore initially:

```txt
render
include
layout
raw
comment
theme features
```

---

## Success Criteria

The LSP can:

1. Parse computation templates.
2. Build dependency graph.
3. Resolve variable types.
4. Detect invalid computations.
5. Provide autocomplete.
6. Provide hover information.
7. Provide diagnostics.

```
```
