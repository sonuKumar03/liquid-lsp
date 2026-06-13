import { TagTokenClass, type Token } from 'liquid-core';
import {
  parseAssignKeyValue,
  parseCaptureVariable,
  parseForLoopVariable,
} from 'liquid-core';

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
      const parsed = parseAssignKeyValue(args);
      if (parsed) {
        names.push(parsed.key);
      }
      continue;
    }

    if (tagName === 'capture') {
      const varName = parseCaptureVariable(args);
      if (varName) {
        names.push(varName);
      }
      continue;
    }

    if (tagName === 'for') {
      const varName = parseForLoopVariable(args);
      if (varName) {
        names.push(varName);
      }
    }
  }

  return names;
}
