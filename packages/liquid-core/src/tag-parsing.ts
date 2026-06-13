import { lexical } from './lexical.js';

/** Matches assign-style tag args: `varName = expression`. */
export const ASSIGN_KEY_VALUE_PATTERN = new RegExp(
  `(${lexical.identifier.source})\\s*=(.*)`,
);

/** First identifier in capture tag args. */
export const CAPTURE_VARIABLE_PATTERN = new RegExp(
  `^\\s*(${lexical.identifier.source})`,
);

/** Loop variable in for tag args: `item in collection`. */
export const FOR_LOOP_VARIABLE_PATTERN = new RegExp(
  `^\\s*(${lexical.identifier.source})\\s+in\\s+`,
);

export interface AssignKeyValue {
  key: string;
  value: string;
}

export function parseAssignKeyValue(args: string): AssignKeyValue | null {
  const match = args.match(ASSIGN_KEY_VALUE_PATTERN);
  if (!match?.[1]) {
    return null;
  }
  return {
    key: match[1],
    value: (match[2] ?? '').trim(),
  };
}

export function parseCaptureVariable(args: string): string | null {
  const match = args.match(CAPTURE_VARIABLE_PATTERN);
  return match?.[1] ?? null;
}

export function parseForLoopVariable(args: string): string | null {
  const match = args.match(FOR_LOOP_VARIABLE_PATTERN);
  return match?.[1] ?? null;
}
