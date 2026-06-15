import { Range, WorkspaceEdit, ResponseError, ErrorCodes } from 'vscode-languageserver';
import type { RenameParams } from 'vscode-languageserver';
import { getWordAtPosition, tokenizeTopLevelSafe, createLiquidEngine } from 'liquid-core';
import { findVariableDeclarationsFromTokens } from '../shared/variable-declarations.js';
import type { DocumentManager } from '../server/document-manager.js';
import type { LiquidType } from '../shared/schema.js';

export function handleRename(
  documentManager: DocumentManager,
  params: RenameParams,
  globalSchema?: Map<string, LiquidType>,
): WorkspaceEdit | null {
  const doc = documentManager.documents.get(params.textDocument.uri);
  if (!doc) return null;

  const position = params.position;
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 },
  });

  const word = getWordAtPosition(lineText, position.character);
  if (!word) return null;

  const newName = params.newName.trim();
  if (!newName) {
    throw new ResponseError(ErrorCodes.InvalidParams, 'New name cannot be empty.');
  }

  // 1. External Schema Guard for old variable name
  if (globalSchema?.has(word)) {
    throw new ResponseError(
      ErrorCodes.InternalError,
      `Cannot rename "${word}" — it is defined in the external schema and controlled by the backend. Renaming it here will break runtime data injection.`
    );
  }

  // 2. External Schema Guard for new variable name
  if (globalSchema?.has(newName)) {
    throw new ResponseError(
      ErrorCodes.InternalError,
      `Cannot rename to "${newName}" — it is defined in the external schema and controlled by the backend.`
    );
  }

  const engine = createLiquidEngine();
  const tokens = tokenizeTopLevelSafe(doc.getText(), engine);
  const declarations = findVariableDeclarationsFromTokens(doc, tokens);

  // 3. Naming Collision / Shadowing Check
  const collision = declarations.find((d) => d.name === newName);
  if (collision) {
    const declLine = collision.range.start.line;
    throw new ResponseError(
      ErrorCodes.InternalError,
      `Naming collision: renaming "${word}" to "${newName}" will shadow an existing variable defined on line ${declLine + 1}.`
    );
  }

  // Find all occurrences of the word in the document text
  const docText = doc.getText();
  
  // Clean comments and strings preserving character counts
  let cleanText = docText;
  
  // Clean {% comment %} ... {% endcomment %}
  cleanText = cleanText.replace(/\{%\s*comment\s*%\}([\s\S]*?)\{%\s*endcomment\s*%\}/g, (match) => {
    return ' '.repeat(match.length);
  });
  
  // Clean {# ... #}
  cleanText = cleanText.replace(/\{#([\s\S]*?)#\}/g, (match) => {
    return ' '.repeat(match.length);
  });

  // Clean strings preserving quotes
  cleanText = cleanText.replace(/"([^"\\]|\\.)*"/g, (match) => {
    return '"' + ' '.repeat(match.length - 2) + '"';
  });
  cleanText = cleanText.replace(/'([^'\\]|\\.)*'/g, (match) => {
    return "'" + ' '.repeat(match.length - 2) + "'";
  });

  const regex = new RegExp(`\\b${word}\\b`, 'g');
  const textEdits = [];
  let match;

  while ((match = regex.exec(cleanText)) !== null) {
    const startPos = doc.positionAt(match.index);
    const endPos = doc.positionAt(match.index + word.length);
    textEdits.push({
      range: Range.create(startPos, endPos),
      newText: newName,
    });
  }

  if (textEdits.length === 0) {
    return null;
  }

  return {
    changes: {
      [params.textDocument.uri]: textEdits,
    },
  };
}
