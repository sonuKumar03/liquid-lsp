import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const KNOWN_KEY_POINTER_DATA_TYPES = [
  'check-box',
  'string',
  'date',
  'number',
  'text-box',
  'currency',
  'phone-number',
  'address',
  'duration',
  'multi-dropdown',
  'dropdown',
  'date-range',
  'table',
  'multi-text-input',
  'rich-text',
  'repeating',
  'multi-file',
  'image',
  'related-contract',
] as const;

export type KeyPointerDataType = (typeof KNOWN_KEY_POINTER_DATA_TYPES)[number];

export interface KeyPointerSelectOption {
  label: string;
  value: string;
}

export interface KeyPointerTypeDefinition {
  data_type: KeyPointerDataType;
  key_pointer_value_type_supported: boolean;
  supports_extraction: boolean;
  supports_computation: boolean;
}

interface RegistryFile {
  types: KeyPointerTypeDefinition[];
}

const KNOWN_TYPE_SET = new Set<string>(KNOWN_KEY_POINTER_DATA_TYPES);

export function isKnownKeyPointerDataType(
  value: string,
): value is KeyPointerDataType {
  return KNOWN_TYPE_SET.has(value);
}

export function formatKnownKeyPointerDataTypes(): string {
  return KNOWN_KEY_POINTER_DATA_TYPES.join(', ');
}

let cachedRegistry: Map<KeyPointerDataType, KeyPointerTypeDefinition> | null =
  null;

export function loadTypeRegistry(): Map<
  KeyPointerDataType,
  KeyPointerTypeDefinition
> {
  if (cachedRegistry) {
    return cachedRegistry;
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const registryPath = join(moduleDir, 'key-pointer-types.registry.json');
  const raw = readFileSync(registryPath, 'utf8');
  const parsed = JSON.parse(raw) as RegistryFile;

  const registry = new Map<KeyPointerDataType, KeyPointerTypeDefinition>();
  for (const typeDef of parsed.types) {
    if (!isKnownKeyPointerDataType(typeDef.data_type)) {
      continue;
    }
    registry.set(typeDef.data_type, typeDef);
  }

  cachedRegistry = registry;
  return registry;
}

export function supportsKeyPointerComputation(
  dataType: KeyPointerDataType,
): boolean {
  const definition = loadTypeRegistry().get(dataType);
  return definition?.supports_computation ?? false;
}
