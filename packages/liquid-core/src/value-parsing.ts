import type { Liquid, ValueTemplate } from 'liquidjs';

/**
 * Parses an output expression (without `{{ }}`) into base value + filter chain.
 * Returns null when liquidjs rejects the expression string.
 */
export function parseOutputValue(
  engine: Liquid,
  expression: string,
): ValueTemplate | null {
  const trimmed = expression.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return engine.parser.parseValue(trimmed);
  } catch {
    return null;
  }
}
