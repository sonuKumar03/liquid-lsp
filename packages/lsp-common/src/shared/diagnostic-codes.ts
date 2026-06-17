import { SCHEMA_ERROR_CODES } from 'key-pointer-schema';

export const DIAGNOSTIC_CODES = {
  UNCLOSED_DELIMITER: 'liquid.syntax.unclosed_delimiter',
  UNCLOSED_QUOTE: 'liquid.syntax.unclosed_quote',
  UNKNOWN_FILTER: 'liquid.filter.unknown',
  EXPECTED_FILTER_NAME: 'liquid.syntax.expected_filter_name',
  CONDITIONAL_ASSIGNMENT: 'liquid.syntax.conditional_assignment',
  INLINE_MATH: 'liquid.syntax.inline_math',
  UNKNOWN_TAG: 'liquid.tag.unknown',
  USE_BEFORE_ASSIGN: 'liquid.linter.use_before_assign',
  INVALID_PARSE_ASSIGN_JSON: 'liquid.linter.invalid_parse_assign_json',
  INVALID_DYNAMIC_TABLE_COMPUTATION:
    'liquid.linter.invalid_dynamic_table_computation',
  COERCION_WARNING: 'liquid.linter.coercion_warning',
  NON_NUMERIC_COERCION: 'liquid.linter.non_numeric_coercion',
  NIL_PROPAGATION: 'liquid.linter.nil_propagation',
  BRANCH_TYPE_MISMATCH: 'liquid.linter.branch_type_mismatch',
  FILTER_ARGUMENT_TYPE_MISMATCH: 'liquid.linter.filter_argument_type_mismatch',
  DIVISION_BY_ZERO: 'liquid.linter.division_by_zero',
  OVERWRITTEN_BEFORE_READ: 'liquid.linter.overwritten_before_read',
  INVALID_FILTER_TYPE: 'liquid.linter.invalid_filter_type',
  INVALID_DROPDOWN_VALUE: 'liquid.linter.invalid_dropdown_value',
  UNUSED_VARIABLE: 'liquid.linter.unused_variable',
  ...SCHEMA_ERROR_CODES,
} as const;

export type DiagnosticCode =
  (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES];
