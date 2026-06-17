import { CompletionItemKind } from 'vscode-languageserver';
import type { CompletionItem } from 'vscode-languageserver';
import {
  LIQUID_FILTER_METAS,
  LIQUID_TAG_NAMES,
  getFilterDocumentation,
  getTagDocumentation,
  type LiquidFilterMeta,
} from 'liquid-core';

const FILTER_PREVIEWS: Record<string, string> = {
  upcase: '"hello" | upcase  →  "HELLO"',
  downcase: '"HELLO" | downcase  →  "hello"',
  times: '50 | times: 1.5  →  75.0',
  divided_by: '10 | divided_by: 2  →  5',
  plus: '10 | plus: 5  →  15',
  minus: '10 | minus: 5  →  5',
  round: '5.556 | round: 2  →  5.56',
  date: 'today | date: "%Y-%m-%d"  →  "2026-06-15"',
  default: 'nil | default: 0  →  0',
  split: '"a,b" | split: ","  →  ["a", "b"]',
  join: '["a", "b"] | join: "-"  →  "a-b"',
  abs: '-5 | abs  →  5',
  ceil: '4.2 | ceil  →  5',
  floor: '4.8 | floor  →  4',
  size: '"abc" | size  →  3',
  toCurrency: '1000 | toCurrency: "USD"  →  "$1,000.00"',
};

function toFilterCompletionItem(meta: LiquidFilterMeta): CompletionItem {
  const item: CompletionItem = {
    label: meta.name,
    kind: CompletionItemKind.Function,
    data: `filter-${meta.name}`,
  };
  const preview = FILTER_PREVIEWS[meta.name];
  if (preview) {
    item.detail = preview;
  }
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

export const ASSIGN_TAG_NAMES = new Set(['assign', 'assignVar', 'parseAssign']);

