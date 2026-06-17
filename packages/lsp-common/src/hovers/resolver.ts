import type { LiquidType } from '../shared/schema.js';

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
