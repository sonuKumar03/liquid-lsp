import { describe, it, expect } from 'vitest';
import { buildControlFlowGraph, analyzeCFGReachability } from './cfg.js';
import type { ComputationIRDocument } from './index.js';

describe('Control Flow Graph (CFG)', () => {
  it('builds linear basic block for simple assignments', () => {
    const irDoc: ComputationIRDocument = {
      format: 'computation-interchange',
      version: '1',
      language: 'liquidjs-computation',
      source: '',
      nodes: [
        {
          kind: 'tag',
          name: 'assign',
          target: 'subtotal',
          args: 'subtotal = 100',
          expression: '100',
          expressionTokens: [],
          filters: [],
          dependencies: [],
          source: {
            start: { offset: 0, line: 0, column: 0 },
            end: { offset: 0, line: 0, column: 0 },
          },
          original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
        },
        {
          kind: 'tag',
          name: 'assign',
          target: 'tax',
          args: 'tax = subtotal | times: 0.18',
          expression: 'subtotal',
          expressionTokens: [],
          filters: [
            {
              name: 'times',
              raw: 'times: 0.18',
              source: {
                start: { offset: 0, line: 0, column: 0 },
                end: { offset: 0, line: 0, column: 0 },
              },
            },
          ],
          dependencies: ['subtotal'],
          source: {
            start: { offset: 0, line: 0, column: 0 },
            end: { offset: 0, line: 0, column: 0 },
          },
          original: { dialect: 'liquidjs-computation', kind: 'tag', text: '' },
        },
      ],
      errors: [],
    };

    const cfg = buildControlFlowGraph(irDoc);
    expect(cfg.entryBlockId).toBeDefined();
    const entryBlock = cfg.blocks[cfg.entryBlockId];
    expect(entryBlock).toBeDefined();
    expect(entryBlock?.instructions.length).toBe(2);
    expect(entryBlock?.instructions[0]?.kind).toBe('assign');
    expect(entryBlock?.instructions[1]?.kind).toBe('assign');
    expect(entryBlock?.terminator.kind).toBe('return');
  });

  it('splits conditional if tags into then, else, and join blocks', () => {
    const irDoc: ComputationIRDocument = {
      format: 'computation-interchange',
      version: '1',
      language: 'liquidjs-computation',
      source: '',
      nodes: [
        {
          kind: 'tag',
          name: 'if',
          args: 'deal_size > 1000',
          expression: 'deal_size > 1000',
          expressionTokens: [],
          filters: [],
          dependencies: ['deal_size'],
          children: [
            {
              kind: 'tag',
              name: 'assign',
              target: 'discount',
              args: 'discount = 0.20',
              expression: '0.20',
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
        {
          kind: 'output',
          expression: 'discount',
          expressionTokens: [],
          filters: [],
          dependencies: ['discount'],
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

    const cfg = buildControlFlowGraph(irDoc);
    expect(Object.keys(cfg.blocks).length).toBe(4); // entry, then, else, join

    const entry = cfg.blocks[cfg.entryBlockId]!;
    expect(entry.terminator.kind).toBe('branch_if');
    expect(entry.successors.length).toBe(2);

    const { reachableBlockIds, unreachableBlockIds } =
      analyzeCFGReachability(cfg);
    expect(reachableBlockIds.length).toBe(4);
    expect(unreachableBlockIds.length).toBe(0);

    // Verify Phi node generation at join block
    const joinBlock = Object.values(cfg.blocks).find((b) => b.label === 'join');
    expect(joinBlock).toBeDefined();
    const phiInstruction = joinBlock?.instructions.find(
      (i) => i.kind === 'phi',
    );
    expect(phiInstruction).toBeDefined();
    if (phiInstruction && phiInstruction.kind === 'phi') {
      expect(phiInstruction.target).toBe('discount');
    }
  });

  it('builds multi-way switch CFG for case / when tags', () => {
    const irDoc: ComputationIRDocument = {
      format: 'computation-interchange',
      version: '1',
      language: 'liquidjs-computation',
      source: '',
      nodes: [
        {
          kind: 'tag',
          name: 'case',
          args: 'tier',
          expression: 'tier',
          expressionTokens: [],
          filters: [],
          dependencies: ['tier'],
          children: [
            {
              kind: 'tag',
              name: 'when',
              args: '1',
              expression: '1',
              expressionTokens: [],
              filters: [],
              dependencies: [],
              children: [
                {
                  kind: 'tag',
                  name: 'assign',
                  target: 'rate',
                  args: 'rate = 0.1',
                  expression: '0.1',
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
              args: '2',
              expression: '2',
              expressionTokens: [],
              filters: [],
              dependencies: [],
              children: [
                {
                  kind: 'tag',
                  name: 'assign',
                  target: 'rate',
                  args: 'rate = 0.2',
                  expression: '0.2',
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

    const cfg = buildControlFlowGraph(irDoc);
    const entry = cfg.blocks[cfg.entryBlockId]!;
    expect(entry.terminator.kind).toBe('switch');
    if (entry.terminator.kind === 'switch') {
      expect(entry.terminator.cases.length).toBe(2);
    }
    const { reachableBlockIds } = analyzeCFGReachability(cfg);
    expect(reachableBlockIds.length).toBeGreaterThan(3);
  });

  it('correctly partitions children into then and else blocks with bidirectional Phi nodes', () => {
    const irDoc: ComputationIRDocument = {
      format: 'computation-interchange',
      version: '1',
      language: 'liquidjs-computation',
      source: '',
      nodes: [
        {
          kind: 'tag',
          name: 'if',
          args: 'tier == "vip"',
          expression: 'tier == "vip"',
          expressionTokens: [],
          filters: [],
          dependencies: ['tier'],
          children: [
            {
              kind: 'tag',
              name: 'assign',
              target: 'rate',
              args: 'rate = 50',
              expression: '50',
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
            {
              kind: 'tag',
              name: 'else',
              args: '',
              expression: '',
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
            {
              kind: 'tag',
              name: 'assign',
              target: 'rate',
              args: 'rate = 10',
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

    const cfg = buildControlFlowGraph(irDoc);
    const allBlocks = Object.values(cfg.blocks);

    const thenBlock = allBlocks.find((b) => b.label === 'then');
    expect(thenBlock).toBeDefined();
    expect(thenBlock?.instructions).toHaveLength(1);
    expect((thenBlock?.instructions[0] as any).target).toBe('rate');
    expect((thenBlock?.instructions[0] as any).expression.value).toBe(50);

    const elseBlock = allBlocks.find((b) => b.label === 'else');
    expect(elseBlock).toBeDefined();
    expect(elseBlock?.instructions).toHaveLength(1);
    expect((elseBlock?.instructions[0] as any).target).toBe('rate');
    expect((elseBlock?.instructions[0] as any).expression.value).toBe(10);

    const joinBlock = allBlocks.find((b) => b.label === 'join');
    expect(joinBlock).toBeDefined();
    const phi = joinBlock?.instructions.find((i) => i.kind === 'phi') as any;
    expect(phi).toBeDefined();
    expect(phi.target).toBe('rate');
    expect(phi.incoming[thenBlock!.id]?.value).toBe(50);
    expect(phi.incoming[elseBlock!.id]?.value).toBe(10);
  });
});
