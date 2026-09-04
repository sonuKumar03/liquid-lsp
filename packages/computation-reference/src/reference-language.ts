export interface ReferenceProgram {
  kind: 'program';
  statements: ReferenceStatement[];
}

export interface ReferenceFieldSchema {
  type:
    | 'currency'
    | 'duration'
    | 'number'
    | 'date'
    | 'dropdown'
    | 'string'
    | 'repeating'
    | 'table';
  label?: string;
  currency?: string;
  precision?: number;
  showInWords?: boolean;
  isIsoPrefixEnabled?: boolean;
  formatting?: string;
  minValue?: number;
  maxValue?: number;
  options?: { label: string; value: string }[];
  attributes?: Record<string, ReferenceFieldSchema>;
}

export type ReferenceFieldSchemas = Record<string, ReferenceFieldSchema>;

export type ReferenceStatement =
  | ReferenceAssignment
  | ReferenceIf
  | ReferenceFor
  | ReferenceComputeColumn
  | ReferenceOutput;

export interface ReferenceAssignment {
  kind: 'assignment';
  name: string;
  value: ReferenceExpression;
}

export interface ReferenceIf {
  kind: 'if';
  condition: ReferenceExpression;
  then: ReferenceStatement[];
  otherwise: ReferenceStatement[];
}

export interface ReferenceFor {
  kind: 'for';
  variable: string;
  collection: ReferenceExpression;
  body: ReferenceStatement[];
}

export interface ReferenceOutput {
  kind: 'output';
  value: ReferenceExpression;
}

export interface ReferenceComputeColumn {
  kind: 'computeColumn';
  table: string;
  column: string;
  body: ReferenceStatement[];
}

type ReferenceCallName =
  | 'Add'
  | 'Subtract'
  | 'Multiply'
  | 'Divide'
  | 'GetColumn'
  | 'Sum'
  | 'If'
  | 'Exists'
  | 'And'
  | 'Or'
  | 'Not'
  | 'Equals'
  | 'toCurrency'
  | 'toDuration'
  | 'sumArray'
  | 'updateAttribute'
  | 'updateTypeAttribute'
  | 'concat'
  | 'uniq'
  | 'strip_html'
  | 'strip';

function isReferenceCallName(value: string): value is ReferenceCallName {
  return [
    'Add',
    'Subtract',
    'Multiply',
    'Divide',
    'GetColumn',
    'Sum',
    'If',
    'Exists',
    'And',
    'Or',
    'Not',
    'Equals',
    'toCurrency',
    'toDuration',
    'sumArray',
    'updateAttribute',
    'updateTypeAttribute',
    'concat',
    'uniq',
    'strip_html',
    'strip',
  ].includes(value);
}

export type ReferenceExpression =
  | { kind: 'literal'; value: boolean | null | number | string }
  | { kind: 'object'; entries: Record<string, ReferenceExpression> }
  | { kind: 'array'; items: ReferenceExpression[] }
  | { kind: 'path'; path: string[] }
  | { kind: 'call'; name: ReferenceCallName; arguments: ReferenceExpression[] }
  | {
      kind: 'binary';
      operator:
        | 'add'
        | 'subtract'
        | 'multiply'
        | 'divide'
        | 'equal'
        | 'notEqual'
        | 'greater'
        | 'less'
        | 'greaterEqual'
        | 'lessEqual';
      left: ReferenceExpression;
      right: ReferenceExpression;
    };

interface Lexeme {
  kind: 'eof' | 'identifier' | 'number' | 'string' | 'symbol';
  text: string;
  offset: number;
}

class ReferenceLanguageError extends Error {
  constructor(message: string, offset: number) {
    super(`${message} at offset ${offset}`);
    this.name = 'ReferenceLanguageError';
  }
}

function lex(source: string): Lexeme[] {
  const tokens: Lexeme[] = [];
  let offset = 0;
  while (offset < source.length) {
    const character = source[offset];
    if (character && /\s/.test(character)) {
      offset += 1;
      continue;
    }
    if (character && /[A-Za-z_$]/.test(character)) {
      const start = offset;
      offset += 1;
      while (
        offset < source.length &&
        /[A-Za-z0-9_$]/.test(source[offset] ?? '')
      )
        offset += 1;
      tokens.push({
        kind: 'identifier',
        text: source.slice(start, offset),
        offset: start,
      });
      continue;
    }
    if (character && /[0-9]/.test(character)) {
      const start = offset;
      offset += 1;
      while (offset < source.length && /[0-9.]/.test(source[offset] ?? ''))
        offset += 1;
      tokens.push({
        kind: 'number',
        text: source.slice(start, offset),
        offset: start,
      });
      continue;
    }
    if (character === '"' || character === "'") {
      const quote = character;
      const start = offset;
      offset += 1;
      let value = '';
      while (offset < source.length && source[offset] !== quote) {
        if (source[offset] === '\\' && offset + 1 < source.length) {
          offset += 1;
          const escaped = source[offset];
          value +=
            escaped === 'n'
              ? '\n'
              : escaped === 'r'
                ? '\r'
                : escaped === 't'
                  ? '\t'
                  : escaped;
        } else {
          value += source[offset];
        }
        offset += 1;
      }
      if (source[offset] !== quote)
        throw new ReferenceLanguageError('Unclosed string', start);
      offset += 1;
      tokens.push({ kind: 'string', text: value, offset: start });
      continue;
    }
    if (character === '<' || character === '!' || character === '>') {
      const start = offset;
      offset += 1;
      if (source[offset] === '=') offset += 1;
      tokens.push({
        kind: 'symbol',
        text: source.slice(start, offset),
        offset: start,
      });
      continue;
    }
    if (character && '{}=()+-*/;:(),.[]'.includes(character)) {
      tokens.push({ kind: 'symbol', text: character, offset });
      offset += 1;
      continue;
    }
    throw new ReferenceLanguageError(
      `Unexpected character ${character}`,
      offset,
    );
  }
  tokens.push({ kind: 'eof', text: '', offset: source.length });
  return tokens;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Lexeme[]) {}

  parse(): ReferenceProgram {
    return { kind: 'program', statements: this.statements(false) };
  }

  private current(): Lexeme {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!;
  }

  private take(text?: string): Lexeme {
    const token = this.current();
    if (text !== undefined && token.text !== text) {
      throw new ReferenceLanguageError(`Expected ${text}`, token.offset);
    }
    this.index += 1;
    return token;
  }

  private statements(inBlock: boolean): ReferenceStatement[] {
    const statements: ReferenceStatement[] = [];
    while (
      this.current().kind !== 'eof' &&
      (!inBlock || this.current().text !== '}')
    ) {
      statements.push(this.statement());
      if (this.current().text === ';') this.take(';');
    }
    if (inBlock) this.take('}');
    return statements;
  }

  private statement(): ReferenceStatement {
    if (this.current().text === 'if') return this.ifStatement();
    if (this.current().text === 'for') return this.forStatement();
    if (this.current().text === 'computeColumn')
      return this.computeColumnStatement();
    if (this.current().text === 'output') {
      this.take('output');
      return { kind: 'output', value: this.expression() };
    }
    const name = this.take().text;
    if (!name || this.tokens[this.index - 1]?.kind !== 'identifier') {
      throw new ReferenceLanguageError(
        'Expected assignment name',
        this.current().offset,
      );
    }
    this.take('=');
    return { kind: 'assignment', name, value: this.expression() };
  }

  private forStatement(): ReferenceFor {
    this.take('for');
    const variable = this.take().text;
    this.take('in');
    const collection = this.expression();
    this.take('{');
    return { kind: 'for', variable, collection, body: this.statements(true) };
  }

  private computeColumnStatement(): ReferenceComputeColumn {
    this.take('computeColumn');
    const table = this.take().text;
    const column = this.take().text;
    this.take('{');
    return {
      kind: 'computeColumn',
      table,
      column,
      body: this.statements(true),
    };
  }

  private ifStatement(): ReferenceIf {
    this.take('if');
    const condition = this.expression();
    this.take('{');
    const then = this.statements(true);
    const otherwise =
      this.current().text === 'else'
        ? (this.take('else'), this.take('{'), this.statements(true))
        : [];
    return { kind: 'if', condition, then, otherwise };
  }

  private expression(): ReferenceExpression {
    let left = this.additive();
    while (['==', '!=', '>', '<', '>=', '<='].includes(this.current().text)) {
      const operator = this.take().text;
      const right = this.additive();
      const operators = {
        '==': 'equal',
        '!=': 'notEqual',
        '>': 'greater',
        '<': 'less',
        '>=': 'greaterEqual',
        '<=': 'lessEqual',
      } as const;
      left = {
        kind: 'binary',
        operator: operators[operator as keyof typeof operators],
        left,
        right,
      };
    }
    return left;
  }

  private additive(): ReferenceExpression {
    let left = this.multiplicative();
    while (
      this.current().text === '+' ||
      this.current().text === '-' ||
      this.current().text === 'plus' ||
      this.current().text === 'minus' ||
      this.current().text === 'add' ||
      this.current().text === 'subtract'
    ) {
      const operator = this.take().text;
      const right = this.multiplicative();
      left = {
        kind: 'binary',
        operator:
          operator === '+' || operator === 'plus' || operator === 'add'
            ? 'add'
            : 'subtract',
        left,
        right,
      };
    }
    return left;
  }

  private multiplicative(): ReferenceExpression {
    let left = this.primary();
    while (
      this.current().text === '*' ||
      this.current().text === '/' ||
      this.current().text === 'times' ||
      this.current().text === 'divided_by'
    ) {
      const operator = this.take().text;
      left = {
        kind: 'binary',
        operator:
          operator === '*' || operator === 'times' ? 'multiply' : 'divide',
        left,
        right: this.primary(),
      };
    }
    return left;
  }

  private primary(): ReferenceExpression {
    const token = this.take();
    if (token.kind === 'number')
      return { kind: 'literal', value: Number(token.text) };
    if (token.kind === 'string') return { kind: 'literal', value: token.text };
    if (token.text === 'true') return { kind: 'literal', value: true };
    if (token.text === 'false') return { kind: 'literal', value: false };
    if (token.text === 'null') return { kind: 'literal', value: null };
    if (token.text === '{') {
      const entries: Record<string, ReferenceExpression> = {};
      if (this.current().text !== '}') {
        const key = this.take().text;
        this.take(':');
        entries[key] = this.expression();
        while (this.current().text === ',') {
          this.take(',');
          if (this.current().text === '}') break;
          const k = this.take().text;
          this.take(':');
          entries[k] = this.expression();
        }
      }
      this.take('}');
      return { kind: 'object', entries };
    }
    if (token.text === '[') {
      const items: ReferenceExpression[] = [];
      if (this.current().text !== ']') {
        items.push(this.expression());
        while (this.current().text === ',') {
          this.take(',');
          if (this.current().text === ']') break;
          items.push(this.expression());
        }
      }
      this.take(']');
      return { kind: 'array', items };
    }
    if (token.text === '(') {
      const expression = this.expression();
      this.take(')');
      return expression;
    }
    if (token.kind === 'identifier') {
      if (this.current().text === '(') {
        this.take('(');
        const args: ReferenceExpression[] = [];
        if (this.current().text !== ')') {
          args.push(this.expression());
          while (this.current().text === ',') {
            this.take(',');
            args.push(this.expression());
          }
        }
        this.take(')');
        if (!isReferenceCallName(token.text)) {
          throw new ReferenceLanguageError(
            `Unsupported function ${token.text}`,
            token.offset,
          );
        }
        return { kind: 'call', name: token.text, arguments: args };
      }
      const path = [token.text];
      while (this.current().text === '.' || this.current().text === '[') {
        if (this.current().text === '.') {
          this.take('.');
          path.push(this.take().text);
        } else {
          this.take('[');
          path.push(this.take().text);
          this.take(']');
        }
      }
      return { kind: 'path', path };
    }
    throw new ReferenceLanguageError('Expected expression', token.offset);
  }
}

function isNumeric(value: unknown): boolean {
  return value !== null && value !== undefined && !Number.isNaN(Number(value));
}

function precision(value: unknown): number {
  const text = String(value);
  const decimal = text.indexOf('.');
  return decimal < 0 ? 0 : text.length - decimal - 1;
}

function scalarOperation(
  left: unknown,
  right: unknown,
  operator: 'add' | 'subtract' | 'multiply' | 'divide',
): number | null {
  const leftNumeric = isNumeric(left);
  const rightNumeric = isNumeric(right);
  if (!leftNumeric && !rightNumeric) return 0;
  if (
    (operator === 'multiply' || operator === 'divide') &&
    (!leftNumeric || !rightNumeric)
  )
    return 0;
  if (operator === 'divide' && Number(right) === 0) return null;
  if (leftNumeric && !rightNumeric) return Number(left);
  if (!leftNumeric && rightNumeric)
    return operator === 'add' ? Number(right) : -Number(right);
  const places = Math.max(precision(left), precision(right));
  const result =
    operator === 'add'
      ? Number(left) + Number(right)
      : operator === 'subtract'
        ? Number(left) - Number(right)
        : operator === 'multiply'
          ? Number(left) * Number(right)
          : Number(left) / Number(right);
  return Number(
    result.toFixed(operator === 'divide' ? Math.max(places, 3) : places),
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDuration(
  value: unknown,
): value is { value: unknown; type: string; days: unknown } {
  return (
    isObjectRecord(value) &&
    'value' in value &&
    'type' in value &&
    'days' in value &&
    typeof value.type === 'string' &&
    durationTypes.has(value.type)
  );
}

function numericKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => !Number.isNaN(Number(value[key])));
}

function isValidDate(value: unknown): value is string | Date {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(value);
    return !Number.isNaN(date.getTime());
  }
  return false;
}

function startOfDay(value: Date | string): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function operationOnDates(
  lhs: Date | string,
  rhs: Date | string,
  operator: 'add' | 'subtract' | 'multiply' | 'divide',
): unknown {
  if (operator !== 'subtract') return null;
  const days = Math.max(
    0,
    Math.round(
      (startOfDay(lhs).getTime() - startOfDay(rhs).getTime()) / 86400000,
    ),
  );
  return { type: 'DAYS', value: days, days };
}

function operationOnDateDuration(
  dateValue: Date | string,
  duration: { value: unknown; type: string; days: unknown },
  operator: 'add' | 'subtract' | 'multiply' | 'divide',
): unknown {
  if (operator !== 'add' && operator !== 'subtract') return null;
  if (!duration.value || !durationTypes.has(duration.type))
    return new Date(dateValue).toISOString();
  const amount = Number(duration.value) * (operator === 'add' ? 1 : -1);
  const date = new Date(dateValue);
  if (duration.type === 'DAYS') date.setDate(date.getDate() + amount);
  if (duration.type === 'WEEKS') date.setDate(date.getDate() + amount * 7);
  if (duration.type === 'MONTHS') date.setMonth(date.getMonth() + amount);
  if (duration.type === 'YEARS') date.setFullYear(date.getFullYear() + amount);
  return date.toISOString();
}

function valueOperation(
  left: unknown,
  right: unknown,
  operator: 'add' | 'subtract' | 'multiply' | 'divide',
): unknown {
  if (isValidDate(left) && isValidDate(right)) {
    return operationOnDates(left, right, operator);
  }
  if (isValidDate(left) && isObjectRecord(right)) {
    return isDuration(right)
      ? operationOnDateDuration(left, right, operator)
      : left;
  }
  if (isDuration(left) && isDuration(right)) {
    if (
      left.days === null ||
      left.days === undefined ||
      right.days === null ||
      right.days === undefined
    ) {
      return { type: 'DAYS', value: 0, days: 0 };
    }
    const days = scalarOperation(left.days, right.days, operator);
    return { type: 'DAYS', value: days, days };
  }
  if (isObjectRecord(left) && isObjectRecord(right)) {
    const result = { ...right, ...left };
    const leftKeys = numericKeys(left);
    const rightKeys = numericKeys(right);
    const commonKeys = leftKeys.filter((key) => rightKeys.includes(key));
    if (commonKeys.length) {
      for (const key of rightKeys)
        result[key] = scalarOperation(left[key], right[key], operator);
    } else {
      result.value = scalarOperation(
        leftKeys.length ? left[leftKeys[0]!] : 0,
        rightKeys.length ? right[rightKeys[0]!] : 0,
        operator,
      );
    }
    return result;
  }
  if (typeof left === 'number' && isObjectRecord(right)) {
    const result = { ...right };
    const keys = numericKeys(right);
    if (!keys.length) {
      result.value = scalarOperation(left, 0, operator);
    } else {
      for (const key of keys)
        result[key] = scalarOperation(left, right[key], operator);
    }
    return result;
  }
  if (isObjectRecord(left) && typeof right === 'number') {
    const result = { ...left };
    const keys = numericKeys(left);
    if (!keys.length) {
      result.value = scalarOperation(0, right, operator);
    } else {
      for (const key of keys)
        result[key] = scalarOperation(left[key], right, operator);
    }
    return result;
  }
  if (
    (isObjectRecord(left) && (right === null || right === undefined)) ||
    (isObjectRecord(right) && (left === null || left === undefined))
  )
    return null;
  return scalarOperation(left, right, operator);
}

function liquidTruthy(value: unknown): boolean {
  return value !== null && value !== undefined && value !== false;
}

const durationTypes = new Set(['DAYS', 'WEEKS', 'MONTHS', 'YEARS']);

function isValidNumber(value: unknown): boolean {
  return value !== null && value !== undefined && !Number.isNaN(Number(value));
}

function evaluateCall(name: ReferenceCallName, args: unknown[]): unknown {
  if (
    name === 'Add' ||
    name === 'Subtract' ||
    name === 'Multiply' ||
    name === 'Divide'
  ) {
    if (args.length !== 2) throw new Error('Add expects two arguments');
    const operator =
      name === 'Add'
        ? 'add'
        : name === 'Subtract'
          ? 'subtract'
          : name === 'Multiply'
            ? 'multiply'
            : 'divide';
    return valueOperation(args[0], args[1], operator);
  }
  if (name === 'GetColumn') {
    if (
      args.length !== 2 ||
      !Array.isArray(args[0]) ||
      typeof args[1] !== 'string'
    ) {
      throw new Error('GetColumn expects an array and column name');
    }
    const column = args[1];
    return (args[0] as unknown[]).map((row) =>
      isObjectRecord(row) ? row[column] : undefined,
    );
  }
  if (name === 'Sum') {
    if (args.length < 1 || args.length > 2 || !Array.isArray(args[0])) {
      throw new Error('Sum expects an array and optional default');
    }
    const values = args[0] as unknown[];
    if (values.length === 0) {
      return args[1] ?? 0;
    }
    return values.reduce((result, item) => valueOperation(result, item, 'add'));
  }
  if (name === 'If') {
    if (args.length !== 3)
      throw new Error('If expects a condition and two values');
    return liquidTruthy(args[0]) ? args[1] : args[2];
  }
  if (name === 'Exists') {
    if (args.length !== 1) throw new Error('Exists expects one value');
    return args[0] !== null && args[0] !== undefined;
  }
  if (name === 'And' || name === 'Or') {
    if (args.length < 2) throw new Error(`${name} expects at least two values`);
    return name === 'And' ? args.every(liquidTruthy) : args.some(liquidTruthy);
  }
  if (name === 'Not') {
    if (args.length !== 1) throw new Error('Not expects one value');
    return !liquidTruthy(args[0]);
  }
  if (name === 'Equals') {
    if (args.length !== 2) throw new Error('Equals expects two values');
    return compare(args[0], args[1], 'equal');
  }
  if (name === 'sumArray') {
    if (!Array.isArray(args[0])) throw new Error('Input is not an array');
    const values = args[0] as unknown[];
    if (args[1] !== undefined && typeof args[1] !== 'string')
      throw new Error('Invalid key for sumArray filter');
    const items =
      args[1] === undefined
        ? values
        : values.map((item) =>
            isObjectRecord(item) ? item[args[1] as string] : undefined,
          );
    if (items.length === 0) {
      return args[2] ?? 0;
    }
    return items.reduce((result, item) => valueOperation(result, item, 'add'));
  }
  if (name === 'updateAttribute' || name === 'updateTypeAttribute') {
    const attribute = name === 'updateTypeAttribute' ? 'type' : args[1];
    const replacement = name === 'updateTypeAttribute' ? args[1] : args[2];
    if (name === 'updateAttribute' && args.length !== 3)
      throw new Error('updateAttribute expects three arguments');
    if (name === 'updateTypeAttribute' && args.length !== 2)
      throw new Error('updateTypeAttribute expects two arguments');
    const key = String(attribute);
    if (args[0] === null || args[0] === undefined)
      return { [key]: replacement };
    if (isObjectRecord(args[0])) return { ...args[0], [key]: replacement };
    return null;
  }
  if (name === 'concat') {
    const a1 = Array.isArray(args[0])
      ? args[0]
      : args[0] == null
        ? []
        : [args[0]];
    const a2 = Array.isArray(args[1])
      ? args[1]
      : args[1] == null
        ? []
        : [args[1]];
    return (a1 as unknown[]).concat(a2 as unknown[]);
  }
  if (name === 'uniq') {
    if (!Array.isArray(args[0])) return [];
    return Array.from(new Set(args[0]));
  }
  if (name === 'strip') {
    return String(args[0] ?? '').trim();
  }
  if (name === 'strip_html') {
    return stripHtml(String(args[0] ?? ''));
  }
  if (args.length !== 2) throw new Error(`${name} expects two arguments`);
  const [value, type] = args;
  if (name === 'toCurrency') {
    if (!isValidNumber(value) || typeof type !== 'string')
      throw new Error('invalid currency value or type');
    return { value, type };
  }
  const normalizedType =
    typeof type === 'string' ? type.toUpperCase() : undefined;
  if (
    !isValidNumber(value) ||
    !normalizedType ||
    !durationTypes.has(normalizedType)
  ) {
    throw new Error('invalid duration value or type');
  }
  const multiplier =
    normalizedType === 'DAYS'
      ? 1
      : normalizedType === 'WEEKS'
        ? 7
        : normalizedType === 'MONTHS'
          ? 30
          : 365;
  return { value, type: normalizedType, days: Number(value) * multiplier };
}

function stripHtml(str: string): string {
  const blocks: [string, string][] = [
    ['<script', '</script>'],
    ['<style', '</style>'],
    ['<!--', '-->'],
    ['<', '>'],
  ];
  let out = '';
  let i = 0;
  while (i < str.length) {
    const lt = str.indexOf('<', i);
    if (lt < 0) return out + str.slice(i);
    out += str.slice(i, lt);
    let matched = false;
    for (const [opener, closer] of blocks) {
      if (str.startsWith(opener, lt)) {
        const e = str.indexOf(closer, lt + opener.length);
        if (e >= 0) {
          i = e + closer.length;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      const gt = str.indexOf('>', lt);
      if (gt >= 0) {
        i = gt + 1;
      } else {
        return out + str.slice(lt);
      }
    }
  }
  return out;
}

function compare(
  left: unknown,
  right: unknown,
  operator: Extract<ReferenceExpression, { kind: 'binary' }>['operator'],
): boolean {
  if (operator === 'equal') return left === right;
  if (operator === 'notEqual') return left !== right;
  if (
    left === null ||
    left === undefined ||
    right === null ||
    right === undefined
  )
    return false;
  const leftValue =
    isNumeric(left) && isNumeric(right) ? Number(left) : String(left);
  const rightValue =
    isNumeric(left) && isNumeric(right) ? Number(right) : String(right);
  if (operator === 'greater') return leftValue > rightValue;
  if (operator === 'less') return leftValue < rightValue;
  if (operator === 'greaterEqual') return leftValue >= rightValue;
  return leftValue <= rightValue;
}

function resolvePath(path: string[], values: Record<string, unknown>): unknown {
  let value: unknown = values;
  for (const segment of path) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function evaluateExpression(
  expression: ReferenceExpression,
  values: Record<string, unknown>,
): unknown {
  if (expression.kind === 'literal') return expression.value;
  if (expression.kind === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(expression.entries)) {
      result[k] = evaluateExpression(v, values);
    }
    return result;
  }
  if (expression.kind === 'array') {
    return expression.items.map((item) => evaluateExpression(item, values));
  }
  if (expression.kind === 'path') return resolvePath(expression.path, values);
  if (expression.kind === 'call') {
    return evaluateCall(
      expression.name,
      expression.arguments.map((argument) =>
        evaluateExpression(argument, values),
      ),
    );
  }
  const left = evaluateExpression(expression.left, values);
  const right = evaluateExpression(expression.right, values);
  if (
    expression.operator === 'equal' ||
    expression.operator === 'notEqual' ||
    expression.operator === 'greater' ||
    expression.operator === 'less' ||
    expression.operator === 'greaterEqual' ||
    expression.operator === 'lessEqual'
  ) {
    return compare(left, right, expression.operator);
  }
  return valueOperation(left, right, expression.operator);
}

function matchesFieldType(
  value: unknown,
  schema: ReferenceFieldSchema,
): boolean {
  if (value === null || value === undefined) return true;
  if (schema.type === 'currency') {
    return (
      isObjectRecord(value) &&
      isValidNumber(value.value) &&
      typeof value.type === 'string' &&
      (schema.currency === undefined || value.type === schema.currency)
    );
  }
  if (schema.type === 'duration') return isDuration(value);
  if (schema.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) return false;
    if (schema.minValue !== undefined && value < schema.minValue) return false;
    if (schema.maxValue !== undefined && value > schema.maxValue) return false;
    return true;
  }
  if (schema.type === 'date')
    return typeof value === 'string' || value instanceof Date;
  if (schema.type === 'dropdown') {
    if (typeof value !== 'string') return false;
    if (schema.options && !schema.options.some((opt) => opt.value === value))
      return false;
    return true;
  }
  if (schema.type === 'string') return typeof value === 'string';
  if (schema.type === 'repeating' || schema.type === 'table') {
    if (!Array.isArray(value)) return false;
    if (schema.attributes) {
      for (const row of value) {
        if (!isObjectRecord(row)) return false;
        for (const [attrName, attrSchema] of Object.entries(
          schema.attributes,
        )) {
          if (
            row[attrName] !== undefined &&
            !matchesFieldType(row[attrName], attrSchema)
          ) {
            return false;
          }
        }
      }
    }
    return true;
  }
  return true;
}

function validateAssignment(
  name: string,
  value: unknown,
  schemas: ReferenceFieldSchemas | undefined,
): void {
  const schema = schemas?.[name];
  if (schema && !matchesFieldType(value, schema)) {
    const expected =
      schema.type === 'currency' && schema.currency
        ? `currency ${schema.currency}`
        : schema.type;
    throw new Error(`Field ${name} expects ${expected}`);
  }
}

/**
 * Formats a raw computed or input value according to its schema format options.
 *
 * @param value - The value to format.
 * @param schema - Field schema metadata containing format options (precision, currency, prefix, etc.).
 * @returns Formatted display string.
 */
export function formatFieldValue(
  value: unknown,
  schema?: ReferenceFieldSchema,
): string {
  if (value === null || value === undefined) return '';
  if (!schema) {
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
  if (schema.type === 'currency' && isObjectRecord(value)) {
    const amount = Number(value.value ?? 0);
    const formattedAmount =
      schema.precision !== undefined
        ? amount.toFixed(schema.precision)
        : String(amount);
    const code =
      typeof value.type === 'string' ? value.type : (schema.currency ?? '');
    return schema.isIsoPrefixEnabled !== false && code
      ? `${code} ${formattedAmount}`
      : formattedAmount;
  }
  if (schema.type === 'duration' && isDuration(value)) {
    const val = value.value;
    const type =
      typeof value.type === 'string' ? value.type.toLowerCase() : 'days';
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
    return `${val} ${typeLabel}`;
  }
  if (schema.type === 'number' && typeof value === 'number') {
    return schema.precision !== undefined
      ? value.toFixed(schema.precision)
      : String(value);
  }
  if (schema.type === 'dropdown' && schema.options) {
    const matched = schema.options.find((opt) => opt.value === String(value));
    return matched ? matched.label : String(value);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function execute(
  statements: ReferenceStatement[],
  values: Record<string, unknown>,
  outputs: unknown[],
  schemas?: ReferenceFieldSchemas,
): void {
  for (const statement of statements) {
    if (statement.kind === 'assignment') {
      const value = evaluateExpression(statement.value, values);
      validateAssignment(statement.name, value, schemas);
      values[statement.name] = value;
    } else if (statement.kind === 'for') {
      const collection = evaluateExpression(statement.collection, values);
      if (Array.isArray(collection)) {
        for (const item of collection) {
          values[statement.variable] = item;
          execute(statement.body, values, outputs, schemas);
        }
      }
    } else if (statement.kind === 'computeColumn') {
      const rows = values[statement.table];
      if (!Array.isArray(rows)) continue;
      values[statement.table] = rows.map((row) => {
        if (typeof row !== 'object' || row === null || Array.isArray(row))
          return row;
        const rowValues: Record<string, unknown> = { ...values, self: row };
        execute(statement.body, rowValues, [], schemas);
        return Object.prototype.hasOwnProperty.call(rowValues, '$$answer')
          ? { ...row, [statement.column]: rowValues['$$answer'] }
          : row;
      });
    } else if (statement.kind === 'output') {
      outputs.push(evaluateExpression(statement.value, values));
    } else {
      const body = liquidTruthy(evaluateExpression(statement.condition, values))
        ? statement.then
        : statement.otherwise;
      execute(body, values, outputs, schemas);
    }
  }
}

/**
 * Parses reference language source code into an executable `ReferenceProgram` AST.
 *
 * @param source - Reference language source string.
 * @returns Parsed `ReferenceProgram` AST.
 */
export function parseReferenceProgram(source: string): ReferenceProgram {
  return new Parser(lex(source)).parse();
}

/**
 * Evaluates a `ReferenceProgram` AST against an input context and optional field schemas.
 *
 * @param program - Compiled `ReferenceProgram` AST.
 * @param input - Input variable values.
 * @param schemas - Optional field schema validation rules.
 * @returns Resulting variable scope after execution.
 */
export function evaluateReferenceProgram(
  program: ReferenceProgram,
  input: Record<string, unknown>,
  schemas?: ReferenceFieldSchemas,
): Record<string, unknown> {
  const values = { ...input };
  execute(program.statements, values, [], schemas);
  return values;
}

/**
 * Evaluates a `ReferenceProgram` AST and returns both mutated variable state and emitted outputs.
 *
 * @param program - Compiled `ReferenceProgram` AST.
 * @param input - Input variable values.
 * @param schemas - Optional field schema validation rules.
 * @returns Object containing final variable scope values and array of output values.
 */
export function evaluateReferenceProgramWithOutputs(
  program: ReferenceProgram,
  input: Record<string, unknown>,
  schemas?: ReferenceFieldSchemas,
): { values: Record<string, unknown>; outputs: unknown[] } {
  const values = { ...input };
  const outputs: unknown[] = [];
  execute(program.statements, values, outputs, schemas);
  return { values, outputs };
}
