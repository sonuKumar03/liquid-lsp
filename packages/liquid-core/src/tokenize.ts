import {
  Tokenizer,
  TokenKind,
  TagToken as TagTokenClass,
  type Liquid,
  type TopLevelToken,
  defaultOptions,
} from 'liquidjs';
export { Tokenizer, TokenKind, TagTokenClass };

/** Tokenize a full template; throws if the Liquid tokenizer rejects input. */
export function tokenizeTopLevel(text: string, engine?: Liquid): TopLevelToken[] {
  const tokenizer = new Tokenizer(text, engine?.options);
  return tokenizer.readTopLevelTokens(engine?.options);
}

/** Tokenize without throwing; returns an empty array on failure. */
export function tokenizeTopLevelSafe(text: string, engine?: Liquid): TopLevelToken[] {
  try {
    return tokenizeTopLevel(text, engine);
  } catch {
    const tokenizer = new Tokenizer(text, engine?.options);
    const tokens: TopLevelToken[] = [];
    while (tokenizer.p < tokenizer.N) {
      try {
        const token = tokenizer.readTopLevelToken(engine?.options ?? defaultOptions);
        tokens.push(token);
      } catch {
        break;
      }
    }
    return tokens;
  }
}
