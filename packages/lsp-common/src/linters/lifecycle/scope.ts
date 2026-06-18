import { DiagnosticSeverity, Range } from 'vscode-languageserver';
import type { Diagnostic } from 'vscode-languageserver';
import type { TagToken } from 'liquid-core';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  type ActiveVar,
  type BlockStackEntry,
  type LinterVariableType,
} from '../../shared/linter-types.js';
import { DIAGNOSTIC_CODES } from '../../shared/diagnostic-codes.js';
import type { LiquidType } from '../../shared/schema.js';

export function deepCloneType(t: LinterVariableType): LinterVariableType {
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object') {
    if (t.kind === 'branch_mismatch') {
      return {
        kind: 'branch_mismatch',
        types: t.types.map(deepCloneType) as LiquidType[],
        lines: [...t.lines],
        ranges: [...t.ranges],
      };
    }
    if (t.kind === 'primitive') {
      const res: { kind: 'primitive'; type: 'string' | 'number' | 'boolean' | 'date' | 'currency'; optional?: boolean } = {
        kind: 'primitive',
        type: t.type,
      };
      if (t.optional !== undefined) res.optional = t.optional;
      return res;
    }
    if (t.kind === 'dropdown') {
      const res: { kind: 'dropdown'; options: string[]; optional?: boolean } = {
        kind: 'dropdown',
        options: [...t.options],
      };
      if (t.optional !== undefined) res.optional = t.optional;
      return res;
    }
    if (t.kind === 'composite') {
      const clonedFields = new Map<string, LiquidType>();
      for (const [k, v] of t.fields.entries()) {
        clonedFields.set(k, deepCloneType(v) as LiquidType);
      }
      const res: { kind: 'composite'; fields: Map<string, LiquidType>; optional?: boolean; open?: boolean } = {
        kind: 'composite',
        fields: clonedFields,
      };
      if (t.optional !== undefined) res.optional = t.optional;
      if (t.open !== undefined) res.open = t.open;
      return res;
    }
    if (t.kind === 'array') {
      const res: { kind: 'array'; elementType: LiquidType; optional?: boolean } = {
        kind: 'array',
        elementType: deepCloneType(t.elementType) as LiquidType,
      };
      if (t.optional !== undefined) res.optional = t.optional;
      return res;
    }
  }
  return 'unknown';
}

export function narrowType(t: LinterVariableType): LinterVariableType {
  const cloned = deepCloneType(t);
  if (typeof cloned === 'string') return cloned;
  if (cloned && typeof cloned === 'object') {
    if (cloned.kind === 'primitive') {
      return cloned.type;
    }
    if (cloned.kind === 'composite') {
      cloned.optional = false;
      return cloned;
    }
    if (cloned.kind === 'array') {
      cloned.optional = false;
      return cloned;
    }
  }
  return cloned;
}

export function narrowPathInVar(
  t: LinterVariableType,
  parts: string[],
  partIdx: number,
): LinterVariableType {
  const current = narrowType(t);
  if (partIdx >= parts.length) {
    return current;
  }

  const fieldName = (parts[partIdx] ?? '').trim().replace(/\[\s*[a-zA-Z0-9_-]+\s*\]/g, '');
  if (!fieldName) return current;

  if (typeof current === 'object' && current.kind === 'composite') {
    const fieldType = current.fields.get(fieldName);
    if (fieldType) {
      const narrowedField = narrowPathInVar(fieldType, parts, partIdx + 1);
      current.fields.set(fieldName, narrowedField as LiquidType);
    }
  } else if (typeof current === 'object' && current.kind === 'array') {
    current.elementType = narrowPathInVar(current.elementType, parts, partIdx) as LiquidType;
  }

  return current;
}

export function extractTruthyPaths(conditionText: string): string[] {
  const paths: string[] = [];
  const parts = conditionText.split(/\band\b/i);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Case 1: simple variable or property path, e.g. "user.first_name"
    if (/^[a-zA-Z_][a-zA-Z0-9_.[\]'-]*$/.test(trimmed)) {
      paths.push(trimmed);
      continue;
    }

    // Case 2: check for "!= nil" or "!= null"
    const neqNilMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_.[\]'-]*)\s*!=\s*(nil|null)$/);
    if (neqNilMatch && neqNilMatch[1]) {
      paths.push(neqNilMatch[1].trim());
      continue;
    }

    // Case 3: check for "== true"
    const eqTrueMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_.[\]'-]*)\s*==\s*true$/);
    if (eqTrueMatch && eqTrueMatch[1]) {
      paths.push(eqTrueMatch[1].trim());
      continue;
    }
  }

  return paths;
}

export class ScopeTracker {
  public activeVars = new Map<string, ActiveVar>();
  public blockStack: BlockStackEntry[] = [];

  constructor(
    private doc: TextDocument,
    private diagnostics: Diagnostic[],
  ) {}

  public enterBlock(truthyPaths: string[] = []) {
    const branchOverrides = new Map<string, LinterVariableType>();

    for (const path of truthyPaths) {
      const parts = path.split('.');
      const baseVar = (parts[0] ?? '').trim().replace(/\[\s*[a-zA-Z0-9_-]+\s*\]/g, '');
      const v = this.activeVars.get(baseVar);
      if (v) {
        if (!branchOverrides.has(baseVar)) {
          branchOverrides.set(baseVar, deepCloneType(v.type));
        }
        v.type = narrowPathInVar(v.type, parts, 1);
      }
    }

    this.blockStack.push({
      branches: [new Map()],
      currentBranchIndex: 0,
      narrowedVars: [branchOverrides],
    });
  }

  public nextBranch(truthyPaths: string[] = []) {
    if (this.blockStack.length > 0) {
      const block = this.blockStack[this.blockStack.length - 1]!;

      // Restore previous branch overrides
      const prevOverrides = block.narrowedVars[block.currentBranchIndex];
      if (prevOverrides) {
        for (const [varName, originalType] of prevOverrides.entries()) {
          const v = this.activeVars.get(varName);
          if (v) {
            v.type = originalType;
          }
        }
      }

      block.currentBranchIndex++;
      block.branches.push(new Map());

      // Apply new branch overrides
      const branchOverrides = new Map<string, LinterVariableType>();
      for (const path of truthyPaths) {
        const parts = path.split('.');
        const baseVar = (parts[0] ?? '').trim().replace(/\[\s*[a-zA-Z0-9_-]+\s*\]/g, '');
        const v = this.activeVars.get(baseVar);
        if (v) {
          if (!branchOverrides.has(baseVar)) {
            branchOverrides.set(baseVar, deepCloneType(v.type));
          }
          v.type = narrowPathInVar(v.type, parts, 1);
        }
      }
      block.narrowedVars.push(branchOverrides);
    }
  }

  public exitBlock(): BlockStackEntry | undefined {
    const block = this.blockStack.pop();
    if (block && block.narrowedVars) {
      const activeOverrides = block.narrowedVars[block.currentBranchIndex];
      if (activeOverrides) {
        for (const [varName, originalType] of activeOverrides.entries()) {
          const v = this.activeVars.get(varName);
          if (v) {
            v.type = originalType;
          }
        }
      }
    }
    return block;
  }

  public get currentBlock(): BlockStackEntry | undefined {
    return this.blockStack[this.blockStack.length - 1];
  }

  public createDecl(
    varName: string,
    line: number,
    token: TagToken,
    offsetInToken: number,
    type: LinterVariableType,
  ) {
    const absPos = this.doc.positionAt(token.begin + offsetInToken);
    const start = { line: absPos.line, character: absPos.character };
    const end = { line: absPos.line, character: absPos.character + varName.length };
    return {
      declRange: Range.create(start, end),
      line,
      hasBeenRead: false,
      type,
    };
  }

  public isParallelBranchAssignment(varName: string): boolean {
    if (this.blockStack.length === 0) return false;
    const prev = this.activeVars.get(varName);
    if (!prev) return false;

    for (let i = this.blockStack.length - 1; i >= 0; i--) {
      const block = this.blockStack[i]!;
      for (let bIdx = 0; bIdx < block.branches.length; bIdx++) {
        if (bIdx === block.currentBranchIndex) continue;
        const branchMap = block.branches[bIdx]!;
        const branchVar = branchMap.get(varName);
        if (branchVar) {
          if (
            prev.declRange.start.line === branchVar.range.start.line &&
            prev.declRange.start.character === branchVar.range.start.character &&
            prev.declRange.end.line === branchVar.range.end.line &&
            prev.declRange.end.character === branchVar.range.end.character
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  public redefineIfNeeded(varName: string): void {
    if (this.isParallelBranchAssignment(varName)) {
      return;
    }
    const prev = this.activeVars.get(varName);
    if (prev && !prev.hasBeenRead && prev.line !== -1) {
      this.diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: prev.declRange,
        message: `You assigned a value to "${varName}" but never used it before overwriting it.`,
        code: DIAGNOSTIC_CODES.OVERWRITTEN_BEFORE_READ,
        source: 'liquid-lsp-linter',
      });
    }
  }

  public declareVariable(
    varName: string,
    line: number,
    token: TagToken,
    offsetInToken: number,
    type: LinterVariableType,
  ) {
    this.redefineIfNeeded(varName);
    const decl = this.createDecl(varName, line, token, offsetInToken, type);
    this.activeVars.set(varName, decl);

    const activeBlock = this.currentBlock;
    if (activeBlock) {
      const branchMap = activeBlock.branches[activeBlock.currentBranchIndex];
      if (branchMap) {
        branchMap.set(varName, {
          type,
          line,
          range: decl.declRange,
        });
      }
    }
  }
}
