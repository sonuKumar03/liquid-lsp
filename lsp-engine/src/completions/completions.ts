import { CompletionItemKind } from 'vscode-languageserver/node';
import type { CompletionItem, CompletionParams } from 'vscode-languageserver/node';
import { TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { LIQUID_TAGS, LIQUID_FILTERS, getTagDocumentation, getFilterDocumentation } from '../shared/constants.js';

export function extractDeclaredVariables(text: string): CompletionItem[] {
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

  return Array.from(variables).map(name => ({
    label: name,
    kind: CompletionItemKind.Variable,
    data: `var-${name}`,
    detail: 'Liquid Variable',
    documentation: `User-defined Liquid variable extracted from the template.`
  }));
}

export function handleCompletion(
  documents: TextDocuments<TextDocument>,
  params: CompletionParams
): CompletionItem[] {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const position = params.position;
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: position
  });

  // Check if cursor is after a filter pipe '|' on the current line
  const lastPipe = lineText.lastIndexOf('|');
  const lastTagOpen = lineText.lastIndexOf('{%');
  const lastOutputOpen = lineText.lastIndexOf('{{');

  if (lastPipe !== -1 && (lastPipe > lastTagOpen || lastPipe > lastOutputOpen)) {
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
      return extractDeclaredVariables(doc.getText());
    }
    return LIQUID_TAGS;
  }

  // Check if cursor is inside an output block '{{' (without being closed)
  const lastOutputClose = lineText.lastIndexOf('}}');
  if (lastOutputOpen !== -1 && lastOutputOpen > lastOutputClose) {
    return extractDeclaredVariables(doc.getText());
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
      value: getTagDocumentation(tagName)
    };
  } else if (data.startsWith('filter-')) {
    const filterName = data.replace('filter-', '');
    item.detail = `Liquid Filter: | ${filterName}`;
    item.documentation = {
      kind: 'markdown',
      value: getFilterDocumentation(filterName)
    };
  } else if (data.startsWith('var-')) {
    const varName = data.replace('var-', '');
    item.detail = `Liquid Variable: ${varName}`;
    item.documentation = {
      kind: 'markdown',
      value: `User-defined variable \`${varName}\` declared in this template.`
    };
  }

  return item;
}
