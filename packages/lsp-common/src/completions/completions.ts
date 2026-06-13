import { CompletionItemKind } from 'vscode-languageserver';
import type {
  CompletionItem,
  CompletionParams,
} from 'vscode-languageserver';
import {
  LIQUID_TAGS,
  LIQUID_FILTERS,
  getTagDocumentation,
  getFilterDocumentation,
} from '../shared/constants.js';
import { resolveTypeForPath } from '../hovers/hovers.js';
import type { LiquidType } from '../shared/schema.js';
import { collectVariableNamesFromTokens } from '../shared/token-variables.js';
import { extractLocalVariableTypes } from '../shared/local-variable-types.js';
import type { DocumentManager } from '../server/document-manager.js';
import type { Liquid, Token } from 'liquid-core';

export function extractDeclaredVariables(
  globalSchema?: Map<string, LiquidType>,
  tokens?: Token[],
): CompletionItem[] {
  const variables = new Set<string>();

  if (tokens) {
    for (const name of collectVariableNamesFromTokens(tokens)) {
      variables.add(name);
    }
  }

  const items = Array.from(variables).map((name) => ({
    label: name,
    kind: CompletionItemKind.Variable,
    data: `var-${name}`,
    detail: 'Liquid Variable',
    documentation: `User-defined Liquid variable extracted from the template.`,
  }));

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
    if (varPath) {
      const resolvedType = resolveTypeForPath(varPath, localSchema);
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
    const exprBeforePipe = lineText.substring(0, lastPipe);
    const openBound = Math.max(
      exprBeforePipe.lastIndexOf('{%'),
      exprBeforePipe.lastIndexOf('{{'),
    );
    let rawExpr = exprBeforePipe;
    if (openBound !== -1) {
      rawExpr = exprBeforePipe.substring(openBound + 2);
    }
    const cleanExpr = rawExpr.trim();
    const parts = cleanExpr.split('|');
    const baseVarExpr = parts[0] ? parts[0].trim() : '';

    let start = baseVarExpr.length;
    while (
      start > 0 &&
      /[a-zA-Z0-9_.[\]'"-]/.test(baseVarExpr[start - 1] || '')
    ) {
      start--;
    }
    const varPath = baseVarExpr.substring(start).trim();

    let resolvedType: LiquidType = 'unknown';
    if (varPath) {
      resolvedType = resolveTypeForPath(varPath, localSchema);
      if (resolvedType === 'unknown') {
        if (/^["'].*["']$/.test(varPath)) {
          resolvedType = 'string';
        } else if (/^\d+(\.\d+)?$/.test(varPath)) {
          resolvedType = 'number';
        }
      }
    }

    const stringFilters = [
      'append',
      'capitalize',
      'downcase',
      'escape',
      'prepend',
      'replace',
      'slice',
      'split',
      'strip',
      'truncate',
      'upcase',
      'default',
    ];
    const numberFilters = [
      'abs',
      'ceil',
      'divided_by',
      'floor',
      'minus',
      'modulo',
      'plus',
      'round',
      'times',
      'toDuration',
      'toCurrency',
      'default',
    ];
    const dateFilters = ['date', 'default'];
    const currencyFilters = ['toCurrency', 'default'];

    let filterNames: string[] | null = null;

    if (resolvedType === 'date') {
      filterNames = dateFilters;
    } else if (
      resolvedType === 'string' ||
      (typeof resolvedType === 'object' && resolvedType.kind === 'dropdown')
    ) {
      filterNames = stringFilters;
    } else if (resolvedType === 'number') {
      filterNames = numberFilters;
    } else if (resolvedType === 'currency') {
      filterNames = currencyFilters;
    }

    if (filterNames !== null) {
      return LIQUID_FILTERS.filter((item) => filterNames!.includes(item.label));
    }
    return LIQUID_FILTERS;
  }

  const lastTagClose = lineText.lastIndexOf('%}');
  if (lastTagOpen !== -1 && lastTagOpen > lastTagClose) {
    const tagContent = lineText.slice(lastTagOpen + 2);
    const cleanContent = tagContent.replace(/^\s+/, '');
    const parts = cleanContent.split(/\s+/);

    if (parts.length > 1 && parts[0] !== '') {
      return extractDeclaredVariables(globalSchema, tokens);
    }
    return LIQUID_TAGS;
  }

  const lastOutputClose = lineText.lastIndexOf('}}');
  if (lastOutputOpen !== -1 && lastOutputOpen > lastOutputClose) {
    return extractDeclaredVariables(globalSchema, tokens);
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
