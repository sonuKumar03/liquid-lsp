import type { Connection } from 'vscode-languageserver';
import { TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  tokenizeTopLevelSafe,
  type Liquid,
  type Token,
} from 'liquid-core';

interface TokenCacheEntry {
  revision: number;
  tokens: Token[];
}

export class DocumentManager {
  private readonly tokenCache = new Map<string, TokenCacheEntry>();
  readonly documents = new TextDocuments(TextDocument);

  constructor(private readonly connection: Connection) {
    this.documents.onDidChangeContent((change) => {
      this.tokenCache.delete(change.document.uri);
    });
  }

  getTokens(uri: string, engine: Liquid): Token[] {
    const doc = this.documents.get(uri);
    if (!doc) {
      return [];
    }

    const cached = this.tokenCache.get(uri);
    if (cached && cached.revision === doc.version) {
      return cached.tokens;
    }

    const tokens = tokenizeTopLevelSafe(doc.getText(), engine);
    this.tokenCache.set(uri, { revision: doc.version, tokens });
    return tokens;
  }

  listen(): void {
    this.documents.listen(this.connection);
  }
}
