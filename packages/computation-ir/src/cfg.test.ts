import { describe, it, expect } from "vitest";
import { buildControlFlowGraph, analyzeCFGReachability } from "./cfg.js";
import type { ComputationIRDocument } from "./index.js";

describe("Control Flow Graph (CFG)", () => {
  it("builds linear basic block for simple assignments", () => {
    const irDoc: ComputationIRDocument = {
      format: "computation-interchange",
      version: "1",
      language: "liquidjs-computation",
      source: "",
      nodes: [
        {
          kind: "tag",
          name: "assign",
          target: "subtotal",
          args: "subtotal = 100",
          expression: "100",
          expressionTokens: [],
          filters: [],
          dependencies: [],
          source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
          original: { dialect: "liquidjs-computation", kind: "tag", text: "" },
        },
        {
          kind: "tag",
          name: "assign",
          target: "tax",
          args: "tax = subtotal | times: 0.18",
          expression: "subtotal",
          expressionTokens: [],
          filters: [{ name: "times", raw: "times: 0.18", source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } } }],
          dependencies: ["subtotal"],
          source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
          original: { dialect: "liquidjs-computation", kind: "tag", text: "" },
        },
      ],
      errors: [],
    };

    const cfg = buildControlFlowGraph(irDoc);
    expect(cfg.entryBlockId).toBeDefined();
    const entryBlock = cfg.blocks[cfg.entryBlockId];
    expect(entryBlock).toBeDefined();
    expect(entryBlock?.instructions.length).toBe(2);
    expect(entryBlock?.instructions[0]?.kind).toBe("assign");
    expect(entryBlock?.instructions[1]?.kind).toBe("assign");
    expect(entryBlock?.terminator.kind).toBe("return");
  });

  it("splits conditional if tags into then, else, and join blocks", () => {
    const irDoc: ComputationIRDocument = {
      format: "computation-interchange",
      version: "1",
      language: "liquidjs-computation",
      source: "",
      nodes: [
        {
          kind: "tag",
          name: "if",
          args: "deal_size > 1000",
          expression: "deal_size > 1000",
          expressionTokens: [],
          filters: [],
          dependencies: ["deal_size"],
          children: [
            {
              kind: "tag",
              name: "assign",
              target: "discount",
              args: "discount = 0.20",
              expression: "0.20",
              expressionTokens: [],
              filters: [],
              dependencies: [],
              source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
              original: { dialect: "liquidjs-computation", kind: "tag", text: "" },
            },
          ],
          source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
          original: { dialect: "liquidjs-computation", kind: "tag", text: "" },
        },
        {
          kind: "output",
          expression: "discount",
          expressionTokens: [],
          filters: [],
          dependencies: ["discount"],
          source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
          original: { dialect: "liquidjs-computation", kind: "output", text: "" },
        },
      ],
      errors: [],
    };

    const cfg = buildControlFlowGraph(irDoc);
    expect(Object.keys(cfg.blocks).length).toBe(4); // entry, then, else, join

    const entry = cfg.blocks[cfg.entryBlockId]!;
    expect(entry.terminator.kind).toBe("branch_if");
    expect(entry.successors.length).toBe(2);

    const { reachableBlockIds, unreachableBlockIds } = analyzeCFGReachability(cfg);
    expect(reachableBlockIds.length).toBe(4);
    expect(unreachableBlockIds.length).toBe(0);
  });
});
