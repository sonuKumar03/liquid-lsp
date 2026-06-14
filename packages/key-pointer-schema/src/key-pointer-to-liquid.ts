/** Maps key-pointer wire types (19 allowlisted) to internal `LiquidType` for LSP inference. */
import type { LiquidType } from './liquid-types.js';
import type {
  KeyPointerDataType,
  KeyPointerSelectOption,
} from './key-pointer-types.js';

function composite(fields: Record<string, LiquidType>): LiquidType {
  return {
    kind: 'composite',
    fields: new Map(Object.entries(fields)),
  };
}

function dropdownFromOptions(
  options: KeyPointerSelectOption[] | undefined,
): LiquidType {
  const values = (options ?? []).map((option) => option.value);
  return { kind: 'dropdown', options: values };
}

export function keyPointerTypeToLiquid(
  dataType: KeyPointerDataType,
  options?: KeyPointerSelectOption[],
): LiquidType {
  switch (dataType) {
    case 'string':
    case 'text-box':
    case 'rich-text':
    case 'image':
      return 'string';
    case 'number':
      return 'number';
    case 'check-box':
      return 'boolean';
    case 'date':
    case 'date-range':
      return 'date';
    case 'currency':
      return 'currency';
    case 'dropdown':
      return dropdownFromOptions(options);
    case 'multi-dropdown':
    case 'multi-text-input':
      return 'string';
    case 'duration':
      return composite({
        value: 'number',
        type: 'string',
        days: 'number',
      });
    case 'phone-number':
      return composite({
        number: 'string',
        code: 'string',
        country_code: 'string',
      });
    case 'address':
      return composite({
        street: 'string',
        country_name: 'string',
        country_id: 'number',
        pincode: 'string',
        state_name: 'string',
        city_name: 'string',
        country_iso_code: 'string',
      });
    case 'related-contract':
      return composite({
        parent_contract_id: 'number',
        child_contract_id: 'number',
        child_contract_version_id: 'number',
      });
    case 'repeating':
    case 'table':
      return composite({});
    case 'multi-file':
      return composite({
        name: 'string',
        id: 'string',
        sizeBytes: 'number',
      });
    default: {
      const exhaustive: never = dataType;
      throw new Error(`Unhandled key pointer data type: ${exhaustive}`);
    }
  }
}
