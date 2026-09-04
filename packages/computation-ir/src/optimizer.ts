import type {
  ComputationIRDocument,
  ComputationIRNode,
  ComputationIRTagNode,
  ComputationIROutputNode,
} from './index.js';
import {
  foldConstants,
  parseExpressionToAST,
  type ExpressionNode,
} from './expressions.js';
import {
  type ControlFlowGraph,
  type CFGBasicBlock,
  type CFGInstruction,
  type CFGTerminator,
  analyzeCFGReachability,
} from './cfg.js';

/**
 * Prunes unreachable basic blocks from a Control Flow Graph and cleans up
 * predecessor lists and SSA Phi incoming branches.
 */
export function pruneUnreachableBlocks(
  cfg: ControlFlowGraph,
): ControlFlowGraph {
  const { reachableBlockIds } = analyzeCFGReachability(cfg);
  const reachableSet = new Set(reachableBlockIds);

  const newBlocks: Record<string, CFGBasicBlock> = {};

  for (const blockId of reachableBlockIds) {
    const block = cfg.blocks[blockId];
    if (!block) continue;

    // Filter predecessors to only reachable blocks
    const newPredecessors = block.predecessors.filter((predId) =>
      reachableSet.has(predId),
    );

    // Clean up instructions (especially Phi nodes whose incoming edges were pruned)
    const newInstructions: CFGInstruction[] = [];
    for (const inst of block.instructions) {
      if (inst.kind === 'phi') {
        const cleanedIncoming: Record<string, ExpressionNode> = {};
        for (const [predId, expr] of Object.entries(inst.incoming)) {
          if (reachableSet.has(predId)) {
            cleanedIncoming[predId] = expr;
          }
        }

        const incomingKeys = Object.keys(cleanedIncoming);
        if (incomingKeys.length === 0) {
          // No incoming values left
          continue;
        } else if (incomingKeys.length === 1) {
          // Degenerate Phi node with single incoming predecessor -> convert to direct assign
          const singleKey = incomingKeys[0]!;
          newInstructions.push({
            kind: 'assign',
            target: inst.target,
            expression: cleanedIncoming[singleKey]!,
          });
        } else {
          newInstructions.push({
            kind: 'phi',
            target: inst.target,
            incoming: cleanedIncoming,
          });
        }
      } else {
        newInstructions.push(inst);
      }
    }

    newBlocks[blockId] = {
      ...block,
      instructions: newInstructions,
      predecessors: newPredecessors,
      successors: block.successors.filter((succId) => reachableSet.has(succId)),
    };
  }

  return {
    entryBlockId: cfg.entryBlockId,
    blocks: newBlocks,
  };
}

/**
 * Optimizes a Control Flow Graph (CFG) by:
 * 1. Constant folding all instruction expressions
 * 2. Evaluating conditional branch and switch terminators with constant inputs
 * 3. Converting dead branches into unconditional jumps
 * 4. Pruning unreachable basic blocks and degenerate Phi nodes
 */
export function optimizeCFG(cfg: ControlFlowGraph): ControlFlowGraph {
  const updatedBlocks: Record<string, CFGBasicBlock> = {};

  function foldInstruction(inst: CFGInstruction): CFGInstruction {
    if (inst.kind === 'assign' || inst.kind === 'output') {
      return {
        ...inst,
        expression: foldConstants(inst.expression),
      };
    }
    if (inst.kind === 'phi') {
      const foldedIncoming: Record<string, ExpressionNode> = {};
      for (const [predId, expr] of Object.entries(inst.incoming)) {
        foldedIncoming[predId] = foldConstants(expr);
      }
      return {
        ...inst,
        incoming: foldedIncoming,
      };
    }
    if (inst.kind === 'computeColumn') {
      return {
        ...inst,
        instructions: inst.instructions.map(foldInstruction),
      };
    }
    return inst;
  }

  for (const [blockId, block] of Object.entries(cfg.blocks)) {
    // 1. Fold instructions
    const foldedInstructions: CFGInstruction[] =
      block.instructions.map(foldInstruction);

    // 2. Fold terminator
    let newTerminator: CFGTerminator = block.terminator;
    let newSuccessors: string[] = [...block.successors];

    if (block.terminator.kind === 'branch_if') {
      const foldedCond = foldConstants(block.terminator.condition);
      if (foldedCond.kind === 'literal') {
        const isTruthy = Boolean(foldedCond.value);
        if (isTruthy) {
          // Statically true -> unconditionally jump to trueTarget
          newTerminator = { kind: 'jump', target: block.terminator.trueTarget };
          newSuccessors = [block.terminator.trueTarget];
        } else {
          // Statically false -> unconditionally jump to falseTarget
          newTerminator = {
            kind: 'jump',
            target: block.terminator.falseTarget,
          };
          newSuccessors = [block.terminator.falseTarget];
        }
      } else {
        newTerminator = {
          kind: 'branch_if',
          condition: foldedCond,
          trueTarget: block.terminator.trueTarget,
          falseTarget: block.terminator.falseTarget,
        };
      }
    } else if (block.terminator.kind === 'switch') {
      const foldedDisc = foldConstants(block.terminator.discriminant);
      if (foldedDisc.kind === 'literal') {
        let matchedArmTarget: string | undefined;
        let allLiterals = true;

        for (const arm of block.terminator.cases) {
          const foldedArmVal = foldConstants(arm.value);
          if (foldedArmVal.kind === 'literal') {
            if (foldedArmVal.value === foldedDisc.value) {
              matchedArmTarget = arm.target;
              break;
            }
          } else {
            allLiterals = false;
          }
        }

        if (matchedArmTarget) {
          newTerminator = { kind: 'jump', target: matchedArmTarget };
          newSuccessors = [matchedArmTarget];
        } else if (allLiterals) {
          // No case arm matched and all were constant literals -> take defaultTarget
          newTerminator = {
            kind: 'jump',
            target: block.terminator.defaultTarget,
          };
          newSuccessors = [block.terminator.defaultTarget];
        }
      }
    }

    updatedBlocks[blockId] = {
      ...block,
      instructions: foldedInstructions,
      terminator: newTerminator,
      successors: newSuccessors,
    };
  }

  // 3. Rebuild predecessors from updated successors
  for (const block of Object.values(updatedBlocks)) {
    block.predecessors = [];
  }
  for (const [sourceId, block] of Object.entries(updatedBlocks)) {
    for (const succId of block.successors) {
      const succBlock = updatedBlocks[succId];
      if (succBlock && !succBlock.predecessors.includes(sourceId)) {
        succBlock.predecessors.push(sourceId);
      }
    }
  }

  // 4. Prune unreachable blocks and clean up degenerate Phi nodes
  return pruneUnreachableBlocks({
    entryBlockId: cfg.entryBlockId,
    blocks: updatedBlocks,
  });
}

/**
 * Optimizes a Computation IR Document by performing:
 * 1. Constant folding across all expression and filter sub-trees
 * 2. Algebraic reduction (e.g. x * 1 -> x, x + 0 -> x)
 * 3. Dead conditional branch elimination
 */
export function optimizeComputationIR(
  doc: ComputationIRDocument,
): ComputationIRDocument {
  function optimizeNode(
    node: ComputationIRNode,
  ): ComputationIRNode | ComputationIRNode[] | null {
    if (node.kind === 'text') {
      return node;
    }

    if (node.kind === 'output') {
      const ast = parseExpressionToAST(node.expression, node.filters);
      const folded = foldConstants(ast);
      const isFoldedLiteral = folded.kind === 'literal';
      const outputNode: ComputationIROutputNode = {
        ...node,
        expression: isFoldedLiteral ? String(folded.value) : node.expression,
        filters: isFoldedLiteral ? [] : node.filters,
      };
      return outputNode;
    }

    if (node.kind === 'tag') {
      const ast = parseExpressionToAST(node.expression, node.filters);
      const folded = foldConstants(ast);
      const isFoldedLiteral = folded.kind === 'literal';

      // Dead conditional branch elimination for 'if' tags
      if (node.name === 'if' && isFoldedLiteral) {
        const isTruthy = Boolean(folded.value);
        if (node.children) {
          const elseIndex = node.children.findIndex(
            (child) =>
              child.kind === 'tag' &&
              (child.name === 'else' || child.name === 'elsif'),
          );

          if (isTruthy) {
            // Keep only the then-branch children (before any else/elsif)
            const thenChildren =
              elseIndex >= 0
                ? node.children.slice(0, elseIndex)
                : node.children;
            return thenChildren.flatMap((c) => {
              const res = optimizeNode(c);
              if (!res) return [];
              return Array.isArray(res) ? res : [res];
            });
          } else {
            // Statically false
            if (elseIndex >= 0) {
              const branchTag = node.children[
                elseIndex
              ] as ComputationIRTagNode;
              const otherwiseChildren = node.children.slice(elseIndex + 1);
              if (branchTag.name === 'else') {
                return otherwiseChildren.flatMap((c) => {
                  const res = optimizeNode(c);
                  if (!res) return [];
                  return Array.isArray(res) ? res : [res];
                });
              } else if (branchTag.name === 'elsif') {
                // Transform into a new 'if' on the elsif condition
                const remainingIf: ComputationIRTagNode = {
                  ...branchTag,
                  name: 'if',
                  children: otherwiseChildren,
                };
                return optimizeNode(remainingIf);
              }
            }
            // No else branch -> entire if is pruned
            return null;
          }
        } else {
          return isTruthy ? [] : null;
        }
      }

      const tagNode: ComputationIRTagNode = {
        ...node,
        expression: isFoldedLiteral ? String(folded.value) : node.expression,
        filters: isFoldedLiteral ? [] : node.filters,
      };

      if (node.children) {
        tagNode.children = node.children.flatMap((c) => {
          const res = optimizeNode(c);
          if (!res) return [];
          return Array.isArray(res) ? res : [res];
        });
      }
      return tagNode;
    }

    return node;
  }

  const optimizedNodes: ComputationIRNode[] = [];
  for (const node of doc.nodes) {
    const res = optimizeNode(node);
    if (!res) continue;
    if (Array.isArray(res)) {
      optimizedNodes.push(...res);
    } else {
      optimizedNodes.push(res);
    }
  }

  return {
    ...doc,
    nodes: optimizedNodes,
  };
}
