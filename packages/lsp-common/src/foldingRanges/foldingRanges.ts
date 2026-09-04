import { FoldingRange, FoldingRangeKind } from 'vscode-languageserver';
import type { FoldingRangeParams } from 'vscode-languageserver';
import { TagTokenClass, BLOCK_OPEN_TAG_NAMES, type Liquid } from 'liquid-core';
import type { DocumentManager } from '../server/document-manager.js';

export function handleFoldingRanges(
  documentManager: DocumentManager,
  params: FoldingRangeParams,
  liquidEngine: Liquid,
): FoldingRange[] | null {
  const doc = documentManager.documents.get(params.textDocument.uri);
  if (!doc) return null;

  const tokens = documentManager.getTokens(
    params.textDocument.uri,
    liquidEngine,
  );
  const foldingRanges: FoldingRange[] = [];

  // Track open tags on a stack
  const stack: { name: string; line: number }[] = [];

  for (const token of tokens) {
    if (!(token instanceof TagTokenClass)) {
      continue;
    }

    const name = token.name;

    // Check if it's an open block tag (or the standard 'raw' block tag)
    if (BLOCK_OPEN_TAG_NAMES.has(name) || name === 'raw') {
      stack.push({
        name,
        line: doc.positionAt(token.begin).line,
      });
      continue;
    }

    // Check if it's a close block tag (starts with 'end')
    if (name.startsWith('end')) {
      const openName = name.slice(3); // e.g. 'endif' -> 'if'
      // Find the most recent matching open tag on the stack
      const openIdx = stack.map((s) => s.name).lastIndexOf(openName);
      if (openIdx !== -1) {
        const openTag = stack[openIdx]!;
        const startLine = openTag.line;
        const endLine = doc.positionAt(token.end).line;

        if (endLine > startLine) {
          const range: FoldingRange = {
            startLine,
            endLine,
          };
          if (openName === 'comment') {
            range.kind = FoldingRangeKind.Comment;
          }
          foldingRanges.push(range);
        }
        // Remove the matched open tag and all younger unmatched tags
        stack.splice(openIdx);
      }
    }
  }

  // Find multiline inline comments: {# ... #}
  const docText = doc.getText();
  const inlineCommentRegex = /\{#([\s\S]*?)#\}/g;
  let match;

  while ((match = inlineCommentRegex.exec(docText)) !== null) {
    const startLine = doc.positionAt(match.index).line;
    const endLine = doc.positionAt(match.index + match[0].length).line;

    if (endLine > startLine) {
      foldingRanges.push({
        startLine,
        endLine,
        kind: FoldingRangeKind.Comment,
      });
    }
  }

  return foldingRanges.length > 0 ? foldingRanges : null;
}
