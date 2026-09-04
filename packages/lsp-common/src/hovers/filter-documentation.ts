import {
  getFilterDocumentation,
  FILTER_PREVIEWS,
} from '../shared/constants.js';
import type { LiquidType } from '../shared/schema.js';

export interface FilterHoverDetails {
  description: string;
  examples: string[];
  warning?: string;
  placeholders?: Record<string, 'number' | 'string' | 'date' | 'any'>;
}

export const FILTER_HOVER_CARDS: Record<string, FilterHoverDetails> = {
  times: {
    description: 'Multiply a number by another value.',
    examples: [
      '{{ 5000 | times: 0.18 }}  →  900.0',
      '{{ base_salary | times: 1.3 }}  →  (30% raise)',
    ],
    warning:
      '⚠️  Both values must be numbers. Use | default: 0 if either might be blank.',
    placeholders: { base_salary: 'number' },
  },
  divided_by: {
    description: 'Divide a number by another value.',
    examples: ['{{ value | divided_by: divisor }}'],
    warning:
      '⚠️  Divisor cannot be zero. Use | default: 1 for the divisor if it might be blank.',
    placeholders: { value: 'number', divisor: 'number' },
  },
  plus: {
    description: 'Add a number to another value.',
    examples: ['{{ price | plus: tax }}'],
    warning:
      '⚠️  Both values must be numbers. Use | default: 0 if either might be blank.',
    placeholders: { price: 'number', tax: 'number' },
  },
  minus: {
    description: 'Subtract a number from another value.',
    examples: ['{{ price | minus: discount }}'],
    warning:
      '⚠️  Both values must be numbers. Use | default: 0 if either might be blank.',
    placeholders: { price: 'number', discount: 'number' },
  },
  upcase: {
    description: 'Convert a text value to uppercase (capital letters).',
    examples: ['{{ name | upcase }}'],
    warning: '⚠️  Input must be text.',
    placeholders: { name: 'string' },
  },
  downcase: {
    description: 'Convert a text value to lowercase.',
    examples: ['{{ name | downcase }}'],
    placeholders: { name: 'string' },
  },
  date: {
    description: 'Format a date value.',
    examples: ['{{ effective_date | date: "%Y-%m-%d" }}'],
    placeholders: { effective_date: 'date' },
  },
  default: {
    description:
      'Provide a fallback value in case the variable is blank or has no value.',
    examples: ['{{ price | default: 0 }}', '{{ name | default: "N/A" }}'],
    placeholders: { price: 'number', name: 'string' },
  },
};

export function findVarOfType(
  schema: Map<string, LiquidType>,
  expectedType: 'number' | 'string' | 'date' | 'any',
): string | null {
  for (const [name, type] of schema.entries()) {
    const typeStr =
      typeof type === 'object' && type.kind === 'primitive'
        ? type.type
        : typeof type === 'string'
          ? type
          : 'unknown';
    if (expectedType === 'any') return name;
    if (
      expectedType === 'number' &&
      (typeStr === 'number' || typeStr === 'currency')
    )
      return name;
    if (expectedType === 'string' && typeStr === 'string') return name;
    if (expectedType === 'date' && typeStr === 'date') return name;
  }
  return null;
}

export function resolveSchemaAwareDoc(
  filterName: string,
  schema?: Map<string, LiquidType>,
): string {
  const details = FILTER_HOVER_CARDS[filterName];
  if (!details) {
    return getFilterDocumentation(filterName);
  }

  let doc = `${details.description}\n\n`;

  const replacements: Record<string, string> = {};
  if (schema && details.placeholders) {
    for (const [placeholder, expectedType] of Object.entries(
      details.placeholders,
    )) {
      const realVarName = findVarOfType(schema, expectedType);
      if (realVarName) {
        replacements[placeholder] = realVarName;
      }
    }
  }

  doc += `Example:\n`;
  for (const example of details.examples) {
    let substituted = example;
    for (const [placeholder, realVarName] of Object.entries(replacements)) {
      substituted = substituted.replace(
        new RegExp(`\\b${placeholder}\\b`, 'g'),
        realVarName,
      );
    }
    doc += `  ${substituted}\n`;
  }

  if (details.warning) {
    doc += `\n${details.warning}`;
  }

  return doc;
}

export function resolveSchemaAwareDetail(
  filterName: string,
  schema?: Map<string, LiquidType>,
): string | undefined {
  const details = FILTER_HOVER_CARDS[filterName];
  const preview = FILTER_PREVIEWS[filterName];
  if (!details || !schema) {
    return preview;
  }

  let chosenExample = details.examples[0];
  if (!chosenExample) {
    return preview;
  }

  if (details.placeholders) {
    const placeholderKeys = Object.keys(details.placeholders);
    for (const ex of details.examples) {
      if (placeholderKeys.some((key) => ex.includes(key))) {
        chosenExample = ex;
        break;
      }
    }
  }

  const replacements: Record<string, string> = {};
  if (details.placeholders) {
    for (const [placeholder, expectedType] of Object.entries(
      details.placeholders,
    )) {
      const realVarName = findVarOfType(schema, expectedType);
      if (realVarName) {
        replacements[placeholder] = realVarName;
      }
    }
  }

  let substituted = chosenExample;
  for (const [placeholder, realVarName] of Object.entries(replacements)) {
    substituted = substituted.replace(
      new RegExp(`\\b${placeholder}\\b`, 'g'),
      realVarName,
    );
  }

  const match = substituted.match(/^\{\{\s*(.*?)\s*\}\}(.*)$/);
  if (match) {
    const val = match[1];
    const rest = match[2];
    if (val !== undefined && rest !== undefined) {
      return (val + rest).trim();
    }
  }

  return substituted.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '');
}
