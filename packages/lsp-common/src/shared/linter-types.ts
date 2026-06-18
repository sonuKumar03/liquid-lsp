import { Range } from 'vscode-languageserver';
import type { LiquidType } from './schema.js';

export type BranchMismatchType = {
  kind: 'branch_mismatch';
  types: LiquidType[];
  lines: number[];
  ranges: Range[];
};

export type LinterVariableType = LiquidType | BranchMismatchType;

export type ActiveVar = {
  declRange: Range;
  line: number;
  hasBeenRead: boolean;
  type: LinterVariableType;
};

export interface BlockStackEntry {
  branches: Array<Map<string, { type: LinterVariableType; line: number; range: Range }>>;
  currentBranchIndex: number;
  narrowedVars: Array<Map<string, LinterVariableType>>;
}

/**
 * Type guard for BranchMismatchType.
 */
export function isBranchMismatchType(t: LinterVariableType): t is BranchMismatchType {
  return t !== null && typeof t === 'object' && t.kind === 'branch_mismatch';
}

/**
 * Checks if a type is optional (i.e. nullable/optional primitive, or contains optional types).
 */
export function isOptionalType(type: LinterVariableType): boolean {
  if (typeof type === 'string') return false;
  if (type && typeof type === 'object') {
    if (type.kind === 'primitive') {
      return !!type.optional;
    }
    if (type.kind === 'array') {
      return !!type.optional || isOptionalType(type.elementType);
    }
    if (type.kind === 'branch_mismatch') {
      return type.types.some((t) => isOptionalType(t));
    }
  }
  return false;
}

/**
 * Formats a LinterVariableType into a user-readable string.
 */
export function formatLinterType(t: LinterVariableType): string {
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object') {
    if (t.kind === 'branch_mismatch') return 'branch_mismatch';
    if (t.kind === 'primitive') return t.type + (t.optional ? '?' : '');
    if (t.kind === 'dropdown') return 'dropdown';
    if (t.kind === 'composite') return 'composite';
    if (t.kind === 'array') return `array<${formatLinterType(t.elementType)}>` + (t.optional ? '?' : '');
  }
  return 'unknown';
}

