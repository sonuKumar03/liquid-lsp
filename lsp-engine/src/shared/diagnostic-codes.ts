export const DIAGNOSTIC_CODES = {
  UNCLOSED_DELIMITER: 'liquid.syntax.unclosed_delimiter',
  UNKNOWN_FILTER: 'liquid.filter.unknown',
  EXPECTED_FILTER_NAME: 'liquid.syntax.expected_filter_name',
  CONDITIONAL_ASSIGNMENT: 'liquid.syntax.conditional_assignment',
  INLINE_MATH: 'liquid.syntax.inline_math',
  UNKNOWN_TAG: 'liquid.tag.unknown',
  UNKNOWN_KEY_POINTER_TYPE: 'key_pointer.schema.unknown_type',
  INVALID_VARIABLE_DECLARATION: 'key_pointer.schema.invalid_variable',
  DUPLICATE_VARIABLE: 'key_pointer.schema.duplicate_variable',
  SCHEMA_LOAD_ERROR: 'key_pointer.schema.load_error',
} as const;

export type DiagnosticCode =
  (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES];
