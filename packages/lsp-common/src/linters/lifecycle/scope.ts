import { DiagnosticSeverity, Range } from 'vscode-languageserver';
import type { Diagnostic } from 'vscode-languageserver';
import type { TagToken } from 'liquid-core';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  type ActiveVar,
  type BlockStackEntry,
  type LinterVariableType,
} from '../../shared/linter-types.js';

export class ScopeTracker {
  public activeVars = new Map<string, ActiveVar>();
  public blockStack: BlockStackEntry[] = [];

  constructor(
    private doc: TextDocument,
    private diagnostics: Diagnostic[],
  ) {}

  public enterBlock() {
    this.blockStack.push({
      branches: [new Map()],
      currentBranchIndex: 0,
    });
  }

  public nextBranch() {
    if (this.blockStack.length > 0) {
      const block = this.blockStack[this.blockStack.length - 1]!;
      block.currentBranchIndex++;
      block.branches.push(new Map());
    }
  }

  public exitBlock(): BlockStackEntry | undefined {
    return this.blockStack.pop();
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
  ): ActiveVar {
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
