import type { TextDocument } from 'vscode-languageserver-textdocument';

export class DiagnosticsScheduler {
  private readonly pendingValidationTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly validateDocument: (document: TextDocument) => void,
    private readonly debounceMs = 150,
  ) {}

  schedule(document: TextDocument): void {
    const uri = document.uri;
    const existingTimer = this.pendingValidationTimers.get(uri);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const newTimer = setTimeout(() => {
      this.validateDocument(document);
      this.pendingValidationTimers.delete(uri);
    }, this.debounceMs);

    this.pendingValidationTimers.set(uri, newTimer);
  }

  validateAll(documents: TextDocument[]): void {
    for (const doc of documents) {
      this.validateDocument(doc);
    }
  }

  clear(uri: string): void {
    const timer = this.pendingValidationTimers.get(uri);
    if (timer) {
      clearTimeout(timer);
      this.pendingValidationTimers.delete(uri);
    }
  }
}
