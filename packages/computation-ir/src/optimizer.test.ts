import { describe, it, expect } from "vitest";
import { optimizeComputationIR } from "./optimizer.js";
import type { ComputationIRDocument } from "./index.js";

describe("Computation IR Document Optimizer", () => {
  it("folds constant expressions across document nodes", () => {
    const doc: ComputationIRDocument = {
      format: "computation-interchange",
      version: "1",
      language: "liquidjs-computation",
      source: "",
      nodes: [
        {
          kind: "tag",
          name: "assign",
          target: "tax_rate",
          args: "tax_rate = 18 | divided_by: 100",
          expression: "18",
          expressionTokens: [],
          filters: [
            {
              name: "divided_by",
              raw: "divided_by: 100",
              source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
            },
          ],
          dependencies: [],
          source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } },
          original: { dialect: "liquidjs-computation", kind: "tag", text: "" },
        },
      ],
      errors: [],
    };

    const optimized = optimizeComputationIR(doc);
    expect(optimized.nodes[0]?.kind).toBe("tag");
    const tagNode = optimized.nodes[0] as any;
    expect(tagNode.expression).toBe("0.18");
  });
});
