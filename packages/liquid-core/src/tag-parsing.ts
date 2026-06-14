import { Tokenizer } from 'liquidjs';

// Fallback regex pattern for backward-compatible exports
const identifierRegex = /[_$\w-]+/;

/** Matches assign-style tag args: `varName = expression`. */
export const ASSIGN_KEY_VALUE_PATTERN = new RegExp(
  `(${identifierRegex.source})\\s*=(.*)`,
);

/** First identifier in capture tag args. */
export const CAPTURE_VARIABLE_PATTERN = new RegExp(
  `^\\s*(${identifierRegex.source})`,
);

/** Loop variable in for tag args: `item in collection`. */
export const FOR_LOOP_VARIABLE_PATTERN = new RegExp(
  `^\\s*(${identifierRegex.source})\\s+in\\s+`,
);

export interface AssignKeyValue {
  key: string;
  value: string;
}

export function parseAssignKeyValue(args: string): AssignKeyValue | null {
  const tokenizer = new Tokenizer(args);
  const key = tokenizer.readIdentifier().getText();
  if (!key) {
    return null;
  }
  tokenizer.skipBlank();
  if (tokenizer.peek() !== '=') {
    return null;
  }
  tokenizer.advance();
  return {
    key,
    value: tokenizer.remaining().trim(),
  };
}

export function parseCaptureVariable(args: string): string | null {
  const tokenizer = new Tokenizer(args);
  const key = tokenizer.readIdentifier().getText();
  return key || null;
}

export function parseForLoopVariable(args: string): string | null {
  const tokenizer = new Tokenizer(args);
  const key = tokenizer.readIdentifier().getText();
  if (!key) {
    return null;
  }
  tokenizer.skipBlank();
  const inWord = tokenizer.readIdentifier().getText();
  if (inWord !== 'in') {
    return null;
  }
  return key;
}
