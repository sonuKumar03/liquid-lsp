import type { ComputationIRDocument, ComputationIRNode } from './index.js';
import { parseExpressionToAST, type ExpressionNode } from './expressions.js';

export type CFGInstruction =
  | { kind: 'assign'; target: string; expression: ExpressionNode }
  | { kind: 'phi'; target: string; incoming: Record<string, ExpressionNode> }
  | { kind: 'output'; expression: ExpressionNode }
  | {
      kind: 'computeColumn';
      table: string;
      column: string;
      instructions: CFGInstruction[];
    };

export type CFGTerminator =
  | {
      kind: 'branch_if';
      condition: ExpressionNode;
      trueTarget: string;
      falseTarget: string;
    }
  | {
      kind: 'switch';
      discriminant: ExpressionNode;
      cases: { value: ExpressionNode; target: string }[];
      defaultTarget: string;
    }
  | { kind: 'jump'; target: string }
  | { kind: 'return' };

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
export function buildControlFlowGraph(
  doc: ComputationIRDocument,
): ControlFlowGraph {
  let blockCounter = 0;
  function createBlockId(prefix = 'block'): string {
    return `${prefix}_${blockCounter++}`;
  }

  const blocks: Record<string, CFGBasicBlock> = {};
  const entryId = createBlockId('entry');

  let currentBlock: CFGBasicBlock = {
    id: entryId,
    instructions: [],
    terminator: { kind: 'return' },
    predecessors: [],
    successors: [],
  };
  blocks[entryId] = currentBlock;

  function processNodes(nodes: ComputationIRNode[]) {
    for (const node of nodes) {
      if (node.kind === 'output') {
        currentBlock.instructions.push({
          kind: 'output',
          expression: parseExpressionToAST(node.expression, node.filters),
        });
      } else if (node.kind === 'tag') {
        if (
          node.name === 'assign' ||
          node.name === 'assignVar' ||
          node.name === 'parseAssign'
        ) {
          currentBlock.instructions.push({
            kind: 'assign',
            target: node.target || 'result',
            expression: parseExpressionToAST(node.expression, node.filters),
          });
        } else if (node.name === 'computeColumn') {
          const parts = node.args.trim().split(/\s+/);
          const table = parts[0] || 'table';
          const column = parts[1] || 'column';
          const innerInstructions: CFGInstruction[] = [];
          if (node.children) {
            for (const child of node.children) {
              if (child.kind === 'tag' && child.target) {
                innerInstructions.push({
                  kind: 'assign',
                  target: child.target,
                  expression: parseExpressionToAST(
                    child.expression,
                    child.filters,
                  ),
                });
              }
            }
          }
          currentBlock.instructions.push({
            kind: 'computeColumn',
            table,
            column,
            instructions: innerInstructions,
          });
        } else if (node.name === 'if' || node.name === 'unless') {
          const conditionAst = parseExpressionToAST(
            node.expression,
            node.filters,
          );
          const thenBlockId = createBlockId('then');
          const joinBlockId = createBlockId('join');
          const elseBlockId = createBlockId('else');

          const thenBlock: CFGBasicBlock = {
            id: thenBlockId,
            label: 'then',
            instructions: [],
            terminator: { kind: 'jump', target: joinBlockId },
            predecessors: [currentBlock.id],
            successors: [joinBlockId],
          };
          blocks[thenBlockId] = thenBlock;

          const elseBlock: CFGBasicBlock = {
            id: elseBlockId,
            label: 'else',
            instructions: [],
            terminator: { kind: 'jump', target: joinBlockId },
            predecessors: [currentBlock.id],
            successors: [joinBlockId],
          };
          blocks[elseBlockId] = elseBlock;

          const joinBlock: CFGBasicBlock = {
            id: joinBlockId,
            label: 'join',
            instructions: [],
            terminator: { kind: 'return' },
            predecessors: [thenBlockId, elseBlockId],
            successors: [],
          };
          blocks[joinBlockId] = joinBlock;

          currentBlock.terminator = {
            kind: 'branch_if',
            condition: conditionAst,
            trueTarget: node.name === 'unless' ? elseBlockId : thenBlockId,
            falseTarget: node.name === 'unless' ? thenBlockId : elseBlockId,
          };
          currentBlock.successors = [thenBlockId, elseBlockId];

          // Partition children into then-branch and else/elsif branches
          const children = node.children ?? [];
          const branchIdx = children.findIndex(
            (c) =>
              c.kind === 'tag' && (c.name === 'else' || c.name === 'elsif'),
          );

          const thenChildren =
            branchIdx >= 0 ? children.slice(0, branchIdx) : children;
          const otherwiseChildren =
            branchIdx >= 0 ? children.slice(branchIdx) : [];

          // Process then block
          currentBlock = thenBlock;
          processNodes(thenChildren);

          // Process else / elsif branch
          currentBlock = elseBlock;
          if (otherwiseChildren.length > 0) {
            const firstBranch = otherwiseChildren[0];
            if (
              firstBranch &&
              firstBranch.kind === 'tag' &&
              firstBranch.name === 'else'
            ) {
              processNodes(otherwiseChildren.slice(1));
            } else if (
              firstBranch &&
              firstBranch.kind === 'tag' &&
              firstBranch.name === 'elsif'
            ) {
              const elsifNode: ComputationIRNode = {
                ...firstBranch,
                name: 'if',
                children: otherwiseChildren.slice(1),
              };
              processNodes([elsifNode]);
            }
          }

          // Build accurate Phi nodes for all variables assigned in either thenBlock or elseBlock
          const thenAssignments = new Map<string, ExpressionNode>();
          for (const inst of thenBlock.instructions) {
            if (inst.kind === 'assign') {
              thenAssignments.set(inst.target, inst.expression);
            }
          }

          const elseAssignments = new Map<string, ExpressionNode>();
          for (const inst of elseBlock.instructions) {
            if (inst.kind === 'assign') {
              elseAssignments.set(inst.target, inst.expression);
            }
          }

          const allAssignedVars = new Set([
            ...thenAssignments.keys(),
            ...elseAssignments.keys(),
          ]);

          const nullLiteral: ExpressionNode = {
            kind: 'literal',
            valueType: 'null',
            value: null,
          };

          for (const target of allAssignedVars) {
            joinBlock.instructions.push({
              kind: 'phi',
              target,
              incoming: {
                [thenBlockId]: thenAssignments.get(target) ?? nullLiteral,
                [elseBlockId]: elseAssignments.get(target) ?? nullLiteral,
              },
            });
          }

          // Continue from join block
          currentBlock = joinBlock;
        } else if (node.name === 'for') {
          const collectionAst = parseExpressionToAST(
            node.expression,
            node.filters,
          );
          const loopHeaderId = createBlockId('loop_header');
          const loopBodyId = createBlockId('loop_body');
          const loopExitId = createBlockId('loop_exit');

          const headerBlock: CFGBasicBlock = {
            id: loopHeaderId,
            label: 'loop_header',
            instructions: [],
            terminator: {
              kind: 'branch_if',
              condition: {
                kind: 'binary_op',
                operator: 'GT',
                left: {
                  kind: 'identifier',
                  name: `${collectionAst.kind === 'identifier' ? collectionAst.name : 'collection'}.length`,
                },
                right: { kind: 'literal', valueType: 'number', value: 0 },
              },
              trueTarget: loopBodyId,
              falseTarget: loopExitId,
            },
            predecessors: [currentBlock.id],
            successors: [loopBodyId, loopExitId],
          };
          blocks[loopHeaderId] = headerBlock;

          const bodyBlock: CFGBasicBlock = {
            id: loopBodyId,
            label: 'loop_body',
            instructions: [],
            terminator: { kind: 'jump', target: loopHeaderId },
            predecessors: [loopHeaderId],
            successors: [loopHeaderId],
          };
          blocks[loopBodyId] = bodyBlock;

          const exitBlock: CFGBasicBlock = {
            id: loopExitId,
            label: 'loop_exit',
            instructions: [],
            terminator: { kind: 'return' },
            predecessors: [loopHeaderId],
            successors: [],
          };
          blocks[loopExitId] = exitBlock;

          currentBlock.terminator = { kind: 'jump', target: loopHeaderId };
          currentBlock.successors = [loopHeaderId];

          currentBlock = bodyBlock;
          if (node.children) {
            processNodes(node.children);
          }

          currentBlock = exitBlock;
        } else if (node.name === 'case') {
          const discriminantAst = parseExpressionToAST(
            node.expression || node.args,
          );
          const joinBlockId = createBlockId('join_case');
          const caseArms: { value: ExpressionNode; target: string }[] = [];
          const armBlockIds: string[] = [];

          if (node.children) {
            for (let idx = 0; idx < node.children.length; idx++) {
              const child = node.children[idx];
              if (!child || child.kind !== 'tag') continue;

              const armId = createBlockId(`case_arm_${idx}`);
              armBlockIds.push(armId);

              const armBlock: CFGBasicBlock = {
                id: armId,
                label: `case_${child.name}`,
                instructions: [],
                terminator: { kind: 'jump', target: joinBlockId },
                predecessors: [currentBlock.id],
                successors: [joinBlockId],
              };
              blocks[armId] = armBlock;

              const valAst = parseExpressionToAST(
                child.expression || child.args,
              );
              caseArms.push({ value: valAst, target: armId });

              const prevBlock = currentBlock;
              currentBlock = armBlock;
              if (child.children) {
                processNodes(child.children);
              }
              currentBlock = prevBlock;
            }
          }

          const defaultArmId = createBlockId('default');
          armBlockIds.push(defaultArmId);
          const defaultBlock: CFGBasicBlock = {
            id: defaultArmId,
            label: 'default',
            instructions: [],
            terminator: { kind: 'jump', target: joinBlockId },
            predecessors: [currentBlock.id],
            successors: [joinBlockId],
          };
          blocks[defaultArmId] = defaultBlock;

          const joinBlock: CFGBasicBlock = {
            id: joinBlockId,
            label: 'join_case',
            instructions: [],
            terminator: { kind: 'return' },
            predecessors: armBlockIds,
            successors: [],
          };
          blocks[joinBlockId] = joinBlock;

          currentBlock.terminator = {
            kind: 'switch',
            discriminant: discriminantAst,
            cases: caseArms,
            defaultTarget: defaultArmId,
          };
          currentBlock.successors = armBlockIds;

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
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) continue;
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
