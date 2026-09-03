import type { ComputationIRFilter } from "./index.js";

export type BinaryOperator =
  | "ADD"
  | "SUBTRACT"
  | "MULTIPLY"
  | "DIVIDE"
  | "MODULO"
  | "CONCAT"
  | "EQ"
  | "NEQ"
  | "GT"
  | "GTE"
  | "LT"
  | "LTE"
  | "AND"
  | "OR";

export type UnaryOperator = "NEGATE" | "NOT";

export interface LiteralExpressionNode {
  kind: "literal";
  valueType: "string" | "number" | "boolean" | "null";
  value: string | number | boolean | null;
}

export interface IdentifierExpressionNode {
  kind: "identifier";
  name: string;
}

export interface ColumnRefExpressionNode {
  kind: "column_ref";
  table: string;
  column: string;
}

export interface BinaryExpressionNode {
  kind: "binary_op";
  operator: BinaryOperator;
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface UnaryExpressionNode {
  kind: "unary_op";
  operator: UnaryOperator;
  operand: ExpressionNode;
}

export interface FilterCallExpressionNode {
  kind: "filter_call";
  filterName: string;
  target: ExpressionNode;
  args: ExpressionNode[];
}

export type ExpressionNode =
  | LiteralExpressionNode
  | IdentifierExpressionNode
  | ColumnRefExpressionNode
  | BinaryExpressionNode
  | UnaryExpressionNode
  | FilterCallExpressionNode;

const MATH_FILTER_MAP: Record<string, BinaryOperator> = {
  plus: "ADD",
  minus: "SUBTRACT",
  times: "MULTIPLY",
  divided_by: "DIVIDE",
  modulo: "MODULO",
  append: "CONCAT",
};

/**
 * Parses a simple atom (literal, column reference, or identifier).
 */
export function parseExpressionAtom(raw: string): ExpressionNode {
  const trimmed = raw.trim();
  if (trimmed === "true") return { kind: "literal", valueType: "boolean", value: true };
  if (trimmed === "false") return { kind: "literal", valueType: "boolean", value: false };
  if (trimmed === "nil" || trimmed === "null") return { kind: "literal", valueType: "null", value: null };

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: "literal", valueType: "number", value: parseFloat(trimmed) };
  }

  if (/^"([^"\\]|\\.)*"$/.test(trimmed) || /^'([^'\\]|\\.)*'$/.test(trimmed)) {
    return { kind: "literal", valueType: "string", value: trimmed.slice(1, -1) };
  }

  if (trimmed.includes(".")) {
    const parts = trimmed.split(".");
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { kind: "column_ref", table: parts[0], column: parts[1] };
    }
  }

  return { kind: "identifier", name: trimmed };
}

/**
 * Transforms a raw Liquid expression and its filter pipeline into a Typed Expression AST.
 */
export function parseExpressionToAST(
  rawExpression: string,
  filters?: ComputationIRFilter[],
): ExpressionNode {
  let root: ExpressionNode = parseExpressionAtom(rawExpression);

  if (!filters || filters.length === 0) {
    return root;
  }

  for (const filter of filters) {
    const binaryOp = MATH_FILTER_MAP[filter.name];
    const colonIdx = filter.raw.indexOf(":");
    const rawArg = colonIdx !== -1 ? filter.raw.slice(colonIdx + 1).trim() : "";

    if (binaryOp && rawArg) {
      const rightNode = parseExpressionAtom(rawArg);
      root = {
        kind: "binary_op",
        operator: binaryOp,
        left: root,
        right: rightNode,
      };
    } else {
      const args: ExpressionNode[] = rawArg
        ? rawArg.split(",").map((a) => parseExpressionAtom(a.trim()))
        : [];

      root = {
        kind: "filter_call",
        filterName: filter.name,
        target: root,
        args,
      };
    }
  }

  return root;
}
