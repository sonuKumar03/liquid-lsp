# Liquid LSP Context

We are building an LSP for a SpotDraft LiquidJS fork.

Focus: computation analysis, not rendering.

Core features to support:

- assign
- parseAssign
- computeColumn
- variables
- filters
- if/for expressions
- custom date, duration, currency types
- dependency graph
- undefined variable diagnostics
- invalid arithmetic diagnostics

Do not build full Liquid rendering support.

Architecture:

- liquid-core: tokenizer/parser/AST/analyzer/type-system/dependency-graph
- liquid-lsp: completion/hover/diagnostics/definition/references/rename
- vscode-extension: LSP client
- monaco-adapter: web editor client

Important type rules:

- date + duration => date
- date - duration => date
- date - date => duration
- date + date => invalid
- currency + currency => currency
- duration \* number => duration

Initial implementation scope:

1. Tokenizer
2. Parser for assign/output/filter expressions
3. Computation AST
4. Symbol table
5. Type resolver
6. Diagnostics
7. LSP wrapper

Prefer reusing LiquidJS tokenizer/parser if source positions are good enough.
Build our own computation AST/analyzer on top.
