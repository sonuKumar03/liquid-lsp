import { CompletionItemKind } from 'vscode-languageserver';
import type { CompletionItem } from 'vscode-languageserver';
import { resolveTypeForPath } from '../../hovers/hovers.js';
import type { CompletionProvider, CompletionContext } from './provider.js';

export const PropertyCompletionProvider: CompletionProvider = {
  matches(lineText) {
    const lastDot = lineText.lastIndexOf('.');
    const lastSpace = Math.max(
      lineText.lastIndexOf(' '),
      lineText.lastIndexOf('{'),
      lineText.lastIndexOf('%'),
    );
    return lastDot !== -1 && lastDot > lastSpace;
  },
  getCompletionItems(context) {
    const { lineText, localSchema } = context;
    const lastDot = lineText.lastIndexOf('.');
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
    return null;
  },
};
