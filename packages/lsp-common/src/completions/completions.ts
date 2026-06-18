import type { CompletionItem, CompletionParams } from 'vscode-languageserver';
import {
  getTagDocumentation,
  getFilterDocumentation,
} from '../shared/constants.js';
import type { LiquidType } from '../shared/schema.js';
import { extractLocalVariableTypes } from '../shared/local-variable-types.js';
import type { DocumentManager } from '../server/document-manager.js';
import type { Liquid } from 'liquid-core';

import type { CompletionContext } from './providers/provider.js';
import { extractDeclaredVariables } from './providers/provider.js';
import { PropertyCompletionProvider } from './providers/property.js';
import { FilterCompletionProvider } from './providers/filter.js';
import { TagCompletionProvider } from './providers/tag.js';
import { OutputCompletionProvider } from './providers/output.js';

// Forward export for compatibility
export { extractDeclaredVariables };

const providers = [
  PropertyCompletionProvider,
  FilterCompletionProvider,
  TagCompletionProvider,
  OutputCompletionProvider,
];

/**
 * Handles completion requests (textDocument/completion) from the editor client.
 */
export function handleCompletion(
  documentManager: DocumentManager,
  liquidEngine: Liquid,
  params: CompletionParams,
  globalSchema?: Map<string, LiquidType>,
): CompletionItem[] {
  const doc = documentManager.documents.get(params.textDocument.uri);
  if (!doc) return [];

  const tokens = documentManager.getTokens(
    params.textDocument.uri,
    liquidEngine,
  );

  const position = params.position;
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: position,
  });

  const localSchema = extractLocalVariableTypes(
    globalSchema,
    tokens,
    liquidEngine,
  );

  const context: CompletionContext = {
    doc,
    lineText,
    tokens,
    params,
    localSchema,
    globalSchema,
  };

  for (const provider of providers) {
    if (provider.matches(lineText)) {
      const items = provider.getCompletionItems(context);
      if (items !== null) {
        return items;
      }
    }
  }

  return [];
}

export function handleCompletionResolve(item: CompletionItem): CompletionItem {
  if (item.detail && item.documentation) {
    return item;
  }

  const data = item.data as string;

  if (data.startsWith('tag-')) {
    const tagName = data.replace('tag-', '');
    item.detail = `Liquid Tag: {% ${tagName} %}`;
    item.documentation = {
      kind: 'markdown',
      value: getTagDocumentation(tagName),
    };
  } else if (data.startsWith('filter-')) {
    const filterName = data.replace('filter-', '');
    item.detail = `Liquid Filter: | ${filterName}`;
    item.documentation = {
      kind: 'markdown',
      value: getFilterDocumentation(filterName),
    };
  } else if (data.startsWith('var-')) {
    const varName = data.replace('var-', '');
    item.detail = `Liquid Variable: ${varName}`;
    item.documentation = `User-defined variable declared in the template.`;
  } else if (data.startsWith('schema-var-')) {
    const varName = data.replace('schema-var-', '');
    item.detail = `Schema Variable: ${varName}`;
    item.documentation = `Global context variable from the variable schema.`;
  } else if (data.startsWith('schema-field-')) {
    const fieldName = data.replace('schema-field-', '');
    item.detail = `Schema Field: ${fieldName}`;
    item.documentation = `Field of a composite schema variable.`;
  }

  return item;
}

