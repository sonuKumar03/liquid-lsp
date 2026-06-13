import { Location, Range } from 'vscode-languageserver';
import type { DefinitionParams } from 'vscode-languageserver';
import { TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getWordAtPosition } from 'liquid-core';
import { getVariablePathAtPosition } from '../hovers/hovers.js';
import { findVariableDeclarations } from '../shared/variable-declarations.js';
import * as fs from 'fs';
import * as path from 'path';

export function locatePathInJson(jsonText: string, varPath: string): Range | null {
  const parts = varPath.split('.');
  let currentOffset = 0;

  for (const part of parts) {
    const regex = new RegExp(`"(${part})"\\s*:`, 'g');
    regex.lastIndex = currentOffset;

    const match = regex.exec(jsonText);
    if (match) {
      currentOffset = match.index;
    } else {
      const fallbackRegex = new RegExp(`"(${parts[parts.length - 1]})"\\s*:`);
      const fallbackMatch = fallbackRegex.exec(jsonText);
      if (fallbackMatch) {
        currentOffset = fallbackMatch.index;
      }
      break;
    }
  }

  if (currentOffset === 0) {
    return Range.create({ line: 0, character: 0 }, { line: 0, character: 0 });
  }

  const lines = jsonText.substring(0, currentOffset).split('\n');
  const line = lines.length - 1;
  const character = lines[lines.length - 1]?.length ?? 0;

  const lastPart = parts[parts.length - 1] ?? '';
  return Range.create(
    { line, character: character + 1 },
    { line, character: character + 1 + lastPart.length },
  );
}

export function handleDefinition(
  documents: TextDocuments<TextDocument>,
  params: DefinitionParams,
  workspaceRoot?: string | null,
): Location | null {
  const doc = documents.get(params.textDocument.uri);
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

  const declarations = findVariableDeclarations(doc);
  const matched = declarations.find((d) => d.name === word);
  if (matched) {
    return Location.create(doc.uri, matched.range);
  }

  const fullPath = getVariablePathAtPosition(lineText, position.character);
  if (workspaceRoot && fullPath) {
    const schemaFilePath = path.join(workspaceRoot, '.liquid-schema.json');
    if (fs.existsSync(schemaFilePath)) {
      try {
        const jsonText = fs.readFileSync(schemaFilePath, 'utf8');
        const range = locatePathInJson(jsonText, fullPath);
        if (range) {
          const fileUri = `file://${schemaFilePath.replace(/\\/g, '/')}`;
          return Location.create(fileUri, range);
        }
      } catch {
        // ignore
      }
    }
  }

  return null;
}
