import { CompletionItemKind } from 'vscode-languageserver';
import type { CompletionItem } from 'vscode-languageserver';
import { resolveTypeForPath } from '../../hovers/hovers.js';
import type { CompletionProvider } from './provider.js';

function getComparisonLeftHandPath(lineText: string): string | null {
  const lastTagOpen = lineText.lastIndexOf('{%');
  const lastTagClose = lineText.lastIndexOf('%}');
  if (lastTagOpen === -1 || lastTagOpen <= lastTagClose) {
    return null;
  }

  const tagContent = lineText.slice(lastTagOpen + 2);
  const comparisonMatch = tagContent.match(
    /([a-zA-Z0-9_.[\]'"-]+)\s*(==|!=)\s*["']?[^"']*$/,
  );
  return comparisonMatch?.[1]?.trim() ?? null;
}

export const ComparisonCompletionProvider: CompletionProvider = {
  matches(lineText) {
    return getComparisonLeftHandPath(lineText) !== null;
  },

  getCompletionItems(context) {
    const { lineText, localSchema } = context;
    const leftPath = getComparisonLeftHandPath(lineText);
    if (!leftPath) {
      return null;
    }

    const resolvedType = resolveTypeForPath(leftPath, localSchema);
    if (typeof resolvedType === 'object' && resolvedType.kind === 'dropdown') {
      return resolvedType.options.map<CompletionItem>((option) => ({
        label: `"${option}"`,
        kind: CompletionItemKind.EnumMember,
        detail: 'Dropdown option',
        documentation: `Allowed option for \`${leftPath}\`.`,
        insertText: `"${option}"`,
        data: `dropdown-option-${option}`,
      }));
    }

    return null;
  },
};
