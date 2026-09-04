import { DiagnosticSeverity, Range } from 'vscode-languageserver';
import type { Diagnostic } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  extractComputationIR,
  type ComputationIRDocument,
  type ComputationIRNode,
  type ComputationIROutputNode,
  type ComputationIRTagNode,
} from 'liquid-core';
import type { LiquidType } from '../../shared/schema.js';
import { DIAGNOSTIC_CODES } from '../../shared/diagnostic-codes.js';

/**
 * Built-in Liquid literals, logical operators, and loop metadata identifiers
 * that should not be flagged as missing questionnaire schema variables.
 */
const BUILTIN_IDENTIFIERS = new Set([
  // Liquid Literals
  'true',
  'false',
  'nil',
  'null',
  'empty',
  'blank',

  // Date & Time keywords
  'now',
  'today',

  // Loop & iteration scope metadata
  'forloop',
  'tablerowloop',

  // Logical & expression keywords
  'and',
  'or',
  'not',
  'contains',
  'in',
  'with',
  'as',

  // SpotDraft computational runtime identifiers
  'self',
  '$$answer',
]);

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

  const activeScope = new Set<string>();

  function checkDependencies(
    node: ComputationIROutputNode | ComputationIRTagNode,
    scope: Set<string>,
  ): void {
    if (!globalSchema || globalSchema.size === 0) return;

    for (const dep of node.dependencies) {
      if (
        BUILTIN_IDENTIFIERS.has(dep) ||
        scope.has(dep) ||
        globalSchema.has(dep)
      ) {
        continue;
      }
      const matchingToken = node.expressionTokens.find((t) => t.text === dep);
      const range = matchingToken
        ? Range.create(
            doc.positionAt(matchingToken.source.start.offset),
            doc.positionAt(matchingToken.source.end.offset),
          )
        : Range.create(
            doc.positionAt(node.source.start.offset),
            doc.positionAt(node.source.end.offset),
          );

      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range,
        message: `"${dep}" is used before being defined or is missing from the schema.`,
        code: DIAGNOSTIC_CODES.USE_BEFORE_ASSIGN,
        source: 'liquid-lsp-computation',
      });
    }
  }

  function checkNode(node: ComputationIRNode, scope: Set<string>): void {
    if (node.kind === 'output') {
      checkDependencies(node, scope);
      return;
    }
    if (node.kind !== 'tag') return;

    const startPos = doc.positionAt(node.source.start.offset);
    const endPos = doc.positionAt(node.source.end.offset);

    // Validate assignments: check dependencies on RHS, then add target to scope
    if (
      node.name === 'assign' ||
      node.name === 'assignVar' ||
      node.name === 'parseAssign'
    ) {
      checkDependencies(node, scope);
      if (node.target) {
        scope.add(node.target);
      }
      return;
    }

    // Capture blocks: add captured variable identifier to scope
    if (node.name === 'capture') {
      const varName = node.args.trim().split(/\s+/)[0];
      if (varName) {
        scope.add(varName);
      }
      return;
    }

    // 1. Validate computeColumn tags
    if (node.name === 'computeColumn') {
      const args = node.args.trim();
      const parts = args.split(/\s+/).filter(Boolean);

      if (parts.length < 2) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: Range.create(startPos, endPos),
          message:
            'computeColumn requires both a table name and a target column name (e.g. {% computeColumn table column %}).',
          code: DIAGNOSTIC_CODES.INVALID_DYNAMIC_TABLE_COMPUTATION,
          source: 'liquid-lsp-computation',
        });
      } else {
        const [tableName] = parts;
        if (tableName && globalSchema && globalSchema.has(tableName)) {
          const tableType = globalSchema.get(tableName);
          const typeStr =
            typeof tableType === 'object' && tableType.kind === 'primitive'
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
          message:
            'Unclosed computeColumn tag. Expected {% endcomputeColumn %}.',
          code: DIAGNOSTIC_CODES.UNCLOSED_DELIMITER,
          source: 'liquid-lsp-computation',
        });
      }

      // Inside computeColumn, self and $$answer are valid
      const innerScope = new Set(scope);
      innerScope.add('self');
      innerScope.add('$$answer');

      if (node.children) {
        for (const child of node.children) {
          checkNode(child, innerScope);
        }
      }
      return;
    }

    // 2. Validate for loops
    if (node.name === 'for') {
      const args = node.args.trim();
      const inIndex = args.search(/\bin\b/);

      if (inIndex < 0) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: Range.create(startPos, endPos),
          message:
            'for loop requires an iterable collection (e.g. {% for item in items %}).',
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

      // Check collection expression dependencies
      checkDependencies(node, scope);

      const innerScope = new Set(scope);
      if (node.target) {
        innerScope.add(node.target);
      }

      if (node.children) {
        for (const child of node.children) {
          checkNode(child, innerScope);
        }
      }
      return;
    }

    // 3. Conditional blocks
    if (node.name === 'if' || node.name === 'unless' || node.name === 'elsif') {
      checkDependencies(node, scope);
      if (node.children) {
        for (const child of node.children) {
          checkNode(child, scope);
        }
      }
      return;
    }

    // General recursion for any other block tags
    if (node.children) {
      for (const child of node.children) {
        checkNode(child, scope);
      }
    }
  }

  for (const node of ir.nodes) {
    checkNode(node, activeScope);
  }
}
