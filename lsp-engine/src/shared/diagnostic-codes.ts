export const DIAGNOSTIC_CODES = {
  UNCLOSED_DELIMITER: 'liquid.syntax.unclosed_delimiter',
  UNKNOWN_FILTER: 'liquid.filter.unknown',
  EXPECTED_FILTER_NAME: 'liquid.syntax.expected_filter_name',
  CONDITIONAL_ASSIGNMENT: 'liquid.syntax.conditional_assignment',
  INLINE_MATH: 'liquid.syntax.inline_math',
  UNKNOWN_TAG: 'liquid.tag.unknown',
} as const;

export type DiagnosticCode =
  (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES];
