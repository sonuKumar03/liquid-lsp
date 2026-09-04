import { Location, Range } from 'vscode-languageserver';
import type { ReferenceParams } from 'vscode-languageserver';
import {
  getWordAtPosition,
  tokenizeTopLevelSafe,
  createLiquidEngine,
} from 'liquid-core';
import type { DocumentManager } from '../server/document-manager.js';
import { findVariableDeclarationsFromTokens } from '../shared/variable-declarations.js';

export function handleReferences(
  documentManager: DocumentManager,
  params: ReferenceParams,
): Location[] | null {
  const doc = documentManager.documents.get(params.textDocument.uri);
  if (!doc) return null;

  const position = params.position;
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 },
  });

  const word = getWordAtPosition(lineText, position.character);
  if (!word) return null;

  const lastTagOpen = lineText.lastIndexOf('{%', position.character);
  const lastTagClose = lineText.lastIndexOf('%}', position.character);
  const lastOutputOpen = lineText.lastIndexOf('{{', position.character);
  const lastOutputClose = lineText.lastIndexOf('}}', position.character);

  const isInsideTag = lastTagOpen !== -1 && lastTagOpen > lastTagClose;
  const isInsideOutput =
    lastOutputOpen !== -1 && lastOutputOpen > lastOutputClose;

  if (!isInsideTag && !isInsideOutput) {
    return null;
  }

  const locations: Location[] = [];
  const engine = createLiquidEngine();

  for (const d of documentManager.documents.all()) {
    const uri = d.uri;
    const docText = d.getText();

    // Clean comments and strings preserving character counts
    let cleanText = docText;

    // Clean {% comment %} ... {% endcomment %}
    cleanText = cleanText.replace(
      /\{%\s*comment\s*%\}([\s\S]*?)\{%\s*endcomment\s*%\}/g,
      (match: string) => {
        return ' '.repeat(match.length);
      },
    );

    // Clean {# ... #}
    cleanText = cleanText.replace(/\{#([\s\S]*?)#\}/g, (match: string) => {
      return ' '.repeat(match.length);
    });

    // Clean strings preserving quotes
    cleanText = cleanText.replace(/"([^"\\]|\\.)*"/g, (match: string) => {
      return '"' + ' '.repeat(match.length - 2) + '"';
    });
    cleanText = cleanText.replace(/'([^'\\]|\\.)*'/g, (match: string) => {
      return "'" + ' '.repeat(match.length - 2) + "'";
    });

    const regex = new RegExp(`\\b${word}\\b`, 'g');
    let match;

    while ((match = regex.exec(cleanText)) !== null) {
      const startPos = d.positionAt(match.index);
      const endPos = d.positionAt(match.index + word.length);
      const range = Range.create(startPos, endPos);

      if (!params.context.includeDeclaration) {
        // Find if this match is a declaration in the current document
        const tokens = tokenizeTopLevelSafe(docText, engine);
        const declarations = findVariableDeclarationsFromTokens(d, tokens);
        const isDecl = declarations.some(
          (decl) =>
            decl.name === word &&
            decl.range.start.line === range.start.line &&
            decl.range.start.character === range.start.character,
        );
        if (isDecl) {
          continue;
        }
      }

      locations.push(Location.create(uri, range));
    }
  }

  return locations.length > 0 ? locations : null;
}
