import type { Hover, TextDocumentPositionParams } from 'vscode-languageserver/node';
import { TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { LIQUID_TAGS, LIQUID_FILTERS, getTagDocumentation, getFilterDocumentation } from './constants.js';
import { getWordAtPosition } from './utils.js';

export function handleHover(
  documents: TextDocuments<TextDocument>,
  params: TextDocumentPositionParams
): Hover | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const position = params.position;
  // Get the entire line text containing the cursor
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 }
  });

  const word = getWordAtPosition(lineText, position.character);
  if (!word) return null;

  // Determine if the hover coordinate resides inside Liquid tag or output delimiters
  const lastTagOpen = lineText.lastIndexOf('{%', position.character);
  const lastTagClose = lineText.lastIndexOf('%}', position.character);
  const lastOutputOpen = lineText.lastIndexOf('{{', position.character);
  const lastOutputClose = lineText.lastIndexOf('}}', position.character);

  const isInsideTag = lastTagOpen !== -1 && lastTagOpen > lastTagClose;
  const isInsideOutput = lastOutputOpen !== -1 && lastOutputOpen > lastOutputClose;

  if (!isInsideTag && !isInsideOutput) {
    return null;
  }

  // Check if the hovered word is a recognized tag
  const tagDoc = getTagDocumentation(word);
  const isKnownTag = LIQUID_TAGS.some(t => t.label === word);
  if (isInsideTag && isKnownTag) {
    return {
      contents: {
        kind: 'markdown',
        value: `**Liquid Tag: \`{% ${word} %}\`**\n\n${tagDoc}`
      }
    };
  }

  // Check if the hovered word is a recognized filter
  const filterDoc = getFilterDocumentation(word);
  const isKnownFilter = LIQUID_FILTERS.some(f => f.label === word);
  if (isKnownFilter) {
    return {
      contents: {
        kind: 'markdown',
        value: `**Liquid Filter: \`| ${word}\`**\n\n${filterDoc}`
      }
    };
  }

  return null;
}
