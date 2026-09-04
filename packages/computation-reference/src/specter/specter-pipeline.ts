import type {
  ComputationIRDocument,
  ComputationIRNode,
  ComputationIRTagNode,
} from "computation-ir";
import {
  parseExpressionToAST,
  type ExpressionNode,
} from "computation-ir";
import type {
  SpecterAssignStmt,
  SpecterExpr,
  SpecterLit,
  SpecterOp,
  SpecterParseAssignStmt,
  SpecterProgram,
  SpecterStmt,
  SpecterType,
  SpecterVar,
} from "./specter-types.js";

// ─── 1. Inferred Type Resolver ──────────────────────────────────────────────

export type SchemaTypeMap = Record<
  string,
  SpecterType | { type: string; currency?: string }
>;

export function resolveVariableType(
  name: string,
  schema?: SchemaTypeMap,
): SpecterType {
  if (!schema) return "UNKNOWN";
  const entry = schema[name];
  if (!entry) return "UNKNOWN";
  if (typeof entry === "string") return entry;
  const t = entry.type?.toLowerCase();
  switch (t) {
    case "number":
      return "NUMBER";
    case "currency":
      return "CURRENCY";
    case "duration":
      return "DURATION";
    case "date":
      return "DATE";
    case "dropdown":
    case "string":
    case "text":
      return "TEXT";
    case "checkbox":
    case "boolean":
      return "CHECKBOX";
    case "repeating":
    case "table":
    case "array":
      return "ARRAY";
    default:
      return "UNKNOWN";
  }
}

// ─── 2. Canonical Operator Mapping ──────────────────────────────────────────

const CANONICAL_FILTER_MAP: Record<string, SpecterOp> = {
  plus: "Add",
  add: "Add",
  minus: "Subtract",
  subtract: "Subtract",
  times: "Multiply",
  multiply: "Multiply",
  divided_by: "Divide",
  divide: "Divide",
  modulo: "Modulo",
  toCurrency: "toCurrency",
  toDuration: "toDuration",
  sumArray: "Sum",
  updateAttribute: "updateAttribute",
  updateTypeAttribute: "updateTypeAttribute",
  uniq: "uniq",
  strip_html: "strip_html",
  strip: "strip",
  append: "Concat",
};

const BINARY_OP_MAP: Record<string, SpecterOp> = {
  ADD: "Add",
  SUBTRACT: "Subtract",
  MULTIPLY: "Multiply",
  DIVIDE: "Divide",
  MODULO: "Modulo",
  CONCAT: "Concat",
  EQ: "Equals",
  NEQ: "NotEquals",
  LT: "LessThan",
  LTE: "LessThanOrEqual",
  GT: "GreaterThan",
  GTE: "GreaterThanOrEqual",
  AND: "And",
  OR: "Or",
  CONTAINS: "Contains",
};

// ─── 3. AST Expression Lowering ─────────────────────────────────────────────

export function lowerASTExpression(
  ast: ExpressionNode,
  schema?: SchemaTypeMap,
  localNames?: Set<string>,
): SpecterExpr {
  switch (ast.kind) {
    case "literal": {
      if (ast.value === null) {
        return { kind: "literal", valueType: "UNKNOWN", value: null };
      }
      if (typeof ast.value === "number") {
        return { kind: "literal", valueType: "NUMBER", value: ast.value };
      }
      if (typeof ast.value === "boolean") {
        return { kind: "literal", valueType: "CHECKBOX", value: ast.value };
      }
      if (typeof ast.value === "string") {
        return { kind: "literal", valueType: "TEXT", value: ast.value };
      }
      return { kind: "literal", valueType: "UNKNOWN", value: ast.value };
    }

    case "identifier": {
      const isLocal = localNames ? localNames.has(ast.name) : isDefaultLocalName(ast.name);
      return {
        kind: "var",
        name: ast.name,
        isLocal,
        inferredType: resolveVariableType(ast.name, schema),
      };
    }

    case "column_ref": {
      return {
        kind: "filter",
        op: "GetColumn",
        target: {
          kind: "var",
          name: ast.table,
          isLocal: localNames ? localNames.has(ast.table) : false,
          inferredType: "ARRAY",
        },
        args: [{ kind: "literal", valueType: "TEXT", value: ast.column }],
        inferredType: resolveVariableType(ast.column, schema),
      };
    }

    case "unary_op": {
      const op: SpecterOp = ast.operator === "NOT" ? "Not" : "Negate";
      const operand = lowerASTExpression(ast.operand, schema, localNames);
      return {
        kind: "un_op",
        op,
        operand,
        inferredType: op === "Not" ? "CHECKBOX" : "NUMBER",
      };
    }

    case "binary_op": {
      const op = BINARY_OP_MAP[ast.operator];
      if (!op) {
        return {
          kind: "unsupported",
          reason: "Unsupported binary operator: " + ast.operator,
          inferredType: "UNKNOWN",
        };
      }
      const left = lowerASTExpression(ast.left, schema, localNames);
      const right = lowerASTExpression(ast.right, schema, localNames);
      let inferredType: SpecterType = "NUMBER";
      if (
        op === "Equals" ||
        op === "NotEquals" ||
        op === "LessThan" ||
        op === "LessThanOrEqual" ||
        op === "GreaterThan" ||
        op === "GreaterThanOrEqual" ||
        op === "And" ||
        op === "Or" ||
        op === "Contains"
      ) {
        inferredType = "CHECKBOX";
      } else if (op === "Concat") {
        inferredType = "TEXT";
      }
      return {
        kind: "bin_op",
        op,
        left,
        right,
        inferredType,
      };
    }

    case "filter_call": {
      const op = CANONICAL_FILTER_MAP[ast.filterName];
      if (!op) {
        return {
          kind: "unsupported",
          reason: "Unknown filter: " + ast.filterName,
          inferredType: "UNKNOWN",
        };
      }
      const target = lowerASTExpression(ast.target, schema, localNames);
      const args = ast.args.map((a) => lowerASTExpression(a, schema, localNames));

      if (op === "Sum") {
        if (args.length === 1 && args[0]?.kind === "literal" && typeof args[0].value === "string") {
          return {
            kind: "filter",
            op: "Sum",
            target: {
              kind: "filter",
              op: "GetColumn",
              target,
              args: [args[0]],
              inferredType: "ARRAY",
            },
            args: [],
            inferredType: "NUMBER",
          };
        }
      }

      let inferredType: SpecterType = "NUMBER";
      if (op === "toCurrency") inferredType = "CURRENCY";
      else if (op === "toDuration") inferredType = "DURATION";
      else if (op === "strip" || op === "strip_html") inferredType = "TEXT";
      else if (op === "uniq") inferredType = "ARRAY";

      return {
        kind: "filter",
        op,
        target,
        args,
        inferredType,
      };
    }
  }
}

export function isDefaultLocalName(name: string): boolean {
  return (
    name.startsWith("__") ||
    name.startsWith("sd_cb_literal_") ||
    name === "t" ||
    name === "temp" ||
    name === "item" ||
    name === "self"
  );
}

// ─── 4. Program Lowering from Computation IR Document ───────────────────────

export function programFromIR(
  document: ComputationIRDocument,
  schema?: SchemaTypeMap,
  targetResultVar: string = "$$answer",
): SpecterProgram {
  const localNames = new Set<string>();
  const declaredVars = new Set<string>();

  function collectDeclaredVariables(nodes: ComputationIRNode[]): void {
    for (const node of nodes) {
      if (node.kind === "tag") {
        if (
          node.name === "assign" ||
          node.name === "assignVar" ||
          node.name === "parseAssign"
        ) {
          const name =
            node.target ??
            (node.args.includes("=")
              ? node.args.split("=")[0]?.trim()
              : undefined);
          if (name) {
            declaredVars.add(name);
            if (name !== targetResultVar && name !== "sd_cb_result") {
              localNames.add(name);
            }
          }
        }
        if (node.children) {
          collectDeclaredVariables(node.children);
        }
      }
    }
  }
  collectDeclaredVariables(document.nodes);

  function lowerNode(node: ComputationIRNode): SpecterStmt[] {
    if (node.kind === "text") {
      if (node.text.trim().length > 0) {
        return [
          {
            kind: "unsupported_stmt",
            reason: "Verbatim template text is unsupported in closed computation program: " + JSON.stringify(node.text.trim()),
            src: node.text,
          },
        ];
      }
      return [];
    }

    if (node.kind === "output") {
      const ast = parseExpressionToAST(node.expression, node.filters);
      return [
        {
          kind: "output",
          value: lowerASTExpression(ast, schema, localNames),
        },
      ];
    }

    if (node.kind === "tag") {
      if (node.name === "comment") return [];

      if (node.name === "for" || node.name === "capture" || node.name === "raw") {
        return [
          {
            kind: "unsupported_stmt",
            reason: `Construct "{%${node.name}%}" is unsupported in closed Specter expressions`,
            src: node.args,
          },
        ];
      }

      if (node.name === "assign" || node.name === "assignVar") {
        const target = node.target ?? (node.args.includes("=") ? node.args.split("=")[0]?.trim() : "");
        if (!target) {
          return [
            {
              kind: "unsupported_stmt",
              reason: "Missing target identifier in assignment: " + node.args,
              src: node.args,
            },
          ];
        }
        const ast = parseExpressionToAST(node.expression, node.filters);
        const expr = lowerASTExpression(ast, schema, localNames);
        return [
          {
            kind: "assign",
            target,
            value: expr,
            isLocal: target !== targetResultVar && target !== "sd_cb_result",
          },
        ];
      }

      if (node.name === "parseAssign") {
        const target = node.target ?? (node.args.includes("=") ? node.args.split("=")[0]?.trim() : "");
        if (!target) {
          return [
            {
              kind: "unsupported_stmt",
              reason: "Missing target identifier in parseAssign: " + node.args,
              src: node.args,
            },
          ];
        }

        let expr: SpecterExpr;
        const trimmed = node.expression.trim();
        const unquoted =
          (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
          (trimmed.startsWith("'") && trimmed.endsWith("'"))
            ? trimmed.slice(1, -1)
            : trimmed;

        try {
          const parsed = JSON.parse(unquoted);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            if ("amount" in parsed && "currency" in parsed) {
              expr = {
                kind: "currency_literal",
                valueType: "CURRENCY",
                value: Number(parsed.amount),
                currency: String(parsed.currency),
              };
            } else if ("value" in parsed && "currency" in parsed) {
              expr = {
                kind: "currency_literal",
                valueType: "CURRENCY",
                value: Number(parsed.value),
                currency: String(parsed.currency),
              };
            } else if ("days" in parsed || "unit" in parsed) {
              const durObj: SpecterLit = {
                kind: "duration_literal",
                valueType: "DURATION",
                value: Number(parsed.value ?? parsed.days ?? 0),
                unit: String(parsed.unit ?? "DAYS"),
              };
              if (parsed.days !== undefined) {
                durObj.days = Number(parsed.days);
              }
              expr = durObj;
            } else {
              expr = {
                kind: "literal",
                valueType: "UNKNOWN",
                value: parsed,
              };
            }
          } else {
            expr = {
              kind: "literal",
              valueType: Array.isArray(parsed) ? "ARRAY" : typeof parsed === "number" ? "NUMBER" : "TEXT",
              value: parsed,
            };
          }
        } catch {
          const ast = parseExpressionToAST(node.expression, node.filters);
          expr = lowerASTExpression(ast, schema, localNames);
        }

        return [
          {
            kind: "parse_assign",
            target,
            value: expr,
            isLocal: target !== targetResultVar && target !== "sd_cb_result",
          },
        ];
      }

      if (node.name === "if") {
        const condAst = parseExpressionToAST(node.expression, node.filters);
        const condition = lowerASTExpression(condAst, schema, localNames);

        const children = node.children ?? [];
        const elseIdx = children.findIndex(
          (c) => c.kind === "tag" && (c.name === "else" || c.name === "elsif")
        );

        const thenNodes = elseIdx >= 0 ? children.slice(0, elseIdx) : children;
        const otherwiseNodes = elseIdx >= 0 ? children.slice(elseIdx + 1) : [];

        const thenBranch = thenNodes.flatMap(lowerNode);
        let otherwiseBranch = otherwiseNodes.flatMap(lowerNode);

        if (otherwiseBranch.length === 0) {
          otherwiseBranch = [
            {
              kind: "assign",
              target: targetResultVar,
              value: { kind: "literal", valueType: "UNKNOWN", value: null },
              isLocal: false,
            },
          ];
        }

        return [
          {
            kind: "if_stmt",
            condition,
            thenBranch,
            otherwiseBranch,
          },
        ];
      }

      if (node.name === "computeColumn") {
        const body = (node.children ?? []).flatMap(lowerNode);
        return body;
      }
    }

    return [];
  }

  const statements = document.nodes.flatMap(lowerNode);
  return {
    kind: "specter_program",
    statements,
    resultVar: targetResultVar,
  };
}

export function getExprType(expr: SpecterExpr): SpecterType {
  if (expr.kind === "literal" || expr.kind === "currency_literal" || expr.kind === "duration_literal") {
    return expr.valueType;
  }
  return expr.inferredType;
}

// ─── 5. Transformation Pipeline: joinIfAssigns ──────────────────────────────

export function joinIfAssigns(program: SpecterProgram): SpecterProgram {
  function transformStmt(stmt: SpecterStmt): SpecterStmt {
    if (stmt.kind !== "if_stmt") return stmt;

    const thenStmts = stmt.thenBranch.map(transformStmt);
    const otherStmts = stmt.otherwiseBranch.map(transformStmt);

    if (
      thenStmts.length === 1 &&
      otherStmts.length === 1 &&
      (thenStmts[0]!.kind === "assign" || thenStmts[0]!.kind === "parse_assign") &&
      (otherStmts[0]!.kind === "assign" || otherStmts[0]!.kind === "parse_assign") &&
      thenStmts[0]!.target === otherStmts[0]!.target
    ) {
      const target = thenStmts[0]!.target;
      const thenVal = (thenStmts[0] as SpecterAssignStmt).value;
      const elseVal = (otherStmts[0] as SpecterAssignStmt).value;

      return {
        kind: "assign",
        target,
        isLocal: (thenStmts[0] as SpecterAssignStmt).isLocal,
        value: {
          kind: "if_expr",
          condition: stmt.condition,
          thenExpr: thenVal,
          elseExpr: elseVal,
          inferredType: getExprType(thenVal),
        },
      };
    }

    return {
      kind: "if_stmt",
      condition: stmt.condition,
      thenBranch: thenStmts,
      otherwiseBranch: otherStmts,
    };
  }

  return {
    ...program,
    statements: program.statements.map(transformStmt),
  };
}

// ─── 6. Transformation Pipeline: inlineLocals ───────────────────────────────

export function substituteInExpr(
  expr: SpecterExpr,
  env: Map<string, SpecterExpr>,
): SpecterExpr {
  switch (expr.kind) {
    case "literal":
    case "currency_literal":
    case "duration_literal":
    case "unsupported":
      return expr;

    case "var": {
      if (expr.isLocal && env.has(expr.name)) {
        return env.get(expr.name)!;
      }
      return expr;
    }

    case "un_op":
      return {
        ...expr,
        operand: substituteInExpr(expr.operand, env),
      };

    case "bin_op":
      return {
        ...expr,
        left: substituteInExpr(expr.left, env),
        right: substituteInExpr(expr.right, env),
      };

    case "filter":
      return {
        ...expr,
        target: substituteInExpr(expr.target, env),
        args: expr.args.map((a) => substituteInExpr(a, env)),
      };

    case "if_expr":
      return {
        ...expr,
        condition: substituteInExpr(expr.condition, env),
        thenExpr: substituteInExpr(expr.thenExpr, env),
        elseExpr: substituteInExpr(expr.elseExpr, env),
      };
  }
}

export function inlineLocals(program: SpecterProgram): SpecterProgram {
  const env = new Map<string, SpecterExpr>();
  const inlinedStmts: SpecterStmt[] = [];

  for (const stmt of program.statements) {
    if (stmt.kind === "assign" || stmt.kind === "parse_assign") {
      const inlinedValue = substituteInExpr(stmt.value, env);
      if (stmt.isLocal) {
        env.set(stmt.target, inlinedValue);
      } else {
        inlinedStmts.push({
          ...stmt,
          value: inlinedValue,
        });
      }
    } else if (stmt.kind === "output") {
      inlinedStmts.push({
        ...stmt,
        value: substituteInExpr(stmt.value, env),
      });
    } else if (stmt.kind === "if_stmt") {
      inlinedStmts.push({
        ...stmt,
        condition: substituteInExpr(stmt.condition, env),
        thenBranch: stmt.thenBranch.map((s) =>
          s.kind === "assign" ? { ...s, value: substituteInExpr(s.value, env) } : s
        ),
        otherwiseBranch: stmt.otherwiseBranch.map((s) =>
          s.kind === "assign" ? { ...s, value: substituteInExpr(s.value, env) } : s
        ),
      });
    } else {
      inlinedStmts.push(stmt);
    }
  }

  return {
    ...program,
    statements: inlinedStmts,
  };
}

// ─── 7. Root Result Extractor (Fail Closed) ─────────────────────────────────

export function resultExpr(program: SpecterProgram): SpecterExpr {
  for (const stmt of program.statements) {
    if (stmt.kind === "unsupported_stmt") {
      return {
        kind: "unsupported",
        reason: stmt.reason,
        src: stmt.src,
        inferredType: "UNKNOWN",
      };
    }
  }

  const outputStmt = program.statements.find((s) => s.kind === "output") as
    | { kind: "output"; value: SpecterExpr }
    | undefined;
  if (outputStmt) {
    return outputStmt.value;
  }

  const resultTarget = program.resultVar ?? "$$answer";
  const resultAssign = program.statements.find(
    (s) =>
      (s.kind === "assign" || s.kind === "parse_assign") &&
      (s.target === resultTarget || s.target === "sd_cb_result")
  ) as SpecterAssignStmt | undefined;

  if (resultAssign) {
    return resultAssign.value;
  }

  const lastAssign = [...program.statements]
    .reverse()
    .find((s) => s.kind === "assign" || s.kind === "parse_assign") as
    | SpecterAssignStmt
    | undefined;

  if (lastAssign) {
    return lastAssign.value;
  }

  return {
    kind: "unsupported",
    reason: "No result expression found for computation: " + resultTarget,
    inferredType: "UNKNOWN",
  };
}

// ─── 8. Specter Formula Emitter ─────────────────────────────────────────────

export function emitSpecter(expr: SpecterExpr): string {
  switch (expr.kind) {
    case "literal":
      if (expr.value === null) return "null";
      if (typeof expr.value === "string") return JSON.stringify(expr.value);
      return String(expr.value);

    case "currency_literal":
      return "Currency(" + expr.value + ", " + JSON.stringify(expr.currency) + ")";

    case "duration_literal":
      return "Duration(" + expr.value + ", " + JSON.stringify(expr.unit) + ")";

    case "var":
      return expr.name;

    case "un_op":
      return expr.op + "(" + emitSpecter(expr.operand) + ")";

    case "bin_op":
      return expr.op + "(" + emitSpecter(expr.left) + ", " + emitSpecter(expr.right) + ")";

    case "filter": {
      const targetStr = emitSpecter(expr.target);
      const argsStr = expr.args.map(emitSpecter).join(", ");
      if (argsStr.length > 0) {
        return expr.op + "(" + targetStr + ", " + argsStr + ")";
      }
      return expr.op + "(" + targetStr + ")";
    }

    case "if_expr":
      return (
        "If(" +
        emitSpecter(expr.condition) +
        ", " +
        emitSpecter(expr.thenExpr) +
        ", " +
        emitSpecter(expr.elseExpr) +
        ")"
      );

    case "unsupported":
      return "Unsupported(" + JSON.stringify(expr.reason) + ")";
  }
}

/**
 * End-to-end convenience pipeline:
 * Document -> Program -> joinIfAssigns -> inlineLocals -> resultExpr -> emit
 */
export function lowerToSpecter(
  document: ComputationIRDocument,
  schema?: SchemaTypeMap,
  targetResultVar: string = "$$answer",
): string {
  const p = programFromIR(document, schema, targetResultVar);
  const joined = joinIfAssigns(p);
  const inlined = inlineLocals(joined);
  const root = resultExpr(inlined);
  return emitSpecter(root);
}
