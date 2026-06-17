import type { SemanticTokensParams, SemanticTokens } from 'vscode-languageserver';
import { createLiquidEngine, tokenizeTopLevelSafe, TagTokenClass, TokenKind } from 'liquid-core';
import { findVariableDeclarationsFromTokens } from '../shared/variable-declarations.js';
import type { DocumentManager } from '../server/document-manager.js';
import type { LiquidType } from '../shared/schema.js';

export const SEMANTIC_TOKEN_TYPES = ['source', 'intermediate', 'output'];
export const SEMANTIC_TOKEN_MODIFIERS = ['dead'];

interface TokenOccurrence {
  line: number;
  char: number;
  length: number;
  typeIdx: number;
  modifierMask: number;
}

export function handleSemanticTokens(
  documentManager: DocumentManager,
  params: SemanticTokensParams,
  globalSchema?: Map<string, LiquidType>,
): SemanticTokens | null {
  const doc = documentManager.documents.get(params.textDocument.uri);
  if (!doc) return null;

  const engine = createLiquidEngine();
  const tokens = tokenizeTopLevelSafe(doc.getText(), engine);
  const declarations = findVariableDeclarationsFromTokens(doc, tokens);

  const docText = doc.getText();
  
  // Clean comments and strings to find valid variable occurrences
  let cleanText = docText;
  cleanText = cleanText.replace(/\{%\s*comment\s*%\}([\s\S]*?)\{%\s*endcomment\s*%\}/g, (match) => ' '.repeat(match.length));
  cleanText = cleanText.replace(/\{#([\s\S]*?)#\}/g, (match) => ' '.repeat(match.length));
  cleanText = cleanText.replace(/"([^"\\]|\\.)*"/g, (match) => '"' + ' '.repeat(match.length - 2) + '"');
  cleanText = cleanText.replace(/'([^'\\]|\\.)*'/g, (match) => "'" + ' '.repeat(match.length - 2) + "'");

  const schemaVars = new Set(globalSchema ? Array.from(globalSchema.keys()) : []);
  const localVars = new Set(declarations.map((d) => d.name));
  const allVars = new Set([...schemaVars, ...localVars]);

  // Determine usage roles
  const outputVars = new Set<string>();
  const readVars = new Set<string>();

  // Scan output tags and tags for variable reads
  for (const token of tokens) {
    const text = token.getText();
    if (token.kind === TokenKind.Output) {
      const expr = text.slice(2, -2);
      for (const v of allVars) {
        if (new RegExp(`\\b${v}\\b`).test(expr)) {
          outputVars.add(v);
          readVars.add(v);
        }
      }
    } else if (token instanceof TagTokenClass) {
      const args = token.args;
      for (const v of allVars) {
        // A variable is read in a tag if it is not the target of assign/capture/for
        const isDeclaration =
          (token.name === 'assign' || token.name === 'assignVar' || token.name === 'parseAssign' || token.name === 'capture' || token.name === 'for') &&
          new RegExp(`^\\s*${v}\\b`).test(args);
        if (!isDeclaration && new RegExp(`\\b${v}\\b`).test(args)) {
          readVars.add(v);
        }
      }
    }
  }

  const occurrences: TokenOccurrence[] = [];

  for (const v of allVars) {
    const isSource = schemaVars.has(v);
    const isOutput = outputVars.has(v);
    const isDead = localVars.has(v) && !readVars.has(v);

    let typeIdx = 1; // Default to intermediate
    if (isSource) {
      typeIdx = 0; // source
    } else if (isOutput) {
      typeIdx = 2; // output
    }

    const modifierMask = isDead ? 1 : 0; // dead modifier

    const regex = new RegExp(`\\b${v}\\b`, 'g');
    let match;
    while ((match = regex.exec(cleanText)) !== null) {
      const pos = doc.positionAt(match.index);
      occurrences.push({
        line: pos.line,
        char: pos.character,
        length: v.length,
        typeIdx,
        modifierMask,
      });
    }
  }

  // Sort occurrences by line, then char
  occurrences.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    return a.char - b.char;
  });

  // Build the delta-encoded array
  const data: number[] = [];
  let lastLine = 0;
  let lastChar = 0;

  for (const occ of occurrences) {
    const deltaLine = occ.line - lastLine;
    const deltaChar = deltaLine === 0 ? occ.char - lastChar : occ.char;
    data.push(deltaLine, deltaChar, occ.length, occ.typeIdx, occ.modifierMask);
    lastLine = occ.line;
    lastChar = occ.char;
  }

  return { data };
}
