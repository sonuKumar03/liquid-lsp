import type { Hover, TextDocumentPositionParams } from 'vscode-languageserver';
import { TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  LIQUID_TAGS,
  getTagDocumentation,
  getFilterDocumentation,
} from '../shared/constants.js';
import {
  getWordAtPosition,
  isKnownLiquidFilter,
  createLiquidEngine,
  tokenizeTopLevelSafe,
} from 'liquid-core';
import type { LiquidType } from '../shared/schema.js';
import { extractLocalVariableTypes } from '../shared/local-variable-types.js';

export function getVariablePathAtPosition(
  text: string,
  character: number,
): string {
  if (character < 0 || character >= text.length) return '';

  let start = character;
  while (start > 0 && /[a-zA-Z0-9_.[\]'"-]/.test(text[start - 1] || '')) {
    start--;
  }

  let end = character;
  while (end < text.length && /[a-zA-Z0-9_.[\]'"-]/.test(text[end] || '')) {
    end++;
  }

  return text.slice(start, end).trim();
}

export function resolveTypeForPath(
  path: string,
  schema: Map<string, LiquidType>,
): LiquidType {
  const parts = path.split('.');
  if (parts.length === 0) return 'unknown';

  const baseVarRaw = (parts[0] ?? '').trim();
  const baseVar = baseVarRaw.replace(/\[\s*[a-zA-Z0-9_-]+\s*\]/g, '');

  let currentType = schema.get(baseVar);
  if (!currentType) return 'unknown';

  for (let i = 1; i < parts.length; i++) {
    const fieldNameRaw = (parts[i] ?? '').trim();
    if (!fieldNameRaw) continue;
    const fieldName = fieldNameRaw.replace(/\[\s*[a-zA-Z0-9_-]+\s*\]/g, '');

    const currentTypeStr =
      typeof currentType === 'object' && currentType.kind === 'primitive'
        ? currentType.type
        : currentType;

    if (typeof currentType === 'object' && currentType.kind === 'composite') {
      const nextType = currentType.fields.get(fieldName);
      if (nextType) {
        currentType = nextType;
      } else {
        return 'unknown';
      }
    } else if (currentTypeStr === 'currency') {
      if (fieldName === 'amount') {
        currentType = 'number';
      } else if (fieldName === 'symbol') {
        currentType = 'string';
      } else {
        return 'unknown';
      }
    } else {
      return 'unknown';
    }
  }

  return currentType;
}

export function formatLiquidType(type: LiquidType): string {
  if (typeof type === 'string') {
    return `\`${type}\``;
  }
  const optStr = type.optional ? ' (optional)' : '';
  if (type.kind === 'primitive') {
    return `\`${type.type}\`${optStr}`;
  }
  if (type.kind === 'dropdown') {
    return `\`dropdown\` (Options: ${type.options.map((o) => `"${o}"`).join(', ')})${optStr}`;
  }
  if (type.kind === 'composite') {
    const fieldsStr = Array.from(type.fields.keys())
      .map((k) => `"${k}"`)
      .join(', ');
    return `\`object\` (Fields: ${fieldsStr})${optStr}`;
  }
  return '`unknown`';
}

export function resolveValueForPath(
  path: string,
  contextData: unknown,
): unknown {
  if (!contextData) return undefined;

  // Normalize bracket access (e.g. items[0] or items['key']) to dot notation
  const normalizedPath = path
    .replace(/\[\s*['"]?([a-zA-Z0-9_-]+)['"]?\s*\]/g, '.$1')
    .replace(/^\.+|\.+$/g, '');

  const parts = normalizedPath.split('.');
  let current: unknown = contextData;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const idx = parseInt(part, 10);
      if (!isNaN(idx)) {
        current = current[idx];
        continue;
      }
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

export function handleHover(
  documents: TextDocuments<TextDocument>,
  params: TextDocumentPositionParams,
  schema?: Map<string, LiquidType>,
  contextData?: unknown,
): Hover | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const position = params.position;
  // Get the entire line text containing the cursor
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 },
  });

  const word = getWordAtPosition(lineText, position.character);
  if (!word) return null;

  // Determine if the hover coordinate resides inside Liquid tag or output delimiters
  const lastTagOpen = lineText.lastIndexOf('{%', position.character);
  const lastTagClose = lineText.lastIndexOf('%}', position.character);
  const lastOutputOpen = lineText.lastIndexOf('{{', position.character);
  const lastOutputClose = lineText.lastIndexOf('}}', position.character);

  const isInsideTag = lastTagOpen !== -1 && lastTagOpen > lastTagClose;
  const isInsideOutput =
    lastOutputOpen !== -1 && lastOutputOpen > lastOutputClose;

  if (!isInsideTag && !isInsideOutput) {
    return null;
  }

  // 1. Check if the hovered word is a recognized tag
  const tagDoc = getTagDocumentation(word);
  const isKnownTag = LIQUID_TAGS.some((t) => t.label === word);
  if (isInsideTag && isKnownTag) {
    return {
      contents: {
        kind: 'markdown',
        value: `**Liquid Tag: \`{% ${word} %}\`**\n\n${tagDoc}`,
      },
    };
  }

  // 2. Check if the hovered word is a recognized filter
  const isKnownFilter = isKnownLiquidFilter(word);
  if (isKnownFilter) {
    const engine = createLiquidEngine();
    const tokens = tokenizeTopLevelSafe(doc.getText(), engine);
    const mergedSchema = schema ? extractLocalVariableTypes(schema, tokens, engine) : undefined;
    const filterDoc = resolveSchemaAwareDoc(word, mergedSchema);
    return {
      contents: {
        kind: 'markdown',
        value: `**Liquid Filter: \`| ${word}\`**\n\n${filterDoc}`,
      },
    };
  }

  // 3. Check if we can resolve variable type from the schema
  const path = getVariablePathAtPosition(lineText, position.character);
  if (path && schema) {
    const engine = createLiquidEngine();
    const tokens = tokenizeTopLevelSafe(doc.getText(), engine);
    const mergedSchema = extractLocalVariableTypes(schema, tokens, engine);
    const resolvedType = resolveTypeForPath(path, mergedSchema);
    if (resolvedType !== 'unknown') {
      const val = resolveValueForPath(path, contextData);
      const valStr =
        val !== undefined
          ? `\n\n**Value:** \`${typeof val === 'object' ? JSON.stringify(val) : val}\``
          : '';
      return {
        contents: {
          kind: 'markdown',
          value: `**Variable:** \`${path}\`\n\n**Type:** ${formatLiquidType(resolvedType)}${valStr}`,
        },
      };
    }
  }

  return null;
}

interface FilterHoverDetails {
  description: string;
  examples: string[];
  warning?: string;
  placeholders?: Record<string, 'number' | 'string' | 'date' | 'any'>;
}

const FILTER_HOVER_CARDS: Record<string, FilterHoverDetails> = {
  times: {
    description: 'Multiply a number by another value.',
    examples: [
      '{{ 5000 | times: 0.18 }}  →  900.0',
      '{{ base_salary | times: 1.3 }}  →  (30% raise)'
    ],
    warning: '⚠️  Both values must be numbers. Use | default: 0 if either might be blank.',
    placeholders: { base_salary: 'number' }
  },
  divided_by: {
    description: 'Divide a number by another value.',
    examples: [
      '{{ value | divided_by: divisor }}'
    ],
    warning: '⚠️  Divisor cannot be zero. Use | default: 1 for the divisor if it might be blank.',
    placeholders: { value: 'number', divisor: 'number' }
  },
  plus: {
    description: 'Add a number to another value.',
    examples: [
      '{{ price | plus: tax }}'
    ],
    warning: '⚠️  Both values must be numbers. Use | default: 0 if either might be blank.',
    placeholders: { price: 'number', tax: 'number' }
  },
  minus: {
    description: 'Subtract a number from another value.',
    examples: [
      '{{ price | minus: discount }}'
    ],
    warning: '⚠️  Both values must be numbers. Use | default: 0 if either might be blank.',
    placeholders: { price: 'number', discount: 'number' }
  },
  upcase: {
    description: 'Convert a text value to uppercase (capital letters).',
    examples: [
      '{{ name | upcase }}'
    ],
    warning: '⚠️  Input must be text.',
    placeholders: { name: 'string' }
  },
  downcase: {
    description: 'Convert a text value to lowercase.',
    examples: [
      '{{ name | downcase }}'
    ],
    placeholders: { name: 'string' }
  },
  date: {
    description: 'Format a date value.',
    examples: [
      '{{ effective_date | date: "%Y-%m-%d" }}'
    ],
    placeholders: { effective_date: 'date' }
  },
  default: {
    description: 'Provide a fallback value in case the variable is blank or has no value.',
    examples: [
      '{{ price | default: 0 }}',
      '{{ name | default: "N/A" }}'
    ],
    placeholders: { price: 'number', name: 'string' }
  }
};

function findVarOfType(schema: Map<string, LiquidType>, expectedType: 'number' | 'string' | 'date' | 'any'): string | null {
  for (const [name, type] of schema.entries()) {
    const typeStr = typeof type === 'object' && type.kind === 'primitive' ? type.type : typeof type === 'string' ? type : 'unknown';
    if (expectedType === 'any') return name;
    if (expectedType === 'number' && (typeStr === 'number' || typeStr === 'currency')) return name;
    if (expectedType === 'string' && typeStr === 'string') return name;
    if (expectedType === 'date' && typeStr === 'date') return name;
  }
  return null;
}

function resolveSchemaAwareDoc(
  filterName: string,
  schema?: Map<string, LiquidType>
): string {
  const details = FILTER_HOVER_CARDS[filterName];
  if (!details) {
    return getFilterDocumentation(filterName);
  }

  let doc = `${details.description}\n\n`;

  const replacements: Record<string, string> = {};
  if (schema && details.placeholders) {
    for (const [placeholder, expectedType] of Object.entries(details.placeholders)) {
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
      substituted = substituted.replace(new RegExp(`\\b${placeholder}\\b`, 'g'), realVarName);
    }
    doc += `  ${substituted}\n`;
  }

  if (details.warning) {
    doc += `\n${details.warning}`;
  }

  return doc;
}
