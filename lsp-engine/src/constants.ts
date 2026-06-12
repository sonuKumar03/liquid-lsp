import { CompletionItemKind } from 'vscode-languageserver/node';
import type { CompletionItem } from 'vscode-languageserver/node';

export const LIQUID_TAGS: CompletionItem[] = [
  { label: 'assign', kind: CompletionItemKind.Keyword, data: 'tag-assign' },
  { label: 'increment', kind: CompletionItemKind.Keyword, data: 'tag-increment' },
  { label: 'decrement', kind: CompletionItemKind.Keyword, data: 'tag-decrement' },
  { label: 'capture', kind: CompletionItemKind.Keyword, data: 'tag-capture' },
  { label: 'case', kind: CompletionItemKind.Keyword, data: 'tag-case' },
  { label: 'comment', kind: CompletionItemKind.Keyword, data: 'tag-comment' },
  { label: 'cycle', kind: CompletionItemKind.Keyword, data: 'tag-cycle' },
  { label: 'echo', kind: CompletionItemKind.Keyword, data: 'tag-echo' },
  { label: 'for', kind: CompletionItemKind.Keyword, data: 'tag-for' },
  { label: 'if', kind: CompletionItemKind.Keyword, data: 'tag-if' },
  { label: 'unless', kind: CompletionItemKind.Keyword, data: 'tag-unless' },
  { label: 'include', kind: CompletionItemKind.Keyword, data: 'tag-include' },
  { label: 'layout', kind: CompletionItemKind.Keyword, data: 'tag-layout' },
  { label: 'render', kind: CompletionItemKind.Keyword, data: 'tag-render' },
  { label: 'raw', kind: CompletionItemKind.Keyword, data: 'tag-raw' },
  { label: 'tablerow', kind: CompletionItemKind.Keyword, data: 'tag-tablerow' }
];

export const LIQUID_FILTERS: CompletionItem[] = [
  { label: 'abs', kind: CompletionItemKind.Function, data: 'filter-abs' },
  { label: 'append', kind: CompletionItemKind.Function, data: 'filter-append', insertText: 'append: "${1:value}"', insertTextFormat: 2 },
  { label: 'capitalize', kind: CompletionItemKind.Function, data: 'filter-capitalize' },
  { label: 'ceil', kind: CompletionItemKind.Function, data: 'filter-ceil' },
  { label: 'concat', kind: CompletionItemKind.Function, data: 'filter-concat', insertText: 'concat: ${1:array}', insertTextFormat: 2 },
  { label: 'date', kind: CompletionItemKind.Function, data: 'filter-date', insertText: 'date: "${1:%Y-%m-%d}"', insertTextFormat: 2 },
  { label: 'default', kind: CompletionItemKind.Function, data: 'filter-default', insertText: 'default: ${1:fallback}', insertTextFormat: 2 },
  { label: 'divided_by', kind: CompletionItemKind.Function, data: 'filter-divided_by', insertText: 'divided_by: ${1:divisor}', insertTextFormat: 2 },
  { label: 'downcase', kind: CompletionItemKind.Function, data: 'filter-downcase' },
  { label: 'escape', kind: CompletionItemKind.Function, data: 'filter-escape' },
  { label: 'first', kind: CompletionItemKind.Function, data: 'filter-first' },
  { label: 'floor', kind: CompletionItemKind.Function, data: 'filter-floor' },
  { label: 'join', kind: CompletionItemKind.Function, data: 'filter-join', insertText: 'join: "${1:, }"', insertTextFormat: 2 },
  { label: 'last', kind: CompletionItemKind.Function, data: 'filter-last' },
  { label: 'minus', kind: CompletionItemKind.Function, data: 'filter-minus', insertText: 'minus: ${1:value}', insertTextFormat: 2 },
  { label: 'modulo', kind: CompletionItemKind.Function, data: 'filter-modulo', insertText: 'modulo: ${1:value}', insertTextFormat: 2 },
  { label: 'plus', kind: CompletionItemKind.Function, data: 'filter-plus', insertText: 'plus: ${1:value}', insertTextFormat: 2 },
  { label: 'prepend', kind: CompletionItemKind.Function, data: 'filter-prepend', insertText: 'prepend: "${1:value}"', insertTextFormat: 2 },
  { label: 'replace', kind: CompletionItemKind.Function, data: 'filter-replace', insertText: 'replace: "${1:search}", "${2:replace}"', insertTextFormat: 2 },
  { label: 'reverse', kind: CompletionItemKind.Function, data: 'filter-reverse' },
  { label: 'round', kind: CompletionItemKind.Function, data: 'filter-round', insertText: 'round: ${1:decimal_places}', insertTextFormat: 2 },
  { label: 'size', kind: CompletionItemKind.Function, data: 'filter-size' },
  { label: 'slice', kind: CompletionItemKind.Function, data: 'filter-slice', insertText: 'slice: ${1:start}, ${2:length}', insertTextFormat: 2 },
  { label: 'sort', kind: CompletionItemKind.Function, data: 'filter-sort' },
  { label: 'split', kind: CompletionItemKind.Function, data: 'filter-split', insertText: 'split: "${1:,}"', insertTextFormat: 2 },
  { label: 'strip', kind: CompletionItemKind.Function, data: 'filter-strip' },
  { label: 'times', kind: CompletionItemKind.Function, data: 'filter-times', insertText: 'times: ${1:factor}', insertTextFormat: 2 },
  { label: 'truncate', kind: CompletionItemKind.Function, data: 'filter-truncate', insertText: 'truncate: ${1:100}', insertTextFormat: 2 },
  { label: 'uniq', kind: CompletionItemKind.Function, data: 'filter-uniq' },
  { label: 'upcase', kind: CompletionItemKind.Function, data: 'filter-upcase' }
];

export function getTagDocumentation(tag: string): string {
  switch (tag) {
    case 'assign':
      return 'Creates a new variable.\n\n```liquid\n{% assign my_var = false %}\n```';
    case 'if':
      return 'Conditional execution of code.\n\n```liquid\n{% if condition %}\n  ...\n{% endif %}\n```';
    case 'for':
      return 'Loops through a collection.\n\n```liquid\n{% for item in collection %}\n  {{ item }}\n{% endfor %}\n```';
    case 'capture':
      return 'Captures the string output inside the block into a variable.\n\n```liquid\n{% capture my_variable %}\n  Hello {{ name }}\n{% endcapture %}\n```';
    case 'comment':
      return 'Allows you to leave un-rendered comments in your template.\n\n```liquid\n{% comment %}\n  This won\'t be rendered.\n{% endcomment %}\n```';
    case 'render':
      return 'Renders a partial template file.\n\n```liquid\n{% render "snippet-name" %}\n```';
    default:
      return `Liquid core tag: \`{% ${tag} %}\`.`;
  }
}

export function getFilterDocumentation(filter: string): string {
  switch (filter) {
    case 'upcase':
      return 'Converts a string to uppercase.\n\n```liquid\n{{ "hello" | upcase }} => "HELLO"\n```';
    case 'downcase':
      return 'Converts a string to lowercase.\n\n```liquid\n{{ "HELLO" | downcase }} => "hello"\n```';
    case 'default':
      return 'Returns a fallback value if the input is nil, false, or empty.\n\n```liquid\n{{ undefined_variable | default: "fallback" }} => "fallback"\n```';
    case 'split':
      return 'Splits a string on a delimiter into an array.\n\n```liquid\n{{ "a,b,c" | split: "," }} => ["a", "b", "c"]\n```';
    case 'join':
      return 'Joins an array of strings using a connector.\n\n```liquid\n{{ my_array | join: ", " }}\n```';
    default:
      return `Liquid core filter: \`| ${filter}\`.`;
  }
}
