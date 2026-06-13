import { DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import type { Diagnostic } from 'vscode-languageserver/node';
import type { SchemaLoadError } from './key-pointer-schema.types.js';

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
