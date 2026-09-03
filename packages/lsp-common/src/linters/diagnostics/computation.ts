import { DiagnosticSeverity, Range } from 'vscode-languageserver';
import type { Diagnostic } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  extractComputationIR,
  type ComputationIRDocument,
  type ComputationIRNode,
} from 'liquid-core';
import type { LiquidType } from '../../shared/schema.js';
import { DIAGNOSTIC_CODES } from '../../shared/diagnostic-codes.js';

/**
 * Collects syntax and semantic diagnostics for computational Liquid templates using the Computation IR.
 *
 * @param doc - Text document being validated.
 * @param diagnostics - Accumulator array for LSP diagnostics.
 * @param globalSchema - Optional workspace / questionnaire schema.
 * @param precomputedIR - Optional pre-extracted IR document.
 */
export function collectComputationDiagnostics(
  doc: TextDocument,
  diagnostics: Diagnostic[],
  globalSchema?: Map<string, LiquidType>,
  precomputedIR?: ComputationIRDocument,
): void {
  const text = doc.getText();
  const ir = precomputedIR ?? extractComputationIR(text);

  function checkNode(node: ComputationIRNode): void {
    if (node.kind !== 'tag') return;

    const startPos = doc.positionAt(node.source.start.offset);
    const endPos = doc.positionAt(node.source.end.offset);

    // 1. Validate computeColumn tags
    if (node.name === 'computeColumn') {
      const args = node.args.trim();
      const parts = args.split(/\s+/).filter(Boolean);

      if (parts.length < 2) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: Range.create(startPos, endPos),
          message: 'computeColumn requires both a table name and a target column name (e.g. {% computeColumn table column %}).',
          code: DIAGNOSTIC_CODES.INVALID_DYNAMIC_TABLE_COMPUTATION,
          source: 'liquid-lsp-computation',
        });
      } else {
        const [tableName] = parts;
        if (tableName && globalSchema && globalSchema.has(tableName)) {
          const tableType = globalSchema.get(tableName);
          const typeStr = typeof tableType === 'object' && tableType.kind === 'primitive'
            ? tableType.type
            : typeof tableType === 'string'
              ? tableType
              : typeof tableType === 'object'
                ? tableType.kind
                : 'unknown';

          if (
            typeStr === 'number' ||
            typeStr === 'string' ||
            typeStr === 'boolean' ||
            typeStr === 'currency' ||
            typeStr === 'date'
          ) {
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              range: Range.create(startPos, endPos),
              message: `Cannot compute column on "${tableName}" because it is a ${typeStr}, not a table or list of rows.`,
              code: DIAGNOSTIC_CODES.INVALID_DYNAMIC_TABLE_COMPUTATION,
              source: 'liquid-lsp-computation',
            });
          }
        }
      }

      // Check for unclosed computeColumn block
      if (node.closing === undefined) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: Range.create(startPos, endPos),
          message: 'Unclosed computeColumn tag. Expected {% endcomputeColumn %}.',
          code: DIAGNOSTIC_CODES.UNCLOSED_DELIMITER,
          source: 'liquid-lsp-computation',
        });
      }
    }

    // 2. Validate for loops
    if (node.name === 'for') {
      const args = node.args.trim();
      const inIndex = args.search(/\bin\b/);

      if (inIndex < 0) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: Range.create(startPos, endPos),
          message: 'for loop requires an iterable collection (e.g. {% for item in items %}).',
          code: DIAGNOSTIC_CODES.UNKNOWN_TAG,
          source: 'liquid-lsp-computation',
        });
      }

      if (node.closing === undefined) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: Range.create(startPos, endPos),
          message: 'Unclosed for loop tag. Expected {% endfor %}.',
          code: DIAGNOSTIC_CODES.UNCLOSED_DELIMITER,
          source: 'liquid-lsp-computation',
        });
      }
    }

    // 3. Recurse into children
    if (node.children) {
      for (const child of node.children) {
        checkNode(child);
      }
    }
  }

  for (const node of ir.nodes) {
    checkNode(node);
  }
}
