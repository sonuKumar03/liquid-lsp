/**
 * Strict Types and AST Definitions for the Specter / Computation Library Lowering Pipeline.
 *
 * Implements a closed, typed expression program with canonical operator enums,
 * free vs. local variable tracking, structured domain literals, and fail-closed semantics.
 */

export type SpecterType =
  | "NUMBER"
  | "TEXT"
  | "CHECKBOX"
  | "CURRENCY"
  | "DURATION"
  | "DATE"
  | "ARRAY"
  | "UNKNOWN";

/**
 * Canonical operator enums table-mappable to Specter functions.
 */
export type SpecterOp =
  | "Add"
  | "Subtract"
  | "Multiply"
  | "Divide"
  | "Modulo"
  | "Equals"
  | "NotEquals"
  | "GreaterThan"
  | "GreaterThanOrEqual"
  | "LessThan"
  | "LessThanOrEqual"
  | "And"
  | "Or"
  | "Not"
  | "Negate"
  | "Concat"
  | "Contains"
  | "Exists"
  | "If"
  | "Sum"
  | "GetColumn"
  | "toCurrency"
  | "toDuration"
  | "GetDurationInDays"
  | "updateAttribute"
  | "updateTypeAttribute"
  | "uniq"
  | "strip_html"
  | "strip";

// ─── 1. Structured Domain Literals ──────────────────────────────────────────

export interface SpecterCurrencyLiteral {
  kind: "currency_literal";
  valueType: "CURRENCY";
  value: number;
  currency: string;
}

export interface SpecterDurationLiteral {
  kind: "duration_literal";
  valueType: "DURATION";
  value: number;
  unit: string;
  days?: number | undefined;
}

export interface SpecterPrimitiveLiteral {
  kind: "literal";
  valueType: SpecterType;
  value: string | number | boolean | null | Record<string, unknown> | unknown[];
}

export type SpecterLit =
  | SpecterPrimitiveLiteral
  | SpecterCurrencyLiteral
  | SpecterDurationLiteral;

// ─── 2. Expression Nodes ────────────────────────────────────────────────────

export interface SpecterVar {
  kind: "var";
  name: string;
  /** True if this is an intermediate local calculation variable (t, __left, etc.) */
  isLocal: boolean;
  inferredType: SpecterType;
}

export interface SpecterBinOp {
  kind: "bin_op";
  op: SpecterOp;
  left: SpecterExpr;
  right: SpecterExpr;
  inferredType: SpecterType;
}

export interface SpecterUnOp {
  kind: "un_op";
  op: SpecterOp;
  operand: SpecterExpr;
  inferredType: SpecterType;
}

export interface SpecterFilter {
  kind: "filter";
  op: SpecterOp;
  target: SpecterExpr;
  args: SpecterExpr[];
  inferredType: SpecterType;
}

export interface SpecterIfExpr {
  kind: "if_expr";
  condition: SpecterExpr;
  thenExpr: SpecterExpr;
  elseExpr: SpecterExpr;
  inferredType: SpecterType;
}

export interface SpecterUnsupported {
  kind: "unsupported";
  reason: string;
  src?: string | undefined;
  inferredType: "UNKNOWN";
}

export type SpecterExpr =
  | SpecterLit
  | SpecterVar
  | SpecterBinOp
  | SpecterUnOp
  | SpecterFilter
  | SpecterIfExpr
  | SpecterUnsupported;

// ─── 3. Statements (For inlining away) ───────────────────────────────────────

export interface SpecterAssignStmt {
  kind: "assign";
  target: string;
  value: SpecterExpr;
  isLocal: boolean;
}

export interface SpecterParseAssignStmt {
  kind: "parse_assign";
  target: string;
  value: SpecterExpr;
  isLocal: boolean;
}

export interface SpecterIfStmt {
  kind: "if_stmt";
  condition: SpecterExpr;
  thenBranch: SpecterStmt[];
  otherwiseBranch: SpecterStmt[];
}

export interface SpecterOutputStmt {
  kind: "output";
  value: SpecterExpr;
}

export interface SpecterUnsupportedStmt {
  kind: "unsupported_stmt";
  reason: string;
  src?: string | undefined;
}

export type SpecterStmt =
  | SpecterAssignStmt
  | SpecterParseAssignStmt
  | SpecterIfStmt
  | SpecterOutputStmt
  | SpecterUnsupportedStmt;

export interface SpecterProgram {
  kind: "specter_program";
  statements: SpecterStmt[];
  /** Expected computation root variable name (e.g. "$$answer" or "sd_cb_result") */
  resultVar?: string | undefined;
}
