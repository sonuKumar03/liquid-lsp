/**
 * Represents a specific character position in the original source code.
 */
export interface ComputationIRPosition {
  /** Zero-based character offset from the start of the source document. */
  offset: number;
  /** Zero-based line number. */
  line: number;
  /** Zero-based column number within the line. */
  column: number;
}

/**
 * Represents a source range span with start and end positions.
 */
export interface ComputationIRSource {
  /** Start position of the source span (inclusive). */
  start: ComputationIRPosition;
  /** End position of the source span (exclusive). */
  end: ComputationIRPosition;
}

/**
 * Raw original source snippet and dialect information.
 */
export interface ComputationIROriginal {
  /** Dialect of the original source template. */
  dialect: 'liquidjs-computation';
  /** Node kind of the original template construct. */
  kind: 'tag' | 'output' | 'text';
  /** Verbatim text representation in the source. */
  text: string;
}

/**
 * A tokenized segment of an expression with its source coordinates.
 */
export interface ComputationIRExpressionToken {
  /** Token text content. */
  text: string;
  /** Source span of the token. */
  source: ComputationIRSource;
}

/**
 * A single filter applied in an expression pipeline (e.g. `| plus: 100`).
 */
export interface ComputationIRFilter {
  /** Normalized name of the filter (e.g., 'plus', 'toCurrency', 'sumArray'). */
  name: string;
  /** Verbatim raw filter argument string from the source. */
  raw: string;
  /** Source span of the filter clause. */
  source: ComputationIRSource;
}

/**
 * Information about a block tag's closing tag (e.g. `{% endcomputeColumn %}`).
 */
export interface ComputationIRClosingTag {
  /** Closing tag name. */
  name: string;
  /** Source span of the closing tag. */
  source: ComputationIRSource;
  /** Original verbatim text of the closing tag. */
  original: ComputationIROriginal;
}

/**
 * An output expression node (e.g. `{{ total.value }}`).
 */
export interface ComputationIROutputNode {
  kind: 'output';
  /** The expression being output. */
  expression: string;
  /** Tokenized expression components. */
  expressionTokens: ComputationIRExpressionToken[];
  /** Filter pipeline applied to the output. */
  filters: ComputationIRFilter[];
  /** Variable identifiers read by this output expression. */
  dependencies: string[];
  /** Source span of the output construct. */
  source: ComputationIRSource;
  /** Original source snippet. */
  original: ComputationIROriginal;
}

/**
 * A verbatim text or whitespace node between tags.
 */
export interface ComputationIRTextNode {
  kind: 'text';
  /** Text content. */
  text: string;
  /** Source span of the text chunk. */
  source: ComputationIRSource;
  /** Original source snippet. */
  original: ComputationIROriginal;
}

/**
 * A computation tag node (e.g. `assign`, `assignVar`, `parseAssign`, `computeColumn`, `for`, `if`).
 */
export interface ComputationIRTagNode {
  kind: 'tag';
  /** Tag name (e.g., 'assign', 'computeColumn', 'for', 'if', 'else', 'elsif'). */
  name: string;
  /** Normalized target variable identifier for assignments and loop variables. */
  target?: string;
  /** Verbatim argument string of the tag. */
  args: string;
  /** Extracted value expression or collection expression. */
  expression: string;
  /** Tokenized expression components. */
  expressionTokens: ComputationIRExpressionToken[];
  /** Filter pipeline applied to the expression. */
  filters: ComputationIRFilter[];
  /** Variable identifiers read by this tag. */
  dependencies: string[];
  /** Child nodes for block tags (e.g. `computeColumn`, `for`, `if`). */
  children?: ComputationIRNode[];
  /** Closing tag information for block tags. */
  closing?: ComputationIRClosingTag;
  /** Source span of the entire tag construct (including children and closing tag if applicable). */
  source: ComputationIRSource;
  /** Original opening tag source snippet. */
  original: ComputationIROriginal;
}

/**
 * Union of all nodes representable in a Computation IR AST.
 */
export type ComputationIRNode =
  | ComputationIROutputNode
  | ComputationIRTagNode
  | ComputationIRTextNode;

/**
 * A syntax or parsing error encountered during extraction.
 */
export interface ComputationIRError {
  /** Phase in which the error occurred. */
  phase: 'parse';
  /** Human-readable error description. */
  message: string;
}

/**
 * Root document container for a portable Computation Intermediate Representation.
 */
export interface ComputationIRDocument {
  /** Format identifier for portable interchange. */
  format: 'computation-interchange';
  /** Schema format version. */
  version: '1';
  /** Source language dialect. */
  language: 'liquidjs-computation';
  /** Original raw source document text. */
  source: string;
  /** Top-level AST nodes. */
  nodes: ComputationIRNode[];
  /** Parsing errors encountered during extraction, if any. */
  errors: ComputationIRError[];
}

export * from './expressions.js';
export * from './cfg.js';
export * from './optimizer.js';

