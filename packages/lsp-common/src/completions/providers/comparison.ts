import { CompletionItemKind } from 'vscode-languageserver';
import type { CompletionItem } from 'vscode-languageserver';
import { TagTokenClass } from 'liquid-core';
import type { Token } from 'liquid-core';
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
    const { doc, lineText, localSchema, params, tokens } = context;
    const leftPath = getComparisonLeftHandPath(lineText);
    if (!leftPath) {
      return null;
    }

    const resolvedType = resolveTypeForPath(leftPath, localSchema);
    if (typeof resolvedType === 'object' && resolvedType.kind === 'dropdown') {
      const activeBranchValue = getActiveBranchDropdownValue(
        tokens,
        doc.offsetAt(params.position),
        leftPath,
      );
      const sortedOptions = [...resolvedType.options].sort((a, b) => {
        if (a === activeBranchValue) return -1;
        if (b === activeBranchValue) return 1;
        return a.localeCompare(b);
      });

      return sortedOptions.map<CompletionItem>((option) => ({
        label: `"${option}"`,
        kind: CompletionItemKind.EnumMember,
        detail:
          option === activeBranchValue
            ? 'Dropdown option for current branch'
            : 'Dropdown option',
        documentation: `Allowed option for \`${leftPath}\`.`,
        insertText: `"${option}"`,
        data: `dropdown-option-${option}`,
      }));
    }

    return null;
  },
};

function extractEqualityConstraints(
  conditionText: string,
): Map<string, string> {
  const constraints = new Map<string, string>();
  const regex =
    /([a-zA-Z_][a-zA-Z0-9_.[\]'"-]*)\s*==\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(conditionText)) !== null) {
    const path = match[1]?.trim();
    const rawValue = match[2];
    if (!path || !rawValue) {
      continue;
    }
    constraints.set(path, rawValue.slice(1, -1));
  }

  return constraints;
}

function getActiveBranchDropdownValue(
  tokens: Token[],
  cursorOffset: number,
  path: string,
): string | null {
  const branchStack: Map<string, string>[] = [];

  for (const token of tokens) {
    if (token.begin >= cursorOffset) {
      break;
    }
    if (!(token instanceof TagTokenClass)) {
      continue;
    }

    if (token.name === 'if' || token.name === 'unless') {
      branchStack.push(
        token.name === 'if'
          ? extractEqualityConstraints(token.args)
          : new Map(),
      );
      continue;
    }

    if (token.name === 'elsif') {
      if (branchStack.length > 0) {
        branchStack[branchStack.length - 1] = extractEqualityConstraints(
          token.args,
        );
      }
      continue;
    }

    if (token.name === 'else') {
      if (branchStack.length > 0) {
        branchStack[branchStack.length - 1] = new Map();
      }
      continue;
    }

    if (token.name === 'endif' || token.name === 'endunless') {
      branchStack.pop();
    }
  }

  for (let i = branchStack.length - 1; i >= 0; i--) {
    const value = branchStack[i]?.get(path);
    if (value) {
      return value;
    }
  }

  return null;
}
