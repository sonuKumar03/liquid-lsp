import type { LiquidType } from './schema.js';
import type {
  KeyPointerDataType,
  KeyPointerSelectOption,
} from './key-pointer-types.js';

export interface VariableDeclaration {
  field_name: string;
  data_type: KeyPointerDataType;
  options?: KeyPointerSelectOption[];
}

export type SchemaLoadSeverity = 'error' | 'warning';

export interface SchemaLoadError {
  severity: SchemaLoadSeverity;
  code: string;
  message: string;
  field_name?: string;
}

export interface ParseVariableSchemaResult {
  variables: Map<string, VariableDeclaration>;
  liquidSchema: Map<string, LiquidType>;
  errors: SchemaLoadError[];
  usedLegacyLiquidSchema: boolean;
}
