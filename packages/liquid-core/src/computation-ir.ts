import { createLiquidEngine, type TopLevelToken } from './engine.js';
import {
  TagTokenClass,
  TokenKind,
  Tokenizer,
  tokenizeTopLevelSafe,
} from './tokenize.js';
import type {
  ComputationIRDocument,
  ComputationIRError,
  ComputationIRExpressionToken,
  ComputationIRFilter,
  ComputationIRNode,
  ComputationIRPosition,
  ComputationIRSource,
  ComputationIRTagNode,
} from 'computation-ir';

export type {
  ComputationIRClosingTag,
  ComputationIRDocument,
  ComputationIRError,
  ComputationIRExpressionToken,
  ComputationIRFilter,
  ComputationIRNode,
  ComputationIROriginal,
  ComputationIROutputNode,
  ComputationIRPosition,
  ComputationIRSource,
  ComputationIRTagNode,
  ComputationIRTextNode,
} from 'computation-ir';

/**
 * Set of Liquid tag names that open hierarchical blocks requiring an `{% end<tag> %}` terminator.
 */
const BLOCK_TAGS = new Set([
  'if',
  'unless',
  'for',
  'case',
  'capture',
  'comment',
  'raw',
  'computeColumn',
  'tablerow',
]);

/**
 * Calculates zero-based line and column coordinates for a character offset in the source.
 *
 * @param source - Full source text.
 * @param offset - Zero-based character offset.
 * @returns Coordinates object with offset, line, and column.
 */
function positionAt(source: string, offset: number): ComputationIRPosition {
  let line = 0;
  let column = 0;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === '\n') {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { offset, line, column };
}

/**
 * Computes a start/end source range span for a given slice of characters.
 *
 * @param source - Full source text.
 * @param begin - Inclusive start offset.
 * @param end - Exclusive end offset.
 * @returns Source range object.
 */
function sourceRange(
  source: string,
  begin: number,
  end: number,
): ComputationIRSource {
  return { start: positionAt(source, begin), end: positionAt(source, end) };
}

/**
 * Formats unknown error objects into clean error message strings.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Statically extracts identifier dependencies (read variables) referenced in an expression.
 *
 * @param expression - Expression text to analyze.
 * @param engine - Liquid engine instance.
 * @returns Array of unique variable names read by the expression.
 */
function dependenciesFor(
  expression: string,
  engine: ReturnType<typeof createLiquidEngine>,
): string[] {
  try {
    return Array.from(new Set(engine.variablesSync(`{{ ${expression} }}`)));
  } catch {
    return [];
  }
}

/**
 * Tokenizes the terms in an expression and attaches absolute source range spans.
 *
 * @param expression - Expression string.
 * @param expressionStart - Absolute start offset of the expression in the full source.
 * @param source - Full source text.
 * @returns Array of expression token descriptors.
 */
function expressionTokens(
  expression: string,
  expressionStart: number,
  source: string,
): ComputationIRExpressionToken[] {
  try {
    return Array.from(
      new Tokenizer(expression).readExpressionTokens(),
      (token) => ({
        text: token.getText(),
        source: sourceRange(
          source,
          expressionStart + token.begin,
          expressionStart + token.end,
        ),
      }),
    );
  } catch {
    return [];
  }
}

/**
 * Extracts filter clauses from a pipeline expression (e.g. `| toCurrency: "EUR"`).
 *
 * @param expression - Expression string containing optional filters.
 * @param expressionStart - Absolute start offset of the expression in the full source.
 * @param source - Full source text.
 * @param engine - Liquid engine instance.
 * @returns Array of parsed filter descriptors.
 */
function expressionFilters(
  expression: string,
  expressionStart: number,
  source: string,
  engine: ReturnType<typeof createLiquidEngine>,
): ComputationIRFilter[] {
  if (expressionStart < 0) return [];
  try {
    const tokenizer = new Tokenizer(expression, engine.options);
    Array.from(tokenizer.readExpressionTokens());
    return tokenizer.readFilters().map((filter) => ({
      name: filter.name,
      raw: filter.getText(),
      source: sourceRange(
        source,
        expressionStart + filter.begin,
        expressionStart + filter.end,
      ),
    }));
  } catch {
    return [];
  }
}

/**
 * Extracts the value expression portion from tag arguments.
 *
 * @param name - Tag name.
 * @param args - Tag arguments string.
 * @returns Value or collection expression.
 */
function tagExpression(name: string, args: string): string {
  if (name === 'assign' || name === 'assignVar' || name === 'parseAssign') {
    const equals = args.indexOf('=');
    return equals >= 0 ? args.slice(equals + 1).trim() : '';
  }
  if (name === 'for') {
    const inIndex = args.search(/\bin\b/);
    return inIndex >= 0 ? args.slice(inIndex + 2).trim() : '';
  }
  return args;
}

/**
 * Extracts the target variable identifier for assignments and loop constructs.
 *
 * @param name - Tag name.
 * @param args - Tag arguments string.
 * @returns Target variable identifier or undefined.
 */
function assignmentTarget(name: string, args: string): string | undefined {
  if (name === 'for') {
    const inIndex = args.search(/\bin\b/);
    return (inIndex >= 0 ? args.slice(0, inIndex) : args).trim() || undefined;
  }
  if (name !== 'assign' && name !== 'assignVar' && name !== 'parseAssign')
    return undefined;
  const equals = args.indexOf('=');
  const target = (equals >= 0 ? args.slice(0, equals) : args).trim();
  return target || undefined;
}

/**
 * Appends a node to the active block parent on the stack, or to the root node list.
 */
function addNode(
  roots: ComputationIRNode[],
  stack: ComputationIRTagNode[],
  node: ComputationIRNode,
): void {
  const parent = stack.at(-1);
  if (parent) {
    (parent.children ??= []).push(node);
  } else {
    roots.push(node);
  }
}

/**
 * Constructs an IR node from a top-level Liquid template token.
 */
function nodeFromToken(
  source: string,
  token: TopLevelToken,
  engine: ReturnType<typeof createLiquidEngine>,
): ComputationIRNode {
  const text = token.getText();
  const range = sourceRange(source, token.begin, token.end);
  if (token.kind === TokenKind.Output) {
    const expression = text.slice(2, -2).trim();
    const expressionStart = token.begin + text.indexOf(expression);
    return {
      kind: 'output',
      expression,
      expressionTokens: expressionTokens(expression, expressionStart, source),
      filters: expressionFilters(expression, expressionStart, source, engine),
      dependencies: dependenciesFor(expression, engine),
      source: range,
      original: { dialect: 'liquidjs-computation', kind: 'output', text },
    };
  }
  if (token instanceof TagTokenClass) {
    const expression = tagExpression(token.name, token.args);
    const expressionStart = token.begin + text.indexOf(expression);
    const target = assignmentTarget(token.name, token.args);
    return {
      kind: 'tag',
      name: token.name,
      ...(target ? { target } : {}),
      args: token.args,
      expression,
      expressionTokens: expressionTokens(expression, expressionStart, source),
      filters: expressionFilters(expression, expressionStart, source, engine),
      dependencies: dependenciesFor(expression, engine),
      source: range,
      original: { dialect: 'liquidjs-computation', kind: 'tag', text },
    };
  }
  return {
    kind: 'text',
    text,
    source: range,
    original: { dialect: 'liquidjs-computation', kind: 'text', text },
  };
}

/**
 * Parses Liquid source text into a portable, structured `ComputationIRDocument`.
 *
 * Extracts hierarchical AST nodes, explicit assignment targets, filter pipelines,
 * variable read dependencies, and accurate source coordinate spans.
 *
 * @param source - Raw Liquid computation template source string.
 * @returns A JSON-serializable `ComputationIRDocument` representation.
 */
export function extractComputationIR(source: string): ComputationIRDocument {
  const engine = createLiquidEngine();
  const errors: ComputationIRError[] = [];
  try {
    engine.parse(source);
  } catch (error) {
    errors.push({ phase: 'parse', message: errorMessage(error) });
  }

  const roots: ComputationIRNode[] = [];
  const stack: ComputationIRTagNode[] = [];
  for (const token of tokenizeTopLevelSafe(source, engine)) {
    if (token instanceof TagTokenClass && token.name.startsWith('end')) {
      const parent = stack.at(-1);
      if (parent && `end${parent.name}` === token.name) {
        parent.closing = {
          name: token.name,
          source: sourceRange(source, token.begin, token.end),
          original: {
            dialect: 'liquidjs-computation',
            kind: 'tag',
            text: token.getText(),
          },
        };
        parent.source = sourceRange(
          source,
          parent.source.start.offset,
          token.end,
        );
        stack.pop();
        continue;
      }
    }

    const node = nodeFromToken(source, token, engine);
    addNode(roots, stack, node);
    if (node.kind === 'tag' && BLOCK_TAGS.has(node.name)) {
      node.children = [];
      stack.push(node);
    }
  }

  return {
    format: 'computation-interchange',
    version: '1',
    language: 'liquidjs-computation',
    source,
    nodes: roots,
    errors,
  };
}
