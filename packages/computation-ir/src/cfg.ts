import type { ComputationIRDocument, ComputationIRNode } from "./index.js";
import { parseExpressionToAST, type ExpressionNode } from "./expressions.js";

export type CFGInstruction =
  | { kind: "assign"; target: string; expression: ExpressionNode }
  | { kind: "output"; expression: ExpressionNode }
  | { kind: "computeColumn"; table: string; column: string; instructions: CFGInstruction[] };

export type CFGTerminator =
  | { kind: "branch_if"; condition: ExpressionNode; trueTarget: string; falseTarget: string }
  | { kind: "jump"; target: string }
  | { kind: "return" };

export interface CFGBasicBlock {
  id: string;
  label?: string;
  instructions: CFGInstruction[];
  terminator: CFGTerminator;
  predecessors: string[];
  successors: string[];
}

export interface ControlFlowGraph {
  entryBlockId: string;
  blocks: Record<string, CFGBasicBlock>;
}

/**
 * Builds a Control Flow Graph (CFG) from a Computation IR Document.
 */
export function buildControlFlowGraph(doc: ComputationIRDocument): ControlFlowGraph {
  let blockCounter = 0;
  function createBlockId(prefix = "block"): string {
    return `${prefix}_${blockCounter++}`;
  }

  const blocks: Record<string, CFGBasicBlock> = {};
  const entryId = createBlockId("entry");

  let currentBlock: CFGBasicBlock = {
    id: entryId,
    instructions: [],
    terminator: { kind: "return" },
    predecessors: [],
    successors: [],
  };
  blocks[entryId] = currentBlock;

  function processNodes(nodes: ComputationIRNode[]) {
    for (const node of nodes) {
      if (node.kind === "output") {
        currentBlock.instructions.push({
          kind: "output",
          expression: parseExpressionToAST(node.expression, node.filters),
        });
      } else if (node.kind === "tag") {
        if (node.name === "assign" || node.name === "assignVar" || node.name === "parseAssign") {
          currentBlock.instructions.push({
            kind: "assign",
            target: node.target || "result",
            expression: parseExpressionToAST(node.expression, node.filters),
          });
        } else if (node.name === "computeColumn") {
          const parts = node.args.trim().split(/\s+/);
          const table = parts[0] || "table";
          const column = parts[1] || "column";
          const innerInstructions: CFGInstruction[] = [];
          if (node.children) {
            for (const child of node.children) {
              if (child.kind === "tag" && child.target) {
                innerInstructions.push({
                  kind: "assign",
                  target: child.target,
                  expression: parseExpressionToAST(child.expression, child.filters),
                });
              }
            }
          }
          currentBlock.instructions.push({
            kind: "computeColumn",
            table,
            column,
            instructions: innerInstructions,
          });
        } else if (node.name === "if" || node.name === "unless") {
          const conditionAst = parseExpressionToAST(node.expression, node.filters);
          const thenBlockId = createBlockId("then");
          const joinBlockId = createBlockId("join");
          const elseBlockId = createBlockId("else");

          const thenBlock: CFGBasicBlock = {
            id: thenBlockId,
            label: "then",
            instructions: [],
            terminator: { kind: "jump", target: joinBlockId },
            predecessors: [currentBlock.id],
            successors: [joinBlockId],
          };
          blocks[thenBlockId] = thenBlock;

          const elseBlock: CFGBasicBlock = {
            id: elseBlockId,
            label: "else",
            instructions: [],
            terminator: { kind: "jump", target: joinBlockId },
            predecessors: [currentBlock.id],
            successors: [joinBlockId],
          };
          blocks[elseBlockId] = elseBlock;

          const joinBlock: CFGBasicBlock = {
            id: joinBlockId,
            label: "join",
            instructions: [],
            terminator: { kind: "return" },
            predecessors: [thenBlockId, elseBlockId],
            successors: [],
          };
          blocks[joinBlockId] = joinBlock;

          currentBlock.terminator = {
            kind: "branch_if",
            condition: conditionAst,
            trueTarget: thenBlockId,
            falseTarget: elseBlockId,
          };
          currentBlock.successors = [thenBlockId, elseBlockId];

          // Process children inside then block
          currentBlock = thenBlock;
          if (node.children) {
            processNodes(node.children);
          }

          // Continue from join block
          currentBlock = joinBlock;
        }
      }
    }
  }

  processNodes(doc.nodes);
  return { entryBlockId: entryId, blocks };
}

/**
 * Analyzes reachability of blocks in a Control Flow Graph.
 */
export function analyzeCFGReachability(cfg: ControlFlowGraph): {
  reachableBlockIds: string[];
  unreachableBlockIds: string[];
} {
  const visited = new Set<string>();
  const queue = [cfg.entryBlockId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const block = cfg.blocks[currentId];
    if (block) {
      for (const succ of block.successors) {
        if (!visited.has(succ)) {
          queue.push(succ);
        }
      }
    }
  }

  const allBlockIds = Object.keys(cfg.blocks);
  const reachableBlockIds = Array.from(visited);
  const unreachableBlockIds = allBlockIds.filter((id) => !visited.has(id));

  return { reachableBlockIds, unreachableBlockIds };
}
