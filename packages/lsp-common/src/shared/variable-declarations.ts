import { Range } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  createLiquidEngine,
  TagTokenClass,
  tokenizeTopLevel,
  parseAssignKeyValue,
  parseCaptureVariable,
  parseForLoopVariable,
  type Token,
} from 'liquid-core';

export interface VarDeclaration {
  name: string;
  range: Range;
}

const ASSIGN_TAG_NAMES = new Set(['assign', 'assignVar', 'parseAssign']);

function identifierRangeInTagToken(
  doc: TextDocument,
  token: InstanceType<typeof TagTokenClass>,
  identifier: string,
): Range {
  const raw = token.getText();
  const openIdx = raw.indexOf('%');
  const searchFrom = openIdx >= 0 ? openIdx + 1 : 0;
  const idIdx = raw.indexOf(identifier, searchFrom);
  const nameStart = idIdx >= 0 ? token.begin + idIdx : token.begin;
  const nameEnd = nameStart + identifier.length;
  return Range.create(doc.positionAt(nameStart), doc.positionAt(nameEnd));
}

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

    if (ASSIGN_TAG_NAMES.has(tagName)) {
      const parsed = parseAssignKeyValue(args);
      if (parsed) {
        declarations.push({
          name: parsed.key,
          range: identifierRangeInTagToken(doc, token, parsed.key),
        });
      }
      continue;
    }

    if (tagName === 'capture') {
      const varName = parseCaptureVariable(args);
      if (varName) {
        declarations.push({
          name: varName,
          range: identifierRangeInTagToken(doc, token, varName),
        });
      }
      continue;
    }

    if (tagName === 'for') {
      const varName = parseForLoopVariable(args);
      if (varName) {
        declarations.push({
          name: varName,
          range: identifierRangeInTagToken(doc, token, varName),
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
