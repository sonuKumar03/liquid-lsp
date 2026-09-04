import { createToken, Lexer, EmbeddedActionsParser } from 'chevrotain';

// 1. Token Definitions
const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /\s+/,
  group: Lexer.SKIPPED,
});

const InKeyword = createToken({
  name: 'InKeyword',
  pattern: /\bin\b/,
});

const Identifier = createToken({
  name: 'Identifier',
  pattern: /[a-zA-Z_$][a-zA-Z0-9_$-]*/,
});

const Equals = createToken({
  name: 'Equals',
  pattern: /=/,
});

const StringLiteral = createToken({
  name: 'StringLiteral',
  pattern: /"[^"]*"|'[^']*'/,
});

const NumberLiteral = createToken({
  name: 'NumberLiteral',
  pattern: /-?\d+(?:\.\d+)?\b/,
});

const Pipe = createToken({
  name: 'Pipe',
  pattern: /\|/,
});

const Colon = createToken({
  name: 'Colon',
  pattern: /:/,
});

const Comma = createToken({
  name: 'Comma',
  pattern: /,/,
});

const OtherChar = createToken({
  name: 'OtherChar',
  pattern: /[^a-zA-Z0-9_$\s=|:,]+/,
});

// Order matters: InKeyword must precede Identifier
const allTokens = [
  WhiteSpace,
  InKeyword,
  StringLiteral,
  NumberLiteral,
  Identifier,
  Equals,
  Pipe,
  Colon,
  Comma,
  OtherChar,
];

export const TagLexer = new Lexer(allTokens);

// 2. Parser Definitions
class LiquidTagParser extends EmbeddedActionsParser {
  constructor() {
    super(allTokens, { recoveryEnabled: true });
    this.performSelfAnalysis();
  }

  public assignRule = this.RULE('assignRule', (inputStr: string) => {
    const keyToken = this.CONSUME(Identifier);
    this.CONSUME(Equals);

    // Grab the rest of the input string using the startOffset of the next token
    const nextTok = this.LA(1);
    let value = '';
    if (nextTok && nextTok.tokenType.name !== 'EOF') {
      value = inputStr.slice(nextTok.startOffset);
    }

    return {
      key: keyToken.image,
      keyStart: keyToken.startOffset,
      keyEnd:
        (keyToken.endOffset ??
          keyToken.startOffset + keyToken.image.length - 1) + 1,
      value: value.trim(),
    };
  });

  public captureRule = this.RULE('captureRule', () => {
    const keyToken = this.CONSUME(Identifier);
    return {
      key: keyToken.image,
      keyStart: keyToken.startOffset,
      keyEnd:
        (keyToken.endOffset ??
          keyToken.startOffset + keyToken.image.length - 1) + 1,
    };
  });

  public forRule = this.RULE('forRule', (inputStr: string) => {
    const keyToken = this.CONSUME(Identifier);
    this.CONSUME(InKeyword);

    const nextTok = this.LA(1);
    let collection = '';
    if (nextTok && nextTok.tokenType.name !== 'EOF') {
      collection = inputStr.slice(nextTok.startOffset);
    }

    return {
      key: keyToken.image,
      keyStart: keyToken.startOffset,
      keyEnd:
        (keyToken.endOffset ??
          keyToken.startOffset + keyToken.image.length - 1) + 1,
      collection: collection.trim(),
    };
  });
}

const parserInstance = new LiquidTagParser();

// 3. Exported Offset-Aware Parsing Helpers

export interface ParsedAssignWithOffsets {
  key: string;
  keyStart: number;
  keyEnd: number;
  value: string;
}

export function parseAssignKeyValueWithOffsets(
  args: string,
): ParsedAssignWithOffsets | null {
  const lexResult = TagLexer.tokenize(args);
  if (lexResult.errors.length > 0 && lexResult.tokens.length === 0) {
    return null;
  }
  parserInstance.input = lexResult.tokens;
  try {
    const result = parserInstance.assignRule(args);
    if (parserInstance.errors.length > 0) {
      // If we failed to parse the identifier or equals, return null
      const isCriticalError = parserInstance.errors.some(
        (err) =>
          err.name === 'MismatchedTokenException' &&
          err.context.ruleStack.includes('assignRule'),
      );
      if (isCriticalError) {
        return null;
      }
    }
    return result;
  } catch {
    return null;
  }
}

export interface ParsedCaptureWithOffsets {
  key: string;
  keyStart: number;
  keyEnd: number;
}

export function parseCaptureVariableWithOffsets(
  args: string,
): ParsedCaptureWithOffsets | null {
  const lexResult = TagLexer.tokenize(args);
  if (lexResult.errors.length > 0 && lexResult.tokens.length === 0) {
    return null;
  }
  parserInstance.input = lexResult.tokens;
  try {
    const result = parserInstance.captureRule();
    if (parserInstance.errors.length > 0) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

export interface ParsedForWithOffsets {
  key: string;
  keyStart: number;
  keyEnd: number;
  collection: string;
}

export function parseForLoopVariableWithOffsets(
  args: string,
): ParsedForWithOffsets | null {
  const lexResult = TagLexer.tokenize(args);
  if (lexResult.errors.length > 0 && lexResult.tokens.length === 0) {
    return null;
  }
  parserInstance.input = lexResult.tokens;
  try {
    const result = parserInstance.forRule(args);
    if (parserInstance.errors.length > 0) {
      const isCriticalError = parserInstance.errors.some(
        (err) =>
          err.name === 'MismatchedTokenException' &&
          err.context.ruleStack.includes('forRule'),
      );
      if (isCriticalError) {
        return null;
      }
    }
    return result;
  } catch {
    return null;
  }
}
