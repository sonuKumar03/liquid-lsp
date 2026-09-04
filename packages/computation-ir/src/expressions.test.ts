import { describe, it, expect } from "vitest";
import {
  parseExpressionToAST,
  type BinaryExpressionNode,
  type FilterCallExpressionNode,
} from "./expressions.js";

describe("Typed Binary Expression Trees", () => {
  it("parses literal numbers into literal AST nodes", () => {
    const ast = parseExpressionToAST("42");
    expect(ast).toEqual({
      kind: "literal",
      valueType: "number",
      value: 42,
    });
  });

  it("parses literal strings into literal AST nodes", () => {
    const ast = parseExpressionToAST('"Hello World"');
    expect(ast).toEqual({
      kind: "literal",
      valueType: "string",
      value: "Hello World",
    });
  });

  it("parses identifiers into identifier AST nodes", () => {
    const ast = parseExpressionToAST("base_price");
    expect(ast).toEqual({
      kind: "identifier",
      name: "base_price",
    });
  });

  it("parses column references like self.unit_price", () => {
    const ast = parseExpressionToAST("self.unit_price");
    expect(ast).toEqual({
      kind: "column_ref",
      table: "self",
      column: "unit_price",
    });
  });

  it("parses math filter pipelines into binary expression trees", () => {
    // base_price | plus: tax | times: 1.05
    const ast = parseExpressionToAST("base_price", [
      { name: "plus", raw: "plus: tax", source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } } },
      { name: "times", raw: "times: 1.05", source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } } },
    ]);

    expect(ast.kind).toBe("binary_op");
    const root = ast as BinaryExpressionNode;
    expect(root.operator).toBe("MULTIPLY");
    expect(root.right).toEqual({ kind: "literal", valueType: "number", value: 1.05 });
    
    expect(root.left.kind).toBe("binary_op");
    const leftBinary = root.left as BinaryExpressionNode;
    expect(leftBinary.operator).toBe("ADD");
    expect(leftBinary.left).toEqual({ kind: "identifier", name: "base_price" });
    expect(leftBinary.right).toEqual({ kind: "identifier", name: "tax" });
  });

  it("parses custom filters as filter call nodes", () => {
    const ast = parseExpressionToAST("total_price", [
      { name: "toCurrency", raw: 'toCurrency: "USD"', source: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 } } },
    ]);

    expect(ast.kind).toBe("filter_call");
    const filterCall = ast as FilterCallExpressionNode;
    expect(filterCall.filterName).toBe("toCurrency");
    expect(filterCall.target).toEqual({ kind: "identifier", name: "total_price" });
    expect(filterCall.args).toEqual([{ kind: "literal", valueType: "string", value: "USD" }]);
  });

  describe("Compound Logical Expressions & Comparisons", () => {
    it("parses compound AND / OR condition: deal_size > 1000 and status == 'active'", () => {
      const ast = parseExpressionToAST('deal_size > 1000 and status == "active"');
      expect(ast.kind).toBe("binary_op");
      const root = ast as BinaryExpressionNode;
      expect(root.operator).toBe("AND");
      
      expect(root.left.kind).toBe("binary_op");
      const leftComparison = root.left as BinaryExpressionNode;
      expect(leftComparison.operator).toBe("GT");
      expect(leftComparison.left).toEqual({ kind: "identifier", name: "deal_size" });
      expect(leftComparison.right).toEqual({ kind: "literal", valueType: "number", value: 1000 });

      expect(root.right.kind).toBe("binary_op");
      const rightComparison = root.right as BinaryExpressionNode;
      expect(rightComparison.operator).toBe("EQ");
      expect(rightComparison.left).toEqual({ kind: "identifier", name: "status" });
      expect(rightComparison.right).toEqual({ kind: "literal", valueType: "string", value: "active" });
    });

    it("parses contains operator: tags contains 'VIP'", () => {
      const ast = parseExpressionToAST('tags contains "VIP"');
      expect(ast.kind).toBe("binary_op");
      const root = ast as BinaryExpressionNode;
      expect(root.operator).toBe("CONTAINS");
      expect(root.left).toEqual({ kind: "identifier", name: "tags" });
      expect(root.right).toEqual({ kind: "literal", valueType: "string", value: "VIP" });
    });

    it("parses unary not: not is_expired", () => {
      const ast = parseExpressionToAST("not is_expired");
      expect(ast.kind).toBe("unary_op");
      if (ast.kind === "unary_op") {
        expect(ast.operator).toBe("NOT");
        expect(ast.operand).toEqual({ kind: "identifier", name: "is_expired" });
      }
    });
  });
});
