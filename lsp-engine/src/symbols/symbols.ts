import { SymbolKind, DocumentSymbol, Range } from 'vscode-languageserver/node';
import type { DocumentSymbolParams, TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Token } from 'liquidjs';
import liquidjs from 'liquidjs';
const { Tokenizer, TagToken: TagTokenClass } = liquidjs;

export function handleDocumentSymbol(
  documents: TextDocuments<TextDocument>,
  params: DocumentSymbolParams
): DocumentSymbol[] {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const text = doc.getText();
  const tokenizer = new Tokenizer(text);
  let tokens: Token[];
  try {
    tokens = tokenizer.readTopLevelTokens();
  } catch {
    return [];
  }

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
        // Start of a block tag
        const symbol = DocumentSymbol.create(
          `${name} ${token.args.trim()}`.trim(),
          undefined,
          SymbolKind.Namespace,
          range,
          range,
          []
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
        // Close the current block tag
        const top = stack.pop()!;
        top.symbol.range.end = endPos; // extend block range to the end tag
        continue;
      }

      // Check for variable declaration tag (assign)
      if (name === 'assign') {
        const match = token.getText().match(/assign\s+([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          const varName = match[1];
          const symbol = DocumentSymbol.create(
            varName,
            'Variable',
            SymbolKind.Variable,
            range,
            range
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
