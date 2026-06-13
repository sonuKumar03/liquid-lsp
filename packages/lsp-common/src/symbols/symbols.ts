import { SymbolKind, DocumentSymbol, Range } from 'vscode-languageserver';
import type { DocumentSymbolParams } from 'vscode-languageserver';
import {
  TagTokenClass,
  parseAssignKeyValue,
  parseCaptureVariable,
  parseForLoopVariable,
} from 'liquid-core';
import type { Liquid } from 'liquid-core';
import type { DocumentManager } from '../server/document-manager.js';

const BLOCK_START_TAGS = [
  'if',
  'for',
  'unless',
  'capture',
  'case',
  'tablerow',
  'comment',
];

const ASSIGN_TAG_NAMES = new Set(['assign', 'assignVar', 'parseAssign']);

function pushVariableSymbol(
  symbols: DocumentSymbol[],
  stack: { symbol: DocumentSymbol; endTag: string }[],
  varName: string,
  range: Range,
): void {
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
    symbols.push(symbol);
  }
}

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

  for (const token of tokens) {
    const startPos = doc.positionAt(token.begin);
    const endPos = doc.positionAt(token.end);
    const range = Range.create(startPos, endPos);

    if (!(token instanceof TagTokenClass)) {
      continue;
    }

    const name = token.name;

    if (BLOCK_START_TAGS.includes(name)) {
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

    if (ASSIGN_TAG_NAMES.has(name)) {
      const parsed = parseAssignKeyValue(token.args);
      if (parsed) {
        pushVariableSymbol(rootSymbols, stack, parsed.key, range);
      }
      continue;
    }

    if (name === 'capture') {
      const varName = parseCaptureVariable(token.args);
      if (varName) {
        pushVariableSymbol(rootSymbols, stack, varName, range);
      }
      continue;
    }

    if (name === 'for') {
      const varName = parseForLoopVariable(token.args);
      if (varName) {
        pushVariableSymbol(rootSymbols, stack, varName, range);
      }
    }
  }

  return rootSymbols;
}
