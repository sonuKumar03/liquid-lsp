import type {
  Hover,
  TextDocumentPositionParams,
} from 'vscode-languageserver/node';
import { TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  LIQUID_TAGS,
  LIQUID_FILTERS,
  getTagDocumentation,
  getFilterDocumentation,
} from '../shared/constants.js';
import { getWordAtPosition } from '../shared/utils.js';
import type { LiquidType } from '../shared/schema.js';

export function getVariablePathAtPosition(
  text: string,
  character: number,
): string {
  if (character < 0 || character >= text.length) return '';

  let start = character;
  while (start > 0 && /[a-zA-Z0-9_.[\]'"-]/.test(text[start - 1] || '')) {
    start--;
  }

  let end = character;
  while (end < text.length && /[a-zA-Z0-9_.[\]'"-]/.test(text[end] || '')) {
    end++;
  }

  return text.slice(start, end).trim();
}

export function resolveTypeForPath(
  path: string,
  schema: Map<string, LiquidType>,
): LiquidType {
  const parts = path.split('.');
  if (parts.length === 0) return 'unknown';

  const baseVarRaw = (parts[0] ?? '').trim();
  const baseVar = baseVarRaw.replace(/\[\s*[a-zA-Z0-9_-]+\s*\]/g, '');

  let currentType = schema.get(baseVar);
  if (!currentType) return 'unknown';

  for (let i = 1; i < parts.length; i++) {
    const fieldNameRaw = (parts[i] ?? '').trim();
    if (!fieldNameRaw) continue;
    const fieldName = fieldNameRaw.replace(/\[\s*[a-zA-Z0-9_-]+\s*\]/g, '');

    if (typeof currentType === 'object') {
      if (currentType.kind === 'composite') {
        const nextType = currentType.fields.get(fieldName);
        if (nextType) {
          currentType = nextType;
        } else {
          return 'unknown';
        }
      } else {
        return 'unknown';
      }
    } else {
      if (currentType === 'currency') {
        if (fieldName === 'amount') {
          currentType = 'number';
        } else if (fieldName === 'symbol') {
          currentType = 'string';
        } else {
          return 'unknown';
        }
      } else {
        return 'unknown';
      }
    }
  }

  return currentType;
}

export function formatLiquidType(type: LiquidType): string {
  if (typeof type === 'string') {
    return `\`${type}\``;
  }
  if (type.kind === 'dropdown') {
    return `\`dropdown\` (Options: ${type.options.map((o) => `"${o}"`).join(', ')})`;
  }
  if (type.kind === 'composite') {
    const fieldsStr = Array.from(type.fields.keys())
      .map((k) => `"${k}"`)
      .join(', ');
    return `\`object\` (Fields: ${fieldsStr})`;
  }
  return '`unknown`';
}

export function handleHover(
  documents: TextDocuments<TextDocument>,
  params: TextDocumentPositionParams,
  schema?: Map<string, LiquidType>,
): Hover | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const position = params.position;
  // Get the entire line text containing the cursor
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 },
  });

  const word = getWordAtPosition(lineText, position.character);
  if (!word) return null;

  // Determine if the hover coordinate resides inside Liquid tag or output delimiters
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

  // 1. Check if the hovered word is a recognized tag
  const tagDoc = getTagDocumentation(word);
  const isKnownTag = LIQUID_TAGS.some((t) => t.label === word);
  if (isInsideTag && isKnownTag) {
    return {
      contents: {
        kind: 'markdown',
        value: `**Liquid Tag: \`{% ${word} %}\`**\n\n${tagDoc}`,
      },
    };
  }

  // 2. Check if the hovered word is a recognized filter
  const filterDoc = getFilterDocumentation(word);
  const isKnownFilter = LIQUID_FILTERS.some((f) => f.label === word);
  if (isKnownFilter) {
    return {
      contents: {
        kind: 'markdown',
        value: `**Liquid Filter: \`| ${word}\`**\n\n${filterDoc}`,
      },
    };
  }

  // 3. Check if we can resolve variable type from the schema
  const path = getVariablePathAtPosition(lineText, position.character);
  if (path && schema) {
    const resolvedType = resolveTypeForPath(path, schema);
    if (resolvedType !== 'unknown') {
      return {
        contents: {
          kind: 'markdown',
          value: `**Variable:** \`${path}\`\n\n**Type:** ${formatLiquidType(resolvedType)}`,
        },
      };
    }
  }

  return null;
}
