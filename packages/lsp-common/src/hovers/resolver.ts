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

  // If baseVarRaw has index access, and currentType is array, unwrap it
  if (/\[\s*[a-zA-Z0-9_-]+\s*\]/.test(baseVarRaw)) {
    if (typeof currentType === 'object' && currentType.kind === 'array') {
      currentType = currentType.elementType;
    }
  }

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
        currentType = nextType as LiquidType;
      } else {
        return 'unknown';
      }
    } else if (typeof currentType === 'object' && currentType.kind === 'array') {
      // Direct property access on array (e.g. items.price), delegate to elementType
      const elemType = currentType.elementType;
      if (typeof elemType === 'object' && elemType.kind === 'composite') {
        const nextType = elemType.fields.get(fieldName);
        if (nextType) {
          currentType = nextType as LiquidType;
        } else {
          return 'unknown';
        }
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

    // If fieldNameRaw has index access, and currentType is array, unwrap it
    if (/\[\s*[a-zA-Z0-9_-]+\s*\]/.test(fieldNameRaw)) {
      if (typeof currentType === 'object' && currentType.kind === 'array') {
        currentType = currentType.elementType;
      }
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
  if (type.kind === 'array') {
    return `\`array<${formatLiquidType(type.elementType).replace(/`/g, '')}>\`${optStr}`;
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
