import {
  Tokenizer,
  LiteralToken,
  NumberToken,
  QuotedToken,
  PropertyAccessToken,
  RangeToken,
  evalQuotedToken,
} from 'liquidjs';

function isLiteral(str: string): boolean {
  try {
    const tokenizer = new Tokenizer(str);
    const val = tokenizer.readValue();
    if (!val || tokenizer.p < tokenizer.N) return false;
    return (
      val instanceof LiteralToken ||
      val instanceof NumberToken ||
      val instanceof QuotedToken
    );
  } catch {
    return false;
  }
}

function isVariable(str: string): boolean {
  try {
    const tokenizer = new Tokenizer(str);
    const val = tokenizer.readValue();
    if (!val || tokenizer.p < tokenizer.N) return false;
    return val instanceof PropertyAccessToken;
  } catch {
    return false;
  }
}

function parseLiteral(str: string): string | number | boolean {
  const tokenizer = new Tokenizer(str);
  const val = tokenizer.readValue();
  if (!val || tokenizer.p < tokenizer.N) {
    throw new TypeError(`cannot parse '${str}' as literal`);
  }
  if (val instanceof NumberToken) {
    return Number(val.getText());
  }
  if (val instanceof LiteralToken) {
    const txt = val.getText();
    if (txt === 'true') return true;
    if (txt === 'false') return false;
    throw new TypeError(`cannot parse '${str}' as literal`);
  }
  if (val instanceof QuotedToken) {
    return evalQuotedToken(val);
  }
  throw new TypeError(`cannot parse '${str}' as literal`);
}

function isRange(str: string): boolean {
  try {
    const tokenizer = new Tokenizer(str);
    const val = tokenizer.readValue();
    if (!val || tokenizer.p < tokenizer.N) return false;
    return val instanceof RangeToken;
  } catch {
    return false;
  }
}

function isInteger(str: string): boolean {
  try {
    const tokenizer = new Tokenizer(str);
    const val = tokenizer.readValue();
    if (!val || tokenizer.p < tokenizer.N) return false;
    return val instanceof NumberToken && !val.getText().includes('.');
  } catch {
    return false;
  }
}

export const lexical = {
  isLiteral,
  isVariable,
  parseLiteral,
  isRange,
  isInteger,
};
