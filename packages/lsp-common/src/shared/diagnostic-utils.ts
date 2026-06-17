import type { Diagnostic } from 'vscode-languageserver';

/**
 * Pushes a diagnostic only if it isn't a duplicate of an existing diagnostic on the same start line, character, and message.
 */
export function pushUniqueDiagnostic(
  diagnostics: Diagnostic[],
  diagnostic: Diagnostic,
): void {
  const isDuplicate = diagnostics.some(
    (d) =>
      d.range.start.line === diagnostic.range.start.line &&
      d.range.start.character === diagnostic.range.start.character &&
      d.message === diagnostic.message,
  );
  if (!isDuplicate) {
    diagnostics.push(diagnostic);
  }
}
