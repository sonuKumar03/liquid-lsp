export const CONDITIONAL_TAG_NAMES = ['if', 'unless', 'elsif', 'when'] as const;
export const INLINE_MATH_OPERATOR_REGEX = /\+|(?<=\s)-(?=\s)|(?<=\d)-(?=\d)|\*|\//;
export const SINGLE_EQUALS_ASSIGNMENT_REGEX = /(?<![=!<>])=(?![=<>])/;

export const AUTO_CLOSE_BLOCK_TAG_NAMES = ['if', 'for', 'unless', 'capture', 'tablerow', 'case', 'comment'] as const;
export const BLOCK_OPEN_TAG_NAMES = new Set([
  ...AUTO_CLOSE_BLOCK_TAG_NAMES,
  'computeColumn'
]);
export const BLOCK_CLOSE_TAG_NAMES = new Set([
  'endif',
  'endunless',
  'endfor',
  'endtablerow',
  'endcase',
  'endcomment',
  'endcapture',
  'endcomputeColumn'
]);
export const BLOCK_MIDDLE_TAG_NAMES = new Set(['else', 'elsif', 'when']);

export const EXPECTED_FILTER_NAME_MESSAGE = 'expected "|" before filter';
export const CONDITIONAL_ASSIGNMENT_MESSAGE =
  'Assignments are not allowed inside conditional statements. Did you mean "=="?';
export const INLINE_MATH_OPERATOR_MESSAGE =
  'Liquid does not support inline mathematical operators. Use filters instead, e.g. "| plus: 2".';

export function hasSingleEqualsAssignment(text: string): boolean {
  return SINGLE_EQUALS_ASSIGNMENT_REGEX.test(text);
}

export function hasInlineMathOperators(text: string): boolean {
  return INLINE_MATH_OPERATOR_REGEX.test(text);
}

export function isConditionalTagLine(text: string): boolean {
  return CONDITIONAL_TAG_NAMES.some(tag => new RegExp(`\\b${tag}\\b`).test(text));
}
