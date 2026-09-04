import { describe, it, expect } from 'vitest';
import {
  optimizeComputationIR,
  optimizeCFG,
  pruneUnreachableBlocks,
} from './optimizer.js';
import { buildControlFlowGraph } from './cfg.js';
import type { ComputationIRDocument } from './index.js';

describe('Computation IR Document & CFG Optimizer', () => {
  it('prunes detached unreachable blocks and updates predecessors directly', () => {
    const doc: ComputationIRDocument = {
      format: 'computation-interchange',
      version: '1',
      language: 'liquidjs-computation',
      source: '',
      nodes: [
        {
          kind: 'tag',
          name: 'assign',
          target: 'x',
          args: 'x = 10',
          expression: '10',
          expressionTokens: [],
          filters: [],
          dependencies: [],
          source: {
            start: { offset: 0, line: 0, column: 0 },
            end: { offset: 0, line: 0, column: 0 },
          },
          original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
        },
      ],
      errors: [],
    };

    const cfg = buildControlFlowGraph(doc);
    // Add a detached dummy block
    cfg.blocks['detached_block'] = {
      id: 'detached_block',
      instructions: [],
      terminator: { kind: 'return' },
      predecessors: [],
      successors: [],
    };

    const pruned = pruneUnreachableBlocks(cfg);
    expect(pruned.blocks['detached_block']).toBeUndefined();
    expect(pruned.blocks[cfg.entryBlockId]).toBeDefined();
  });
  it('folds constant expressions across document nodes', () => {
    const doc: ComputationIRDocument = {
      format: 'computation-interchange',
      version: '1',
      language: 'liquidjs-computation',
      source: '',
      nodes: [
        {
          kind: 'tag',
          name: 'assign',
          target: 'tax_rate',
          args: 'tax_rate = 18 | divided_by: 100',
          expression: '18',
          expressionTokens: [],
          filters: [
            {
              name: 'divided_by',
              raw: 'divided_by: 100',
              source: {
                start: { offset: 0, line: 0, column: 0 },
                end: { offset: 0, line: 0, column: 0 },
              },
            },
          ],
          dependencies: [],
          source: {
            start: { offset: 0, line: 0, column: 0 },
            end: { offset: 0, line: 0, column: 0 },
          },
          original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
        },
      ],
      errors: [],
    };

    const optimized = optimizeComputationIR(doc);
    expect(optimized.nodes[0]?.kind).toBe('tag');
    const tagNode = optimized.nodes[0] as any;
    expect(tagNode.expression).toBe('0.18');
    expect(tagNode.filters).toHaveLength(0);
  });

  it('prevents double-application of filters when re-optimizing or re-parsing folded expressions', () => {
    const doc: ComputationIRDocument = {
      format: 'computation-interchange',
      version: '1',
      language: 'liquidjs-computation',
      source: '',
      nodes: [
        {
          kind: 'output',
          expression: '18',
          expressionTokens: [],
          filters: [
            {
              name: 'divided_by',
              raw: 'divided_by: 100',
              source: {
                start: { offset: 0, line: 0, column: 0 },
                end: { offset: 0, line: 0, column: 0 },
              },
            },
          ],
          dependencies: [],
          source: {
            start: { offset: 0, line: 0, column: 0 },
            end: { offset: 0, line: 0, column: 0 },
          },
          original: {
            dialect: 'liquidjs-computation',
            kind: 'output',
            text: '',
          },
        },
      ],
      errors: [],
    };

    const firstPass = optimizeComputationIR(doc);
    const outputNode = firstPass.nodes[0] as any;
    expect(outputNode.expression).toBe('0.18');
    expect(outputNode.filters).toHaveLength(0);

    // Re-optimizing must remain 0.18 and never become 0.0018
    const secondPass = optimizeComputationIR(firstPass);
    const reoptimizedOutput = secondPass.nodes[0] as any;
    expect(reoptimizedOutput.expression).toBe('0.18');
    expect(reoptimizedOutput.filters).toHaveLength(0);
  });

  it('prunes statically false conditional branches in AST', () => {
    const doc: ComputationIRDocument = {
      format: 'computation-interchange',
      version: '1',
      language: 'liquidjs-computation',
      source: '',
      nodes: [
        {
          kind: 'tag',
          name: 'if',
          args: 'false',
          expression: 'false',
          expressionTokens: [],
          filters: [],
          dependencies: [],
          children: [
            {
              kind: 'tag',
              name: 'assign',
              target: 'dead_var',
              args: 'dead_var = 123',
              expression: '123',
              expressionTokens: [],
              filters: [],
              dependencies: [],
              source: {
                start: { offset: 0, line: 0, column: 0 },
                end: { offset: 0, line: 0, column: 0 },
              },
              original: {
                dialect: 'liquidjs-computation',
                kind: 'tag',
                text: '',
              },
            },
          ],
          source: {
            start: { offset: 0, line: 0, column: 0 },
            end: { offset: 0, line: 0, column: 0 },
          },
          original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
        },
      ],
      errors: [],
    };

    const optimized = optimizeComputationIR(doc);
    expect(optimized.nodes).toHaveLength(0);
  });

  it('inlines statically true conditional branches in AST', () => {
    const doc: ComputationIRDocument = {
      format: 'computation-interchange',
      version: '1',
      language: 'liquidjs-computation',
      source: '',
      nodes: [
        {
          kind: 'tag',
          name: 'if',
          args: '10 > 5',
          expression: '10 > 5',
          expressionTokens: [],
          filters: [],
          dependencies: [],
          children: [
            {
              kind: 'tag',
              name: 'assign',
              target: 'active_var',
              args: 'active_var = 999',
              expression: '999',
              expressionTokens: [],
              filters: [],
              dependencies: [],
              source: {
                start: { offset: 0, line: 0, column: 0 },
                end: { offset: 0, line: 0, column: 0 },
              },
              original: {
                dialect: 'liquidjs-computation',
                kind: 'tag',
                text: '',
              },
            },
          ],
          source: {
            start: { offset: 0, line: 0, column: 0 },
            end: { offset: 0, line: 0, column: 0 },
          },
          original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
        },
      ],
      errors: [],
    };

    const optimized = optimizeComputationIR(doc);
    expect(optimized.nodes).toHaveLength(1);
    expect((optimized.nodes[0] as any).target).toBe('active_var');
  });

  it('optimizes CFG: evaluates constant branch_if, jumps to true block, prunes dead else block', () => {
    const doc: ComputationIRDocument = {
      format: 'computation-interchange',
      version: '1',
      language: 'liquidjs-computation',
      source: '',
      nodes: [
        {
          kind: 'tag',
          name: 'if',
          args: '5 > 2',
          expression: '5 > 2',
          expressionTokens: [],
          filters: [],
          dependencies: [],
          children: [
            {
              kind: 'tag',
              name: 'assign',
              target: 'discount',
              args: 'discount = 10',
              expression: '10',
              expressionTokens: [],
              filters: [],
              dependencies: [],
              source: {
                start: { offset: 0, line: 0, column: 0 },
                end: { offset: 0, line: 0, column: 0 },
              },
              original: {
                dialect: 'liquidjs-computation',
                kind: 'tag',
                text: '',
              },
            },
          ],
          source: {
            start: { offset: 0, line: 0, column: 0 },
            end: { offset: 0, line: 0, column: 0 },
          },
          original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
        },
      ],
      errors: [],
    };

    const cfg = buildControlFlowGraph(doc);
    const optimizedCFG = optimizeCFG(cfg);

    // Entry block should jump directly to 'then'
    const entryBlock = optimizedCFG.blocks[optimizedCFG.entryBlockId];
    expect(entryBlock?.terminator.kind).toBe('jump');

    // The 'else' block should be pruned completely
    const allBlockIds = Object.keys(optimizedCFG.blocks);
    const hasElse = allBlockIds.some((id) => id.startsWith('else'));
    expect(hasElse).toBe(false);

    // Phi node in join block should be simplified into direct assign because only 'then' is reachable
    const joinBlockId = allBlockIds.find((id) => id.startsWith('join'));
    expect(joinBlockId).toBeDefined();
    const joinBlock = optimizedCFG.blocks[joinBlockId!];
    const assignInst = joinBlock?.instructions.find((i) => i.kind === 'assign');
    expect(assignInst).toBeDefined();
    expect((assignInst as any)?.target).toBe('discount');
  });

  it('optimizes CFG: evaluates constant switch discriminant and jumps to matching case arm', () => {
    const doc: ComputationIRDocument = {
      format: 'computation-interchange',
      version: '1',
      language: 'liquidjs-computation',
      source: '',
      nodes: [
        {
          kind: 'tag',
          name: 'case',
          args: "'premium'",
          expression: "'premium'",
          expressionTokens: [],
          filters: [],
          dependencies: [],
          children: [
            {
              kind: 'tag',
              name: 'when',
              args: "'standard'",
              expression: "'standard'",
              expressionTokens: [],
              filters: [],
              dependencies: [],
              children: [
                {
                  kind: 'tag',
                  name: 'assign',
                  target: 'tier_rate',
                  args: 'tier_rate = 5',
                  expression: '5',
                  expressionTokens: [],
                  filters: [],
                  dependencies: [],
                  source: {
                    start: { offset: 0, line: 0, column: 0 },
                    end: { offset: 0, line: 0, column: 0 },
                  },
                  original: {
                    dialect: 'liquidjs-computation',
                    kind: 'tag',
                    text: '',
                  },
                },
              ],
              source: {
                start: { offset: 0, line: 0, column: 0 },
                end: { offset: 0, line: 0, column: 0 },
              },
              original: {
                dialect: 'liquidjs-computation',
                kind: 'tag',
                text: '',
              },
            },
            {
              kind: 'tag',
              name: 'when',
              args: "'premium'",
              expression: "'premium'",
              expressionTokens: [],
              filters: [],
              dependencies: [],
              children: [
                {
                  kind: 'tag',
                  name: 'assign',
                  target: 'tier_rate',
                  args: 'tier_rate = 15',
                  expression: '15',
                  expressionTokens: [],
                  filters: [],
                  dependencies: [],
                  source: {
                    start: { offset: 0, line: 0, column: 0 },
                    end: { offset: 0, line: 0, column: 0 },
                  },
                  original: {
                    dialect: 'liquidjs-computation',
                    kind: 'tag',
                    text: '',
                  },
                },
              ],
              source: {
                start: { offset: 0, line: 0, column: 0 },
                end: { offset: 0, line: 0, column: 0 },
              },
              original: {
                dialect: 'liquidjs-computation',
                kind: 'tag',
                text: '',
              },
            },
          ],
          source: {
            start: { offset: 0, line: 0, column: 0 },
            end: { offset: 0, line: 0, column: 0 },
          },
          original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
        },
      ],
      errors: [],
    };

    const cfg = buildControlFlowGraph(doc);
    const optimizedCFG = optimizeCFG(cfg);

    const entryBlock = optimizedCFG.blocks[optimizedCFG.entryBlockId];
    expect(entryBlock?.terminator.kind).toBe('jump');

    // Case arm 0 (standard) and default arm should be pruned
    const allBlockIds = Object.keys(optimizedCFG.blocks);
    const hasStandardArm = allBlockIds.some((id) => id.includes('case_arm_0'));
    const hasDefaultArm = allBlockIds.some((id) => id.includes('default'));
    expect(hasStandardArm).toBe(false);
    expect(hasDefaultArm).toBe(false);

    // Case arm 1 (premium) should be kept
    const hasPremiumArm = allBlockIds.some((id) => id.includes('case_arm_1'));
    expect(hasPremiumArm).toBe(true);
  });
});
