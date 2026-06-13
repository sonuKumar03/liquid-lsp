import type { Liquid, Token } from 'liquidjs';
import liquidjs from 'liquidjs';

export const { Tokenizer, TokenKind, TagToken: TagTokenClass } = liquidjs;

/** Tokenize a full template; throws if the Liquid tokenizer rejects input. */
export function tokenizeTopLevel(text: string, engine?: Liquid): Token[] {
  const tokenizer = new Tokenizer(text, engine?.options as any);
  return tokenizer.readTopLevelTokens();
}

/** Tokenize without throwing; returns an empty array on failure. */
export function tokenizeTopLevelSafe(text: string, engine?: Liquid): Token[] {
  try {
    return tokenizeTopLevel(text, engine);
  } catch {
    return [];
  }
}
