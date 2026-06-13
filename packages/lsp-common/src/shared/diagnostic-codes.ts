import { SCHEMA_ERROR_CODES } from 'key-pointer-schema';

export const DIAGNOSTIC_CODES = {
  UNCLOSED_DELIMITER: 'liquid.syntax.unclosed_delimiter',
  UNKNOWN_FILTER: 'liquid.filter.unknown',
  EXPECTED_FILTER_NAME: 'liquid.syntax.expected_filter_name',
  CONDITIONAL_ASSIGNMENT: 'liquid.syntax.conditional_assignment',
  INLINE_MATH: 'liquid.syntax.inline_math',
  UNKNOWN_TAG: 'liquid.tag.unknown',
  USE_BEFORE_ASSIGN: 'liquid.linter.use_before_assign',
  INVALID_PARSE_ASSIGN_JSON: 'liquid.linter.invalid_parse_assign_json',
  INVALID_DYNAMIC_TABLE_COMPUTATION:
    'liquid.linter.invalid_dynamic_table_computation',
  ...SCHEMA_ERROR_CODES,
} as const;

export type DiagnosticCode =
  (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES];
