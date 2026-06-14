import registryFile from './key-pointer-types.registry.json' with { type: 'json' };

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

  const registry = new Map<KeyPointerDataType, KeyPointerTypeDefinition>();
  for (const entry of registryFile.types) {
    if (!isKnownKeyPointerDataType(entry.data_type)) {
      continue;
    }
    const typeDef: KeyPointerTypeDefinition = {
      data_type: entry.data_type,
      key_pointer_value_type_supported: entry.key_pointer_value_type_supported,
      supports_extraction: entry.supports_extraction,
      supports_computation: entry.supports_computation,
    };
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
