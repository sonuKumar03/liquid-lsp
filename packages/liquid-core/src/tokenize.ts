import type { Liquid, Token } from 'liquidjs';
import liquidjs from 'liquidjs';

export const { Tokenizer, TokenKind, TagToken: TagTokenClass } = liquidjs;

export function tokenizeTopLevel(text: string, engine?: Liquid): Token[] {
  const tokenizer = new Tokenizer(text, engine?.options as any);
  return tokenizer.readTopLevelTokens();
}

export function tokenizeTopLevelSafe(text: string, engine?: Liquid): Token[] {
  try {
    return tokenizeTopLevel(text, engine);
  } catch {
    return [];
  }
}
