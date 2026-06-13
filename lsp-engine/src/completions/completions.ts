import { CompletionItemKind } from 'vscode-languageserver/node';
import type {
  CompletionItem,
  CompletionParams,
} from 'vscode-languageserver/node';
import { TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  LIQUID_TAGS,
  LIQUID_FILTERS,
  getTagDocumentation,
  getFilterDocumentation,
} from '../shared/constants.js';
import { resolveTypeForPath } from '../hovers/hovers.js';
import type { LiquidType } from '../shared/schema.js';

export function extractDeclaredVariables(
  text: string,
  globalSchema?: Map<string, LiquidType>,
): CompletionItem[] {
  const variables = new Set<string>();

  // 1. {% assign var = ... %}
  const assignPattern = /\{%\s*assign\s+([a-zA-Z0-9_-]+)\s*=/g;
  let match: RegExpExecArray | null;
  while ((match = assignPattern.exec(text))) {
    if (match[1]) {
      variables.add(match[1]);
    }
  }

  // 2. {% capture var %}
  const capturePattern = /\{%\s*capture\s+([a-zA-Z0-9_-]+)\s*%\}/g;
  while ((match = capturePattern.exec(text))) {
    if (match[1]) {
      variables.add(match[1]);
    }
  }

  // 3. {% for var in ... %}
  const forPattern = /\{%\s*for\s+([a-zA-Z0-9_-]+)\s+in\s+/g;
  while ((match = forPattern.exec(text))) {
    if (match[1]) {
      variables.add(match[1]);
    }
  }

  const items = Array.from(variables).map((name) => ({
    label: name,
    kind: CompletionItemKind.Variable,
    data: `var-${name}`,
    detail: 'Liquid Variable',
    documentation: `User-defined Liquid variable extracted from the template.`,
  }));

  // Append top-level schema variables
  if (globalSchema) {
    for (const [varName, varType] of globalSchema.entries()) {
      let detail = 'Schema Variable';
      let docText = `Global context variable of type `;
      if (typeof varType === 'string') {
        detail = `${varType} (Schema)`;
        docText += `\`${varType}\`.`;
      } else if (typeof varType === 'object') {
        detail = `${varType.kind} (Schema)`;
        if (varType.kind === 'dropdown') {
          docText += `dropdown options: ${varType.options.map((o) => `"${o}"`).join(', ')}.`;
        } else {
          docText += `composite structure.`;
        }
      }
      items.push({
        label: varName,
        kind: CompletionItemKind.Variable,
        data: `schema-var-${varName}`,
        detail,
        documentation: docText,
      });
    }
  }

  return items;
}

/**
 * Handles completion requests (textDocument/completion) from the editor client.
 */
export function handleCompletion(
  documents: TextDocuments<TextDocument>,
  params: CompletionParams,
  globalSchema?: Map<string, LiquidType>,
): CompletionItem[] {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const position = params.position;
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: position,
  });

  // Check if cursor is after a dot for nested property completion (e.g., "user.")
  const lastDot = lineText.lastIndexOf('.');
  const lastSpace = Math.max(
    lineText.lastIndexOf(' '),
    lineText.lastIndexOf('{'),
    lineText.lastIndexOf('%'),
  );

  if (lastDot !== -1 && lastDot > lastSpace) {
    const pathWithoutDot = lineText.substring(0, lastDot);
    let start = pathWithoutDot.length;
    while (
      start > 0 &&
      /[a-zA-Z0-9_.[\]'"-]/.test(pathWithoutDot[start - 1] || '')
    ) {
      start--;
    }
    const varPath = pathWithoutDot.substring(start).trim();
    if (varPath && globalSchema) {
      const resolvedType = resolveTypeForPath(varPath, globalSchema);
      if (typeof resolvedType === 'object') {
        if (resolvedType.kind === 'composite') {
          const items: CompletionItem[] = [];
          for (const [fieldName, fieldType] of resolvedType.fields.entries()) {
            let detail = 'Field';
            if (typeof fieldType === 'string') {
              detail = `${fieldType} field`;
            } else if (typeof fieldType === 'object') {
              detail = `${fieldType.kind} field`;
            }
            items.push({
              label: fieldName,
              kind: CompletionItemKind.Field,
              detail,
              documentation: `Field of composite variable.`,
              data: `schema-field-${fieldName}`,
            });
          }
          return items;
        }
      } else if (resolvedType === 'currency') {
        return [
          {
            label: 'amount',
            kind: CompletionItemKind.Field,
            detail: 'number field',
            documentation: 'The numeric amount value of the currency.',
            data: 'schema-field-amount',
          },
          {
            label: 'symbol',
            kind: CompletionItemKind.Field,
            detail: 'string field',
            documentation: 'The symbol representation of the currency.',
            data: 'schema-field-symbol',
          },
        ];
      }
    }
  }

  // Check if cursor is after a filter pipe '|' on the current line
  const lastPipe = lineText.lastIndexOf('|');
  const lastTagOpen = lineText.lastIndexOf('{%');
  const lastOutputOpen = lineText.lastIndexOf('{{');

  if (
    lastPipe !== -1 &&
    (lastPipe > lastTagOpen || lastPipe > lastOutputOpen)
  ) {
    return LIQUID_FILTERS;
  }

  // Check if cursor is inside a tag block '{%' (without being closed)
  const lastTagClose = lineText.lastIndexOf('%}');
  if (lastTagOpen !== -1 && lastTagOpen > lastTagClose) {
    const tagContent = lineText.slice(lastTagOpen + 2);
    // Strip leading space
    const cleanContent = tagContent.replace(/^\s+/, '');
    const parts = cleanContent.split(/\s+/);

    // If a tag name has been written followed by arguments/spaces, suggest variables
    if (parts.length > 1 && parts[0] !== '') {
      return extractDeclaredVariables(doc.getText(), globalSchema);
    }
    return LIQUID_TAGS;
  }

  // Check if cursor is inside an output block '{{' (without being closed)
  const lastOutputClose = lineText.lastIndexOf('}}');
  if (lastOutputOpen !== -1 && lastOutputOpen > lastOutputClose) {
    return extractDeclaredVariables(doc.getText(), globalSchema);
  }

  return [];
}

export function handleCompletionResolve(item: CompletionItem): CompletionItem {
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
    item.documentation = {
      kind: 'markdown',
      value: `User-defined variable \`${varName}\` declared in this template.`,
    };
  } else if (data.startsWith('schema-var-')) {
    const varName = data.replace('schema-var-', '');
    item.detail = `Schema Variable: ${varName}`;
  } else if (data.startsWith('schema-field-')) {
    const fieldName = data.replace('schema-field-', '');
    item.detail = `Schema Field: ${fieldName}`;
  }

  return item;
}
