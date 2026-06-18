/** Maps key-pointer wire types (19 allowlisted) to internal `LiquidType` for LSP inference. */
import type { LiquidType } from './liquid-types.js';
import type {
  KeyPointerDataType,
  KeyPointerSelectOption,
} from './key-pointer-types.js';

function composite(fields: Record<string, LiquidType>, open?: boolean): LiquidType {
  return {
    kind: 'composite',
    fields: new Map(Object.entries(fields)),
    ...(open ? { open } : {}),
  };
}

function dropdownFromOptions(
  options: KeyPointerSelectOption[] | undefined,
): LiquidType {
  const values = (options ?? []).map((option) => option.value);
  return { kind: 'dropdown', options: values };
}

// 1. Static type definitions mapping
const STATIC_TYPE_MAPPING: Record<
  Extract<
    KeyPointerDataType,
    | 'string'
    | 'text-box'
    | 'rich-text'
    | 'image'
    | 'number'
    | 'check-box'
    | 'date'
    | 'date-range'
    | 'currency'
    | 'multi-dropdown'
    | 'multi-text-input'
  >,
  LiquidType
> = {
  string: 'string',
  'text-box': 'string',
  'rich-text': 'string',
  image: 'string',
  number: 'number',
  'check-box': 'boolean',
  date: 'date',
  'date-range': 'date',
  currency: 'currency',
  'multi-dropdown': 'string',
  'multi-text-input': 'string',
};

// 2. Composite structures mapping
const COMPOSITE_TYPE_MAPPING: Record<
  Extract<
    KeyPointerDataType,
    | 'duration'
    | 'phone-number'
    | 'address'
    | 'related-contract'
    | 'repeating'
    | 'table'
    | 'multi-file'
  >,
  LiquidType
> = {
  duration: composite({
    value: 'number',
    type: 'string',
    days: 'number',
  }),
  'phone-number': composite({
    number: 'string',
    code: 'string',
    country_code: 'string',
  }),
  address: composite({
    street: 'string',
    country_name: 'string',
    country_id: 'number',
    pincode: 'string',
    state_name: 'string',
    city_name: 'string',
    country_iso_code: 'string',
  }),
  'related-contract': composite({
    parent_contract_id: 'number',
    child_contract_id: 'number',
    child_contract_version_id: 'number',
  }),
  repeating: {
    kind: 'array',
    elementType: composite({}, true),
  },
  table: {
    kind: 'array',
    elementType: composite({}, true),
  },
  'multi-file': {
    kind: 'array',
    elementType: composite({
      name: 'string',
      id: 'string',
      sizeBytes: 'number',
    }),
  },
};

// 3. Entry point mapping with exhaustive compile-time checking
export function keyPointerTypeToLiquid(
  dataType: KeyPointerDataType,
  options?: KeyPointerSelectOption[],
): LiquidType {
  switch (dataType) {
    case 'string':
    case 'text-box':
    case 'rich-text':
    case 'image':
    case 'number':
    case 'check-box':
    case 'date':
    case 'date-range':
    case 'currency':
    case 'multi-dropdown':
    case 'multi-text-input':
      return STATIC_TYPE_MAPPING[dataType];

    case 'duration':
    case 'phone-number':
    case 'address':
    case 'related-contract':
    case 'repeating':
    case 'table':
    case 'multi-file':
      return COMPOSITE_TYPE_MAPPING[dataType];

    case 'dropdown':
      return dropdownFromOptions(options);

    default: {
      const exhaustive: never = dataType;
      throw new Error(`Unhandled key pointer data type: ${exhaustive}`);
    }
  }
}
