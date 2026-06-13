import { DiagnosticSeverity, Range } from 'vscode-languageserver';
import type { Diagnostic } from 'vscode-languageserver';
import type { SchemaLoadError } from 'key-pointer-schema';

export function schemaLoadErrorsToDiagnostics(
  errors: SchemaLoadError[],
): Diagnostic[] {
  return errors.map((error) => ({
    severity:
      error.severity === 'error'
        ? DiagnosticSeverity.Error
        : DiagnosticSeverity.Warning,
    range: Range.create(0, 0, 0, 1),
    message: error.message,
    code: error.code,
    source: 'liquid-lsp',
  }));
}
