export interface LiquidFilterMeta {
  name: string;
  insertText?: string;
  snippet?: boolean;
  argTypes?: Array<'string' | 'number' | 'boolean' | 'any'>;
}

export const LIQUID_TAG_NAMES = [
  'assign',
  'assignVar',
  'computeColumn',
  'parseAssign',
  'increment',
  'decrement',
  'capture',
  'case',
  'comment',
  'cycle',
  'echo',
  'for',
  'if',
  'unless',
  'include',
  'layout',
  'render',
  'raw',
  'tablerow',
] as const;

export type LiquidTagName = (typeof LIQUID_TAG_NAMES)[number];

export const LIQUID_FILTER_METAS: LiquidFilterMeta[] = [
  { name: 'abs' },
  { name: 'append', insertText: 'append: "${1:value}"', snippet: true, argTypes: ['string'] },
  { name: 'capitalize' },
  { name: 'ceil' },
  { name: 'concat', insertText: 'concat: ${1:array}', snippet: true, argTypes: ['any'] },
  { name: 'date', insertText: 'date: "${1:%Y-%m-%d}"', snippet: true, argTypes: ['string'] },
  { name: 'default', insertText: 'default: ${1:fallback}', snippet: true, argTypes: ['any'] },
  {
    name: 'divided_by',
    insertText: 'divided_by: ${1:divisor}',
    snippet: true,
    argTypes: ['number'],
  },
  { name: 'downcase' },
  { name: 'escape' },
  { name: 'first' },
  { name: 'floor' },
  {
    name: 'join',
    insertText: 'join: "${1:, }"',
    snippet: true,
    argTypes: ['string'],
  },
  { name: 'last' },
  { name: 'minus', insertText: 'minus: ${1:value}', snippet: true, argTypes: ['number'] },
  { name: 'modulo', insertText: 'modulo: ${1:value}', snippet: true, argTypes: ['number'] },
  { name: 'plus', insertText: 'plus: ${1:value}', snippet: true, argTypes: ['number'] },
  { name: 'prepend', insertText: 'prepend: "${1:value}"', snippet: true, argTypes: ['string'] },
  {
    name: 'replace',
    insertText: 'replace: "${1:search}", "${2:replace}"',
    snippet: true,
    argTypes: ['string', 'string'],
  },
  { name: 'reverse' },
  { name: 'round', insertText: 'round: ${1:decimal_places}', snippet: true, argTypes: ['number'] },
  { name: 'size' },
  {
    name: 'slice',
    insertText: 'slice: ${1:start}, ${2:length}',
    snippet: true,
    argTypes: ['number', 'number'],
  },
  { name: 'sort' },
  { name: 'split', insertText: 'split: "${1:,}"', snippet: true, argTypes: ['string'] },
  { name: 'strip' },
  { name: 'times', insertText: 'times: ${1:factor}', snippet: true, argTypes: ['number'] },
  { name: 'truncate', insertText: 'truncate: ${1:100}', snippet: true, argTypes: ['number'] },
  { name: 'uniq' },
  { name: 'upcase' },
  { name: 'sumArray', insertText: 'sumArray: "${1:key}"', snippet: true, argTypes: ['string'] },
  {
    name: 'toCurrency',
    insertText: 'toCurrency: "${1:USD}"',
    snippet: true,
    argTypes: ['string'],
  },
  {
    name: 'toDuration',
    insertText: 'toDuration: "${1:DAYS}"',
    snippet: true,
    argTypes: ['string'],
  },
  {
    name: 'updateAttribute',
    insertText: 'updateAttribute: "${1:attr}", ${2:val}',
    snippet: true,
    argTypes: ['string', 'any'],
  },
  { name: 'updateTypeAttribute' },
];

export const LIQUID_FILTER_NAMES = LIQUID_FILTER_METAS.map((f) => f.name);

const LIQUID_FILTER_NAME_SET = new Set<string>(LIQUID_FILTER_NAMES);

export function isKnownLiquidFilter(name: string): boolean {
  return LIQUID_FILTER_NAME_SET.has(name);
}

export function isKnownLiquidTag(name: string): boolean {
  return (LIQUID_TAG_NAMES as readonly string[]).includes(name);
}

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
      return "Allows you to leave un-rendered comments in your template.\n\n```liquid\n{% comment %}\n  This won't be rendered.\n{% endcomment %}\n```";
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
