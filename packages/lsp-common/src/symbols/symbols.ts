import { SymbolKind, DocumentSymbol, Range } from 'vscode-languageserver';
import type { DocumentSymbolParams } from 'vscode-languageserver';
import { TagTokenClass } from 'liquid-core';
import type { Liquid } from 'liquid-core';
import type { DocumentManager } from '../server/document-manager.js';

export function handleDocumentSymbol(
  documentManager: DocumentManager,
  liquidEngine: Liquid,
  params: DocumentSymbolParams,
): DocumentSymbol[] {
  const doc = documentManager.documents.get(params.textDocument.uri);
  if (!doc) return [];

  const tokens = documentManager.getTokens(
    params.textDocument.uri,
    liquidEngine,
  );

  const rootSymbols: DocumentSymbol[] = [];
  const stack: { symbol: DocumentSymbol; endTag: string }[] = [];

  const blockStartTags = ['if', 'for', 'unless', 'capture', 'case'];

  for (const token of tokens) {
    const startPos = doc.positionAt(token.begin);
    const endPos = doc.positionAt(token.end);
    const range = Range.create(startPos, endPos);

    if (token instanceof TagTokenClass) {
      const name = token.name;

      if (blockStartTags.includes(name)) {
        const symbol = DocumentSymbol.create(
          `${name} ${token.args.trim()}`.trim(),
          undefined,
          SymbolKind.Namespace,
          range,
          range,
          [],
        );

        const endTag = `end${name}`;

        const parent = stack[stack.length - 1];
        if (parent) {
          parent.symbol.children!.push(symbol);
        } else {
          rootSymbols.push(symbol);
        }
        stack.push({ symbol, endTag });
        continue;
      }

      const topItem = stack[stack.length - 1];
      if (name.startsWith('end') && topItem && topItem.endTag === name) {
        const top = stack.pop()!;
        top.symbol.range.end = endPos;
        continue;
      }

      if (name === 'assign') {
        const match = token.getText().match(/assign\s+([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          const varName = match[1];
          const symbol = DocumentSymbol.create(
            varName,
            'Variable',
            SymbolKind.Variable,
            range,
            range,
          );
          const parent = stack[stack.length - 1];
          if (parent) {
            parent.symbol.children!.push(symbol);
          } else {
            rootSymbols.push(symbol);
          }
        }
      }
    }
  }

  return rootSymbols;
}
