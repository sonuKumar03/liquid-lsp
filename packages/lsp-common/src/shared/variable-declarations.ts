import { Range } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  createLiquidEngine,
  TagTokenClass,
  tokenizeTopLevel,
  parseAssignKeyValueWithOffsets,
  parseCaptureVariableWithOffsets,
  parseForLoopVariableWithOffsets,
  type Token,
} from 'liquid-core';

export interface VarDeclaration {
  name: string;
  range: Range;
}

const ASSIGN_TAG_NAMES = new Set(['assign', 'assignVar', 'parseAssign']);

export function findVariableDeclarationsFromTokens(
  doc: TextDocument,
  tokens: Token[],
): VarDeclaration[] {
  const declarations: VarDeclaration[] = [];

  for (const token of tokens) {
    if (!(token instanceof TagTokenClass)) {
      continue;
    }

    const tagName = token.name;
    const args = token.args;
    const rawText = token.getText();
    const argsOffset = rawText.indexOf(args);

    if (argsOffset < 0) {
      continue;
    }

    if (ASSIGN_TAG_NAMES.has(tagName)) {
      const parsed = parseAssignKeyValueWithOffsets(args);
      if (parsed) {
        const absStart = token.begin + argsOffset + parsed.keyStart;
        const absEnd = token.begin + argsOffset + parsed.keyEnd;
        declarations.push({
          name: parsed.key,
          range: Range.create(doc.positionAt(absStart), doc.positionAt(absEnd)),
        });
      }
      continue;
    }

    if (tagName === 'capture') {
      const parsed = parseCaptureVariableWithOffsets(args);
      if (parsed) {
        const absStart = token.begin + argsOffset + parsed.keyStart;
        const absEnd = token.begin + argsOffset + parsed.keyEnd;
        declarations.push({
          name: parsed.key,
          range: Range.create(doc.positionAt(absStart), doc.positionAt(absEnd)),
        });
      }
      continue;
    }

    if (tagName === 'for') {
      const parsed = parseForLoopVariableWithOffsets(args);
      if (parsed) {
        const absStart = token.begin + argsOffset + parsed.keyStart;
        const absEnd = token.begin + argsOffset + parsed.keyEnd;
        declarations.push({
          name: parsed.key,
          range: Range.create(doc.positionAt(absStart), doc.positionAt(absEnd)),
        });
      }
    }
  }

  return declarations;
}

export function findVariableDeclarations(
  doc: TextDocument,
  tokens?: Token[],
): VarDeclaration[] {
  if (tokens && tokens.length > 0) {
    return findVariableDeclarationsFromTokens(doc, tokens);
  }

  try {
    const engine = createLiquidEngine();
    const parsedTokens = tokenizeTopLevel(doc.getText(), engine);
    return findVariableDeclarationsFromTokens(doc, parsedTokens);
  } catch {
    return [];
  }
}
