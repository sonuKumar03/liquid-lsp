import type { Hover, TextDocumentPositionParams } from 'vscode-languageserver';
import { TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  LIQUID_TAGS,
  getTagDocumentation,
} from '../shared/constants.js';
import {
  getWordAtPosition,
  isKnownLiquidFilter,
  createLiquidEngine,
  tokenizeTopLevelSafe,
} from 'liquid-core';
import type { LiquidType } from '../shared/schema.js';
import { extractLocalVariableTypes } from '../shared/local-variable-types.js';

import {
  getVariablePathAtPosition,
  resolveTypeForPath,
  formatLiquidType,
  resolveValueForPath,
} from './resolver.js';
import { resolveSchemaAwareDoc } from './filter-documentation.js';

// Re-export for compatibility
export {
  getVariablePathAtPosition,
  resolveTypeForPath,
  formatLiquidType,
  resolveValueForPath,
};

export function handleHover(
  documents: TextDocuments<TextDocument>,
  params: TextDocumentPositionParams,
  schema?: Map<string, LiquidType>,
  contextData?: unknown,
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
  const isKnownFilter = isKnownLiquidFilter(word);
  if (isKnownFilter) {
    const engine = createLiquidEngine();
    const tokens = tokenizeTopLevelSafe(doc.getText(), engine);
    const mergedSchema = schema ? extractLocalVariableTypes(schema, tokens, engine) : undefined;
    const filterDoc = resolveSchemaAwareDoc(word, mergedSchema);
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
    const engine = createLiquidEngine();
    const tokens = tokenizeTopLevelSafe(doc.getText(), engine);
    const mergedSchema = extractLocalVariableTypes(schema, tokens, engine);
    const resolvedType = resolveTypeForPath(path, mergedSchema);
    if (resolvedType !== 'unknown') {
      const val = resolveValueForPath(path, contextData);
      const valStr =
        val !== undefined
          ? `\n\n**Value:** \`${typeof val === 'object' ? JSON.stringify(val) : val}\``
          : '';
      return {
        contents: {
          kind: 'markdown',
          value: `**Variable:** \`${path}\`\n\n**Type:** ${formatLiquidType(resolvedType)}${valStr}`,
        },
      };
    }
  }

  return null;
}
