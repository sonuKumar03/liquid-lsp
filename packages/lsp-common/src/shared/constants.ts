import { CompletionItemKind } from 'vscode-languageserver/node';
import type { CompletionItem } from 'vscode-languageserver/node';
import {
  LIQUID_FILTER_METAS,
  LIQUID_TAG_NAMES,
  getFilterDocumentation,
  getTagDocumentation,
  type LiquidFilterMeta,
} from 'liquid-core';

function toFilterCompletionItem(meta: LiquidFilterMeta): CompletionItem {
  const item: CompletionItem = {
    label: meta.name,
    kind: CompletionItemKind.Function,
    data: `filter-${meta.name}`,
  };
  if (meta.insertText) {
    item.insertText = meta.insertText;
    if (meta.snippet) {
      item.insertTextFormat = 2;
    }
  }
  return item;
}

export const LIQUID_TAGS: CompletionItem[] = LIQUID_TAG_NAMES.map((name) => ({
  label: name,
  kind: CompletionItemKind.Keyword,
  data: `tag-${name}`,
}));

export const LIQUID_FILTERS: CompletionItem[] = LIQUID_FILTER_METAS.map(
  toFilterCompletionItem,
);

export { getTagDocumentation, getFilterDocumentation };
