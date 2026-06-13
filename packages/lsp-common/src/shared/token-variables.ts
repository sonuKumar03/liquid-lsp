import { TagTokenClass, type Token } from 'liquid-core';

const ASSIGN_TAG_NAMES = new Set(['assign', 'assignVar', 'parseAssign']);

export function collectVariableNamesFromTokens(tokens: Token[]): string[] {
  const names: string[] = [];

  for (const token of tokens) {
    if (!(token instanceof TagTokenClass)) {
      continue;
    }

    const tagName = token.name;
    const args = token.args.trim();

    if (ASSIGN_TAG_NAMES.has(tagName)) {
      const varMatch = args.match(/^([a-zA-Z0-9_-]+)/);
      if (varMatch?.[1]) {
        names.push(varMatch[1]);
      }
      continue;
    }

    if (tagName === 'capture') {
      const varMatch = args.match(/^([a-zA-Z0-9_-]+)/);
      if (varMatch?.[1]) {
        names.push(varMatch[1]);
      }
      continue;
    }

    if (tagName === 'for') {
      const varMatch = args.match(/^([a-zA-Z0-9_-]+)\s+in\s+/);
      if (varMatch?.[1]) {
        names.push(varMatch[1]);
      }
    }
  }

  return names;
}
