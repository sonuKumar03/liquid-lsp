import { parseSchema } from './liquid-types.js';
import { SCHEMA_ERROR_CODES } from './schema-error-codes.js';
import {
  formatKnownKeyPointerDataTypes,
  isKnownKeyPointerDataType,
  type KeyPointerSelectOption,
} from './key-pointer-types.js';
import { keyPointerTypeToLiquid } from './key-pointer-to-liquid.js';
import type {
  ParseVariableSchemaResult,
  SchemaLoadError,
  VariableDeclaration,
} from './key-pointer-schema.types.js';

export type {
  ParseVariableSchemaResult,
  SchemaLoadError,
  SchemaLoadSeverity,
  VariableDeclaration,
} from './key-pointer-schema.types.js';

const FIELD_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

interface RawVariableDeclaration {
  field_name?: unknown;
  data_type?: unknown;
  options?: unknown;
}

function emptyResult(): ParseVariableSchemaResult {
  return {
    variables: new Map(),
    liquidSchema: new Map(),
    errors: [],
    usedLegacyLiquidSchema: false,
  };
}

function parseOptions(raw: unknown): KeyPointerSelectOption[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const options: KeyPointerSelectOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const label = (item as { label?: unknown }).label;
    const value = (item as { value?: unknown }).value;
    if (typeof label === 'string' && typeof value === 'string') {
      options.push({ label, value });
    }
  }

  return options.length > 0 ? options : undefined;
}

function isKeyPointerFlatMap(raw: Record<string, unknown>): boolean {
  const entries = Object.entries(raw);
  if (entries.length === 0) {
    return false;
  }

  return entries.every(([, value]) => typeof value === 'string');
}

function isLegacyLiquidSchema(raw: Record<string, unknown>): boolean {
  return Object.values(raw).some(
    (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
  );
}

function parseVariableEntry(
  raw: RawVariableDeclaration,
  index: number,
): { declaration?: VariableDeclaration; errors: SchemaLoadError[] } {
  const errors: SchemaLoadError[] = [];
  const fieldName = raw.field_name;
  const dataType = raw.data_type;

  if (typeof fieldName !== 'string' || fieldName.trim() === '') {
    errors.push({
      severity: 'error',
      code: SCHEMA_ERROR_CODES.INVALID_VARIABLE_DECLARATION,
      message: `Variable at index ${index} is missing a valid field_name.`,
    });
    return { errors };
  }

  if (typeof dataType !== 'string') {
    errors.push({
      severity: 'error',
      code: SCHEMA_ERROR_CODES.INVALID_VARIABLE_DECLARATION,
      message: `Variable "${fieldName}" is missing data_type.`,
      field_name: fieldName,
    });
    return { errors };
  }

  if (!isKnownKeyPointerDataType(dataType)) {
    errors.push({
      severity: 'error',
      code: SCHEMA_ERROR_CODES.UNKNOWN_KEY_POINTER_TYPE,
      message: `Variable "${fieldName}" uses unknown key pointer type "${dataType}". Supported types: ${formatKnownKeyPointerDataTypes()}.`,
      field_name: fieldName,
    });
    return { errors };
  }

  if (!FIELD_NAME_PATTERN.test(fieldName)) {
    errors.push({
      severity: 'error',
      code: SCHEMA_ERROR_CODES.INVALID_VARIABLE_DECLARATION,
      message: `Variable "${fieldName}" has an invalid field_name.`,
      field_name: fieldName,
    });
    return { errors };
  }

  const options = parseOptions(raw.options);
  if (
    (dataType === 'dropdown' || dataType === 'multi-dropdown') &&
    !options
  ) {
    errors.push({
      severity: 'warning',
      code: SCHEMA_ERROR_CODES.SCHEMA_LOAD_ERROR,
      message: `Variable "${fieldName}" (${dataType}) has no options defined.`,
      field_name: fieldName,
    });
  }

  const declaration: VariableDeclaration = {
    field_name: fieldName,
    data_type: dataType,
  };
  if (options) {
    declaration.options = options;
  }

  return { declaration, errors };
}

function parseVariablesArray(rawVariables: unknown[]): ParseVariableSchemaResult {
  const result = emptyResult();

  for (let index = 0; index < rawVariables.length; index++) {
    const raw = rawVariables[index];
    if (!raw || typeof raw !== 'object') {
      result.errors.push({
        severity: 'error',
        code: SCHEMA_ERROR_CODES.INVALID_VARIABLE_DECLARATION,
        message: `Variable at index ${index} must be an object.`,
      });
      continue;
    }

    const { declaration, errors } = parseVariableEntry(
      raw as RawVariableDeclaration,
      index,
    );
    result.errors.push(...errors);

    if (!declaration) {
      continue;
    }

    if (result.variables.has(declaration.field_name)) {
      result.errors.push({
        severity: 'error',
        code: SCHEMA_ERROR_CODES.DUPLICATE_VARIABLE,
        message: `Duplicate variable "${declaration.field_name}".`,
        field_name: declaration.field_name,
      });
      continue;
    }

    result.variables.set(declaration.field_name, declaration);
    result.liquidSchema.set(
      declaration.field_name,
      keyPointerTypeToLiquid(declaration.data_type, declaration.options),
    );
  }

  return result;
}

function parseKeyPointerFlatMap(
  raw: Record<string, unknown>,
): ParseVariableSchemaResult {
  const variables = Object.entries(raw).map(([field_name, data_type]) => ({
    field_name,
    data_type,
  }));
  return parseVariablesArray(variables);
}

export function parseVariableSchema(raw: unknown): ParseVariableSchemaResult {
  if (!raw || typeof raw !== 'object') {
    return {
      ...emptyResult(),
      errors: [
        {
          severity: 'error',
          code: SCHEMA_ERROR_CODES.SCHEMA_LOAD_ERROR,
          message: 'Variable schema must be an object.',
        },
      ],
    };
  }

  const record = raw as Record<string, unknown>;

  if (Array.isArray(record.variables)) {
    return parseVariablesArray(record.variables);
  }

  if (isLegacyLiquidSchema(record)) {
    return {
      variables: new Map(),
      liquidSchema: parseSchema(record),
      errors: [],
      usedLegacyLiquidSchema: true,
    };
  }

  if (isKeyPointerFlatMap(record)) {
    return parseKeyPointerFlatMap(record);
  }

  return {
    ...emptyResult(),
    errors: [
      {
        severity: 'error',
        code: SCHEMA_ERROR_CODES.SCHEMA_LOAD_ERROR,
        message:
          'Unrecognized variable schema format. Use { variables: [...] } or a flat map of field_name to data_type.',
      },
    ],
  };
}

export function mergeVariableSchemas(
  base: ParseVariableSchemaResult,
  overlay: ParseVariableSchemaResult,
): ParseVariableSchemaResult {
  const merged: ParseVariableSchemaResult = {
    variables: new Map(base.variables),
    liquidSchema: new Map(base.liquidSchema),
    errors: [...base.errors, ...overlay.errors],
    usedLegacyLiquidSchema:
      base.usedLegacyLiquidSchema || overlay.usedLegacyLiquidSchema,
  };

  for (const [fieldName, declaration] of overlay.variables.entries()) {
    if (merged.variables.has(fieldName)) {
      merged.errors.push({
        severity: 'error',
        code: SCHEMA_ERROR_CODES.DUPLICATE_VARIABLE,
        message: `Duplicate variable "${fieldName}".`,
        field_name: fieldName,
      });
      continue;
    }
    merged.variables.set(fieldName, declaration);
    merged.liquidSchema.set(
      fieldName,
      keyPointerTypeToLiquid(declaration.data_type, declaration.options),
    );
  }

  if (overlay.usedLegacyLiquidSchema) {
    for (const [fieldName, liquidType] of overlay.liquidSchema.entries()) {
      merged.liquidSchema.set(fieldName, liquidType);
    }
  }

  return merged;
}
