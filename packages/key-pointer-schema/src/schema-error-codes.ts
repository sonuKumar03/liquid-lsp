export const SCHEMA_ERROR_CODES = {
  UNKNOWN_KEY_POINTER_TYPE: 'key_pointer.schema.unknown_type',
  INVALID_VARIABLE_DECLARATION: 'key_pointer.schema.invalid_variable',
  DUPLICATE_VARIABLE: 'key_pointer.schema.duplicate_variable',
  SCHEMA_LOAD_ERROR: 'key_pointer.schema.load_error',
  COMPUTATION_ASSIGN_NOT_SUPPORTED:
    'key_pointer.computation.assign_not_supported',
} as const;

export type SchemaErrorCode =
  (typeof SCHEMA_ERROR_CODES)[keyof typeof SCHEMA_ERROR_CODES];
