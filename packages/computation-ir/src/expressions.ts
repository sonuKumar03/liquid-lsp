import type { ComputationIRFilter } from "./index.js";

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
  if (trimmed === 'true') return { kind: 'literal', valueType: 'boolean', value: true };
  if (trimmed === 'false') return { kind: 'literal', valueType: 'boolean', value: false };
  if (trimmed === 'nil' || trimmed === 'null') return { kind: 'literal', valueType: 'null', value: null };

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: 'literal', valueType: 'number', value: parseFloat(trimmed) };
  }

  if (/^"([^"\\]|\\.)*"$/.test(trimmed) || /^'([^'\\]|\\.)*'$/.test(trimmed)) {
    return { kind: 'literal', valueType: 'string', value: trimmed.slice(1, -1) };
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
    if (twoChars === '==' || twoChars === '!=' || twoChars === '<=' || twoChars === '>=') {
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
