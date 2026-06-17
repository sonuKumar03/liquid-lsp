import { SymbolKind, DocumentSymbol, Range } from 'vscode-languageserver';
import type { DocumentSymbolParams } from 'vscode-languageserver';
import {
  TagTokenClass,
  parseAssignKeyValueWithOffsets,
  parseCaptureVariableWithOffsets,
  parseForLoopVariableWithOffsets,
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

import { ASSIGN_TAG_NAMES } from '../shared/constants.js';

function pushVariableSymbol(
  symbols: DocumentSymbol[],
  stack: { symbol: DocumentSymbol; endTag: string }[],
  varName: string,
  range: Range,
  selectionRange: Range,
): void {
  const symbol = DocumentSymbol.create(
    varName,
    'Variable',
    SymbolKind.Variable,
    range,
    selectionRange,
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
    const tokenText = token.getText();
    const argsOffset = tokenText.indexOf(token.args);

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

      // Create variable symbols inside capture and for blocks
      if (name === 'capture') {
        const parsed = parseCaptureVariableWithOffsets(token.args);
        if (parsed && argsOffset >= 0) {
          const absStart = token.begin + argsOffset + parsed.keyStart;
          const absEnd = token.begin + argsOffset + parsed.keyEnd;
          const selectionRange = Range.create(doc.positionAt(absStart), doc.positionAt(absEnd));
          pushVariableSymbol(rootSymbols, stack, parsed.key, range, selectionRange);
        }
      } else if (name === 'for') {
        const parsed = parseForLoopVariableWithOffsets(token.args);
        if (parsed && argsOffset >= 0) {
          const absStart = token.begin + argsOffset + parsed.keyStart;
          const absEnd = token.begin + argsOffset + parsed.keyEnd;
          const selectionRange = Range.create(doc.positionAt(absStart), doc.positionAt(absEnd));
          pushVariableSymbol(rootSymbols, stack, parsed.key, range, selectionRange);
        }
      }
      continue;
    }

    const topItem = stack[stack.length - 1];
    if (name.startsWith('end') && topItem && topItem.endTag === name) {
      const top = stack.pop()!;
      top.symbol.range.end = endPos;
      continue;
    }

    if (ASSIGN_TAG_NAMES.has(name)) {
      const parsed = parseAssignKeyValueWithOffsets(token.args);
      if (parsed) {
        let selectionRange = range;
        if (argsOffset >= 0) {
          const absStart = token.begin + argsOffset + parsed.keyStart;
          const absEnd = token.begin + argsOffset + parsed.keyEnd;
          selectionRange = Range.create(doc.positionAt(absStart), doc.positionAt(absEnd));
        }
        pushVariableSymbol(rootSymbols, stack, parsed.key, range, selectionRange);
      }
    }
  }

  return rootSymbols;
}
