import { Location, Range } from 'vscode-languageserver/node';
import type { DefinitionParams } from 'vscode-languageserver/node';
import { TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getWordAtPosition } from '../shared/utils.js';
import { getVariablePathAtPosition } from '../hovers/hovers.js';
import * as fs from 'fs';
import * as path from 'path';

interface VarDeclaration {
  name: string;
  range: Range;
}

export function findVariableDeclarations(doc: TextDocument): VarDeclaration[] {
  const text = doc.getText();
  const declarations: VarDeclaration[] = [];

  // 1. {% assign var = ... %} or {% assignVar var = ... %}
  const assignPattern = /\{%\s*(assign|assignVar)\s+([a-zA-Z0-9_-]+)\s*=/g;
  let match: RegExpExecArray | null;
  while ((match = assignPattern.exec(text))) {
    if (match[2]) {
      const name = match[2];
      const nameStart = match.index + match[0].indexOf(name);
      const nameEnd = nameStart + name.length;
      declarations.push({
        name,
        range: Range.create(doc.positionAt(nameStart), doc.positionAt(nameEnd)),
      });
    }
  }

  // 2. {% capture var %}
  const capturePattern = /\{%\s*capture\s+([a-zA-Z0-9_-]+)\s*%\}/g;
  while ((match = capturePattern.exec(text))) {
    if (match[1]) {
      const name = match[1];
      const nameStart = match.index + match[0].indexOf(name);
      const nameEnd = nameStart + name.length;
      declarations.push({
        name,
        range: Range.create(doc.positionAt(nameStart), doc.positionAt(nameEnd)),
      });
    }
  }

  // 3. {% for var in ... %}
  const forPattern = /\{%\s*for\s+([a-zA-Z0-9_-]+)\s+in\s+/g;
  while ((match = forPattern.exec(text))) {
    if (match[1]) {
      const name = match[1];
      const nameStart = match.index + match[0].indexOf(name);
      const nameEnd = nameStart + name.length;
      declarations.push({
        name,
        range: Range.create(doc.positionAt(nameStart), doc.positionAt(nameEnd)),
      });
    }
  }

  // 4. {% parseAssign var = ... %}
  const parseAssignPattern = /\{%\s*parseAssign\s+([a-zA-Z0-9_-]+)\s*=/g;
  while ((match = parseAssignPattern.exec(text))) {
    if (match[1]) {
      const name = match[1];
      const nameStart = match.index + match[0].indexOf(name);
      const nameEnd = nameStart + name.length;
      declarations.push({
        name,
        range: Range.create(doc.positionAt(nameStart), doc.positionAt(nameEnd)),
      });
    }
  }

  return declarations;
}

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
      // Fallback: search first occurrence of the target key
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
    { line, character: character + 1 }, // skip opening quote
    { line, character: character + 1 + lastPart.length }
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

  // Verify coordinate resides inside Liquid tag or output delimiters
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

  // 1. Check if it's a local variable declaration
  const declarations = findVariableDeclarations(doc);
  const matched = declarations.find((d) => d.name === word);
  if (matched) {
    return Location.create(doc.uri, matched.range);
  }

  // 2. Fallback: Check if it's a schema variable and navigate to .liquid-schema.json
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
      } catch (e) {
        // ignore
      }
    }
  }

  return null;
}
