import type { ComputationIRFilter } from './index.js';

export type BinaryOperator =
  | 'ADD'
  | 'SUBTRACT'
  | 'MULTIPLY'
  | 'DIVIDE'
  | 'MODULO'
  | 'CONCAT'
  | 'EQ'
  | 'NEQ'
  | 'GT'
  | 'GTE'
  | 'LT'
  | 'LTE'
  | 'CONTAINS'
  | 'AND'
  | 'OR';

export type UnaryOperator = 'NEGATE' | 'NOT';

export interface LiteralExpressionNode {
  kind: 'literal';
  valueType: 'string' | 'number' | 'boolean' | 'null';
  value: string | number | boolean | null;
}

export interface IdentifierExpressionNode {
  kind: 'identifier';
  name: string;
}

export interface ColumnRefExpressionNode {
  kind: 'column_ref';
  table: string;
  column: string;
}

export interface BinaryExpressionNode {
  kind: 'binary_op';
  operator: BinaryOperator;
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface UnaryExpressionNode {
  kind: 'unary_op';
  operator: UnaryOperator;
  operand: ExpressionNode;
}

export interface FilterCallExpressionNode {
  kind: 'filter_call';
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
  plus: 'ADD',
  minus: 'SUBTRACT',
  times: 'MULTIPLY',
  divided_by: 'DIVIDE',
  modulo: 'MODULO',
  append: 'CONCAT',
};

/**
 * Parses a simple atom (literal, column reference, or identifier).
 */
export function parseExpressionAtom(raw: string): ExpressionNode {
  const trimmed = raw.trim();
  if (trimmed === 'true')
    return { kind: 'literal', valueType: 'boolean', value: true };
  if (trimmed === 'false')
    return { kind: 'literal', valueType: 'boolean', value: false };
  if (trimmed === 'nil' || trimmed === 'null')
    return { kind: 'literal', valueType: 'null', value: null };

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: 'literal', valueType: 'number', value: parseFloat(trimmed) };
  }

  if (/^"([^"\\]|\\.)*"$/.test(trimmed) || /^'([^'\\]|\\.)*'$/.test(trimmed)) {
    return {
      kind: 'literal',
      valueType: 'string',
      value: trimmed.slice(1, -1),
    };
  }

  if (trimmed.includes('.')) {
    const parts = trimmed.split('.');
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { kind: 'column_ref', table: parts[0], column: parts[1] };
    }
  }

  return { kind: 'identifier', name: trimmed };
}

function tokenizeExpression(str: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < str.length) {
    const char = str[i];
    if (!char) break;
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      let s = quote;
      i++;
      while (i < str.length && str[i] !== quote) {
        if (str[i] === '\\') {
          s += str[i++] || '';
        }
        s += str[i++] || '';
      }
      if (i < str.length) s += str[i++] || '';
      tokens.push(s);
      continue;
    }

    const twoChars = str.slice(i, i + 2);
    if (
      twoChars === '==' ||
      twoChars === '!=' ||
      twoChars === '<=' ||
      twoChars === '>='
    ) {
      tokens.push(twoChars);
      i += 2;
      continue;
    }

    if (
      char === '<' ||
      char === '>' ||
      char === '(' ||
      char === ')' ||
      char === '+' ||
      char === '-' ||
      char === '*' ||
      char === '/' ||
      char === '%'
    ) {
      tokens.push(char);
      i++;
      continue;
    }

    let word = '';
    while (i < str.length && !/[\s()+*%/<>=!]/.test(str[i] || '')) {
      word += str[i++] || '';
    }
    if (word) {
      tokens.push(word);
    }
  }
  return tokens;
}

class ExpressionParser {
  private tokens: string[];
  private pos = 0;

  constructor(raw: string) {
    this.tokens = tokenizeExpression(raw);
  }

  private peek(): string | undefined {
    return this.tokens[this.pos];
  }

  private consume(expected?: string): string {
    const current = this.tokens[this.pos++];
    if (expected && current !== expected) {
      throw new Error(`Expected token "${expected}" but got "${current}"`);
    }
    return current || '';
  }

  public parse(): ExpressionNode {
    if (this.tokens.length === 0) {
      return { kind: 'literal', valueType: 'null', value: null };
    }
    return this.parseLogicalOr();
  }

  private parseLogicalOr(): ExpressionNode {
    let left = this.parseLogicalAnd();
    while (this.peek() === 'or') {
      this.consume('or');
      const right = this.parseLogicalAnd();
      left = {
        kind: 'binary_op',
        operator: 'OR',
        left,
        right,
      };
    }
    return left;
  }

  private parseLogicalAnd(): ExpressionNode {
    let left = this.parseComparison();
    while (this.peek() === 'and') {
      this.consume('and');
      const right = this.parseComparison();
      left = {
        kind: 'binary_op',
        operator: 'AND',
        left,
        right,
      };
    }
    return left;
  }

  private parseComparison(): ExpressionNode {
    const left = this.parseAdditive();
    const op = this.peek();
    if (
      op === '==' ||
      op === '!=' ||
      op === '<' ||
      op === '<=' ||
      op === '>' ||
      op === '>=' ||
      op === 'contains'
    ) {
      this.consume();
      const right = this.parseAdditive();
      const opMap: Record<string, BinaryOperator> = {
        '==': 'EQ',
        '!=': 'NEQ',
        '<': 'LT',
        '<=': 'LTE',
        '>': 'GT',
        '>=': 'GTE',
        contains: 'CONTAINS',
      };
      return {
        kind: 'binary_op',
        operator: opMap[op] || 'EQ',
        left,
        right,
      };
    }
    return left;
  }

  private parseAdditive(): ExpressionNode {
    let left = this.parseMultiplicative();
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.consume();
      const right = this.parseMultiplicative();
      left = {
        kind: 'binary_op',
        operator: op === '+' ? 'ADD' : 'SUBTRACT',
        left,
        right,
      };
    }
    return left;
  }

  private parseMultiplicative(): ExpressionNode {
    let left = this.parseUnary();
    while (this.peek() === '*' || this.peek() === '/' || this.peek() === '%') {
      const op = this.consume();
      const right = this.parseUnary();
      const opMap: Record<string, BinaryOperator> = {
        '*': 'MULTIPLY',
        '/': 'DIVIDE',
        '%': 'MODULO',
      };
      left = {
        kind: 'binary_op',
        operator: opMap[op] || 'MULTIPLY',
        left,
        right,
      };
    }
    return left;
  }

  private parseUnary(): ExpressionNode {
    if (this.peek() === 'not') {
      this.consume('not');
      const operand = this.parseUnary();
      return { kind: 'unary_op', operator: 'NOT', operand };
    }
    if (this.peek() === '-') {
      this.consume('-');
      const operand = this.parseUnary();
      return { kind: 'unary_op', operator: 'NEGATE', operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionNode {
    const token = this.peek();
    if (!token) {
      return { kind: 'literal', valueType: 'null', value: null };
    }

    if (token === '(') {
      this.consume('(');
      const expr = this.parseLogicalOr();
      this.consume(')');
      return expr;
    }

    this.consume();
    return parseExpressionAtom(token);
  }
}

/**
 * Transforms a raw Liquid expression and its filter pipeline into a Typed Expression AST.
 */
export function parseExpressionToAST(
  rawExpression: string,
  filters?: ComputationIRFilter[],
): ExpressionNode {
  let root: ExpressionNode;
  try {
    const parser = new ExpressionParser(rawExpression);
    root = parser.parse();
  } catch {
    root = parseExpressionAtom(rawExpression);
  }

  if (!filters || filters.length === 0) {
    return root;
  }

  for (const filter of filters) {
    const binaryOp = MATH_FILTER_MAP[filter.name];
    const colonIdx = filter.raw.indexOf(':');
    const rawArg = colonIdx !== -1 ? filter.raw.slice(colonIdx + 1).trim() : '';

    if (binaryOp && rawArg) {
      let rightNode: ExpressionNode;
      try {
        rightNode = new ExpressionParser(rawArg).parse();
      } catch {
        rightNode = parseExpressionAtom(rawArg);
      }
      root = {
        kind: 'binary_op',
        operator: binaryOp,
        left: root,
        right: rightNode,
      };
    } else {
      const args: ExpressionNode[] = rawArg
        ? rawArg.split(',').map((a) => {
            try {
              return new ExpressionParser(a.trim()).parse();
            } catch {
              return parseExpressionAtom(a.trim());
            }
          })
        : [];

      root = {
        kind: 'filter_call',
        filterName: filter.name,
        target: root,
        args,
      };
    }
  }

  return root;
}

/**
 * Evaluates constant sub-expressions at compile time (Constant Folding & Algebraic Reduction).
 * Examples:
 *   10 + 20 -> 30
 *   (10 + 20) * 3 -> 90
 *   "Agreement: " + "Standard" -> "Agreement: Standard"
 *   x * 1 -> x
 *   x + 0 -> x
 *   x * 0 -> 0
 */
export function foldConstants(expr: ExpressionNode): ExpressionNode {
  if (expr.kind === 'binary_op') {
    const left = foldConstants(expr.left);
    const right = foldConstants(expr.right);

    // Both are literals -> fold completely
    if (left.kind === 'literal' && right.kind === 'literal') {
      const lVal = left.value;
      const rVal = right.value;

      if (expr.operator === 'ADD') {
        if (typeof lVal === 'number' && typeof rVal === 'number') {
          return { kind: 'literal', valueType: 'number', value: lVal + rVal };
        }
        if (typeof lVal === 'string' || typeof rVal === 'string') {
          return {
            kind: 'literal',
            valueType: 'string',
            value: String(lVal) + String(rVal),
          };
        }
      }

      if (expr.operator === 'SUBTRACT') {
        if (typeof lVal === 'number' && typeof rVal === 'number') {
          return { kind: 'literal', valueType: 'number', value: lVal - rVal };
        }
      }

      if (expr.operator === 'MULTIPLY') {
        if (typeof lVal === 'number' && typeof rVal === 'number') {
          return { kind: 'literal', valueType: 'number', value: lVal * rVal };
        }
      }

      if (expr.operator === 'DIVIDE') {
        if (
          typeof lVal === 'number' &&
          typeof rVal === 'number' &&
          rVal !== 0
        ) {
          return { kind: 'literal', valueType: 'number', value: lVal / rVal };
        }
      }

      if (expr.operator === 'MODULO') {
        if (
          typeof lVal === 'number' &&
          typeof rVal === 'number' &&
          rVal !== 0
        ) {
          return { kind: 'literal', valueType: 'number', value: lVal % rVal };
        }
      }

      if (expr.operator === 'CONCAT') {
        return {
          kind: 'literal',
          valueType: 'string',
          value: String(lVal) + String(rVal),
        };
      }

      if (expr.operator === 'EQ') {
        return { kind: 'literal', valueType: 'boolean', value: lVal === rVal };
      }

      if (expr.operator === 'NEQ') {
        return { kind: 'literal', valueType: 'boolean', value: lVal !== rVal };
      }

      if (expr.operator === 'GT') {
        return {
          kind: 'literal',
          valueType: 'boolean',
          value: Number(lVal) > Number(rVal),
        };
      }

      if (expr.operator === 'GTE') {
        return {
          kind: 'literal',
          valueType: 'boolean',
          value: Number(lVal) >= Number(rVal),
        };
      }

      if (expr.operator === 'LT') {
        return {
          kind: 'literal',
          valueType: 'boolean',
          value: Number(lVal) < Number(rVal),
        };
      }

      if (expr.operator === 'LTE') {
        return {
          kind: 'literal',
          valueType: 'boolean',
          value: Number(lVal) <= Number(rVal),
        };
      }

      if (expr.operator === 'AND') {
        return {
          kind: 'literal',
          valueType: 'boolean',
          value: Boolean(lVal && rVal),
        };
      }

      if (expr.operator === 'OR') {
        return {
          kind: 'literal',
          valueType: 'boolean',
          value: Boolean(lVal || rVal),
        };
      }

      if (expr.operator === 'CONTAINS') {
        return {
          kind: 'literal',
          valueType: 'boolean',
          value: String(lVal).includes(String(rVal)),
        };
      }
    }

    // Algebraic identities
    if (expr.operator === 'MULTIPLY') {
      if (right.kind === 'literal' && right.value === 1) return left;
      if (left.kind === 'literal' && left.value === 1) return right;
      if (right.kind === 'literal' && right.value === 0)
        return { kind: 'literal', valueType: 'number', value: 0 };
      if (left.kind === 'literal' && left.value === 0)
        return { kind: 'literal', valueType: 'number', value: 0 };
    }

    if (expr.operator === 'ADD') {
      if (right.kind === 'literal' && right.value === 0) return left;
      if (left.kind === 'literal' && left.value === 0) return right;
    }

    if (expr.operator === 'SUBTRACT') {
      if (right.kind === 'literal' && right.value === 0) return left;
    }

    return {
      kind: 'binary_op',
      operator: expr.operator,
      left,
      right,
    };
  }

  if (expr.kind === 'unary_op') {
    const operand = foldConstants(expr.operand);
    if (operand.kind === 'literal') {
      if (expr.operator === 'NEGATE' && typeof operand.value === 'number') {
        return { kind: 'literal', valueType: 'number', value: -operand.value };
      }
      if (expr.operator === 'NOT') {
        return { kind: 'literal', valueType: 'boolean', value: !operand.value };
      }
    }
    return { kind: 'unary_op', operator: expr.operator, operand };
  }

  if (expr.kind === 'filter_call') {
    const target = foldConstants(expr.target);
    const args = expr.args.map(foldConstants);

    if (target.kind === 'literal') {
      if (expr.filterName === 'upcase' && typeof target.value === 'string') {
        return {
          kind: 'literal',
          valueType: 'string',
          value: target.value.toUpperCase(),
        };
      }
      if (expr.filterName === 'downcase' && typeof target.value === 'string') {
        return {
          kind: 'literal',
          valueType: 'string',
          value: target.value.toLowerCase(),
        };
      }
      if (expr.filterName === 'abs' && typeof target.value === 'number') {
        return {
          kind: 'literal',
          valueType: 'number',
          value: Math.abs(target.value),
        };
      }
      if (expr.filterName === 'round' && typeof target.value === 'number') {
        return {
          kind: 'literal',
          valueType: 'number',
          value: Math.round(target.value),
        };
      }
      if (expr.filterName === 'ceil' && typeof target.value === 'number') {
        return {
          kind: 'literal',
          valueType: 'number',
          value: Math.ceil(target.value),
        };
      }
      if (expr.filterName === 'floor' && typeof target.value === 'number') {
        return {
          kind: 'literal',
          valueType: 'number',
          value: Math.floor(target.value),
        };
      }
    }

    return { kind: 'filter_call', filterName: expr.filterName, target, args };
  }

  return expr;
}
