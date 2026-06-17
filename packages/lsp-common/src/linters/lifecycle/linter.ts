import { DiagnosticSeverity, Range } from 'vscode-languageserver';
import type { Diagnostic } from 'vscode-languageserver';
import type { Liquid, Token, TopLevelToken, TagToken } from 'liquid-core';
import {
  TokenKind,
  TagTokenClass,
  tokenizeTopLevel,
  isConditionalTagLine,
  parseAssignKeyValueWithOffsets,
  parseCaptureVariableWithOffsets,
  parseForLoopVariableWithOffsets,
} from 'liquid-core';
import { resolveTypeForPath } from '../../hovers/hovers.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { LiquidType } from '../../shared/schema.js';
import type { VariableDeclaration } from 'key-pointer-schema';
import { findVariableDeclarations } from '../../shared/variable-declarations.js';
import { DIAGNOSTIC_CODES } from '../../shared/diagnostic-codes.js';
import {
  type ActiveVar,
  type LinterVariableType,
  isOptionalType,
} from '../../shared/linter-types.js';
import { ScopeTracker } from './scope.js';
import {
  processExpression,
  processParseAssignExpression,
  validateDropdownValue,
  validateNonComputableSchemaAssignment,
} from './type-inferrer.js';

function populateSchemaVars(
  activeVars: Map<string, ActiveVar>,
  globalSchema?: Map<string, LiquidType>,
): void {
  if (!globalSchema) return;

  for (const [k, v] of globalSchema.entries()) {
    activeVars.set(k, {
      declRange: Range.create(0, 0, 0, 0),
      line: -1,
      hasBeenRead: true,
      type: v,
    });
  }
}

function collectTagDiagnostics(
  doc: TextDocument,
  diagnostics: Diagnostic[],
  token: TagToken,
  scopeTracker: ScopeTracker,
  line: number,
  engine: Liquid,
  schemaVariables?: Map<string, VariableDeclaration>,
): void {
  const tokenText = token.getText();
  const name = token.name;

  if (name === 'assign' || name === 'assignVar' || name === 'parseAssign') {
    const parsed = parseAssignKeyValueWithOffsets(token.args);
    if (parsed) {
      const varName = parsed.key;
      const expr = parsed.value;
      const prev = scopeTracker.activeVars.get(varName);
      const argsOffset = tokenText.indexOf(token.args);
      const absOffset = (argsOffset >= 0 ? argsOffset : 0) + parsed.keyStart;

      validateNonComputableSchemaAssignment(
        doc,
        diagnostics,
        token,
        varName,
        absOffset,
        schemaVariables,
      );

      const inferredType =
        name === 'parseAssign'
          ? processParseAssignExpression(
              expr,
              token,
              doc,
              diagnostics,
              scopeTracker.activeVars,
              engine,
            )
          : processExpression(
              expr,
              token,
              doc,
              diagnostics,
              scopeTracker.activeVars,
              engine,
            );

      scopeTracker.declareVariable(varName, line, token, absOffset, inferredType);

      validateDropdownValue(
        doc,
        diagnostics,
        prev,
        varName,
        expr,
        token.begin,
        token.end,
      );
    }
  } else if (name === 'capture') {
    const parsed = parseCaptureVariableWithOffsets(token.args);
    if (parsed) {
      const varName = parsed.key;
      const argsOffset = tokenText.indexOf(token.args);
      const absOffset = (argsOffset >= 0 ? argsOffset : 0) + parsed.keyStart;

      const inferredType = 'string';
      scopeTracker.declareVariable(varName, line, token, absOffset, inferredType);
    }
  } else if (name === 'for') {
    const parsed = parseForLoopVariableWithOffsets(token.args);
    if (parsed) {
      const varName = parsed.key;
      const collectionExpr = parsed.collection;
      const argsOffset = tokenText.indexOf(token.args);
      const absOffset = (argsOffset >= 0 ? argsOffset : 0) + parsed.keyStart;

      if (collectionExpr) {
        processExpression(
          collectionExpr,
          token,
          doc,
          diagnostics,
          scopeTracker.activeVars,
          engine,
        );
      }

      // Infer loop variable type from collection expression type if it's a composite
      let inferredType: LiquidType = 'unknown';
      if (collectionExpr) {
        const activeVarsTypes = new Map<string, LiquidType>();
        for (const [k, v] of scopeTracker.activeVars.entries()) {
          const t = v.type;
          if (t && typeof t === 'object' && t.kind === 'branch_mismatch') {
            activeVarsTypes.set(k, t.types[0] || 'unknown');
          } else {
            activeVarsTypes.set(k, t);
          }
        }
        const resolved = resolveTypeForPath(collectionExpr, activeVarsTypes);
        if (
          resolved &&
          typeof resolved === 'object' &&
          resolved.kind === 'composite'
        ) {
          inferredType = resolved;
        }
      }

      scopeTracker.declareVariable(varName, line, token, absOffset, inferredType);
    }
  } else if (isConditionalTagLine(name)) {
    processExpression(token.args, token, doc, diagnostics, scopeTracker.activeVars, engine);
  }
}

function checkUnusedVariables(
  textDocument: TextDocument,
  diagnostics: Diagnostic[],
  tokens?: Token[],
): void {
  const docText = textDocument.getText();
  const declarations = findVariableDeclarations(textDocument, tokens);

  if (declarations.length === 0) return;

  let cleanText = docText.replace(
    /\{%\s*comment\s*%\}.*?\{%\s*endcomment\s*%\}/gs,
    '',
  );
  cleanText = cleanText.replace(/"[^"]*"/g, '');
  cleanText = cleanText.replace(/'[^']*'/g, '');

  for (const decl of declarations) {
    const name = decl.name;
    const occurrences = cleanText.match(new RegExp(`\\b${name}\\b`, 'g')) || [];
    const totalCount = occurrences.length;
    const assignMatches =
      cleanText.match(
        new RegExp(
          `\\{%\\s*(assign|assignVar|parseAssign)\\s+${name}\\s*=`,
          'g',
        ),
      ) || [];
    const captureMatches =
      cleanText.match(new RegExp(`\\{%\\s*capture\\s+${name}\\s*%\\}`, 'g')) ||
      [];
    const forMatches =
      cleanText.match(new RegExp(`\\{%\\s*for\\s+${name}\\s+in\\b`, 'g')) || [];
    const declCount =
      assignMatches.length + captureMatches.length + forMatches.length;

    // Count self-references on the RHS of assignments to this variable
    const assignTags =
      cleanText.match(
        new RegExp(
          `\\{%\\s*(assign|assignVar|parseAssign)\\s+${name}\\s*=[^%]*%\\}`,
          'g',
        ),
      ) || [];
    let selfReadCount = 0;
    for (const tag of assignTags) {
      const eqIdx = tag.indexOf('=');
      if (eqIdx !== -1) {
        const rhs = tag.slice(eqIdx + 1);
        const rhsOccurrences =
          rhs.match(new RegExp(`\\b${name}\\b`, 'g')) || [];
        selfReadCount += rhsOccurrences.length;
      }
    }

    if (totalCount === declCount + selfReadCount) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: decl.range,
        message: `You created "${name}" but never read it anywhere. If it isn't needed, you can delete this line.`,
        code: DIAGNOSTIC_CODES.UNUSED_VARIABLE,
        source: 'liquid-lsp-linter',
      });
    }
  }
}

export function collectLifecycleDiagnostics(
  textDocument: TextDocument,
  diagnostics: Diagnostic[],
  liquidEngine: Liquid,
  globalSchema?: Map<string, LiquidType>,
  schemaVariables?: Map<string, VariableDeclaration>,
  precomputedTokens?: TopLevelToken[],
): void {
  const text = textDocument.getText();
  let tokens: TopLevelToken[];

  try {
    tokens =
      precomputedTokens !== undefined
        ? precomputedTokens
        : tokenizeTopLevel(text, liquidEngine);

    const scopeTracker = new ScopeTracker(textDocument, diagnostics);
    populateSchemaVars(scopeTracker.activeVars, globalSchema);

    for (const token of tokens) {
      const line = textDocument.positionAt(token.begin).line;
      if (token instanceof TagTokenClass) {
        const tagName = token.name;
        if (tagName === 'if' || tagName === 'unless') {
          scopeTracker.enterBlock();
        } else if (tagName === 'else' || tagName === 'elsif') {
          scopeTracker.nextBranch();
        } else if (tagName === 'endif' || tagName === 'endunless') {
          const block = scopeTracker.exitBlock();
          if (block) {
            const allAssignedVars = new Set<string>();
            for (const branch of block.branches) {
              for (const varName of branch.keys()) {
                allAssignedVars.add(varName);
              }
            }

            for (const varName of allAssignedVars) {
              const assignedBranches = block.branches
                .map((b, idx) => ({ idx, info: b.get(varName) }))
                .filter((b) => b.info !== undefined);

              const first = assignedBranches[0]?.info;
              if (first) {
                let mismatch = false;
                for (let j = 1; j < assignedBranches.length; j++) {
                  const curr = assignedBranches[j]?.info;
                  if (curr && JSON.stringify(curr.type) !== JSON.stringify(first.type)) {
                    mismatch = true;
                    break;
                  }
                }

                const existing = scopeTracker.activeVars.get(varName);
                const hasBeenRead = existing ? existing.hasBeenRead : false;

                if (mismatch) {
                  const types = assignedBranches.map((b) => {
                    const t = b.info!.type;
                    if (t && typeof t === 'object' && t.kind === 'branch_mismatch') {
                      return t.types[0] || 'unknown';
                    }
                    return t;
                  });
                  const lines = assignedBranches.map((b) => b.info!.line);
                  const ranges = assignedBranches.map((b) => b.info!.range);

                  const formatType = (t: LinterVariableType): string => {
                    if (typeof t === 'string') return t;
                    if (t && typeof t === 'object') {
                      if (t.kind === 'branch_mismatch') return 'branch_mismatch';
                      if (t.kind === 'primitive') return t.type + (t.optional ? '?' : '');
                      if (t.kind === 'dropdown') return 'dropdown';
                      if (t.kind === 'composite') return 'composite';
                    }
                    return 'unknown';
                  };

                  const typeStrings = types.map(formatType);

                  for (let j = 0; j < assignedBranches.length; j++) {
                    const info = assignedBranches[j]!.info!;
                    const currentTypeStr = typeStrings[j] || 'unknown';
                    const otherTypes = typeStrings.filter((_, idx) => idx !== j);
                    const uniqueOtherTypes = Array.from(new Set(otherTypes));
                    const otherBranchesStr = uniqueOtherTypes.join(' and ');

                    diagnostics.push({
                      severity: DiagnosticSeverity.Warning,
                      range: info.range,
                      message: `'${varName}' is assigned as ${currentTypeStr} in this branch, but as ${otherBranchesStr} in another. This may cause unexpected results.`,
                      code: DIAGNOSTIC_CODES.BRANCH_TYPE_MISMATCH,
                      source: 'liquid-lsp-linter',
                      data: {
                        varName,
                        mismatchLine: info.line,
                        mismatchRange: info.range,
                        expected: typeStrings[0],
                        actual: currentTypeStr,
                        ranges,
                        types: typeStrings,
                      },
                    });
                  }

                  scopeTracker.activeVars.set(varName, {
                    declRange: first.range,
                    line: first.line,
                    hasBeenRead,
                    type: {
                      kind: 'branch_mismatch',
                      types,
                      lines,
                      ranges,
                    },
                  });
                } else {
                  const hasElse = block.branches.length > 1;
                  if (assignedBranches.length < block.branches.length && hasElse) {
                    let optType = first.type;
                    if (typeof optType === 'string') {
                      if (optType === 'unknown') {
                        optType = 'unknown';
                      } else {
                        optType = { kind: 'primitive', type: optType, optional: true };
                      }
                    } else if (typeof optType === 'object' && optType.kind !== 'branch_mismatch') {
                      optType = { ...optType, optional: true };
                    }
                    scopeTracker.activeVars.set(varName, {
                      declRange: first.range,
                      line: first.line,
                      hasBeenRead,
                      type: optType,
                    });
                  } else {
                    scopeTracker.activeVars.set(varName, {
                      declRange: first.range,
                      line: first.line,
                      hasBeenRead,
                      type: first.type,
                    });
                  }
                }
              }
            }
          }
        }

        collectTagDiagnostics(
          textDocument,
          diagnostics,
          token,
          scopeTracker,
          line,
          liquidEngine,
          schemaVariables,
        );
      } else if (token.kind === TokenKind.Output) {
        const expr = token.getText().slice(2, -2).trim();
        const resolved = processExpression(
          expr,
          token,
          textDocument,
          diagnostics,
          scopeTracker.activeVars,
          liquidEngine,
        );

        if (resolved && isOptionalType(resolved)) {
          const tokenText = token.getText();
          const exprOffset = tokenText.indexOf(expr);
          const start = textDocument.positionAt(token.begin + (exprOffset !== -1 ? exprOffset : 2));
          const end = textDocument.positionAt(
            token.begin + (exprOffset !== -1 ? exprOffset + expr.length : tokenText.length - 2),
          );

          const isNumeric =
            resolved === 'number' ||
            resolved === 'currency' ||
            (typeof resolved === 'object' &&
              resolved !== null &&
              'kind' in resolved &&
              resolved.kind === 'primitive' &&
              (resolved.type === 'number' || resolved.type === 'currency'));
          const defaultVal = isNumeric ? '0' : '""';

          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: { start, end },
            message: `"${expr}" is optional and might be blank, which will render as empty text. Consider adding a default filter like "| default: ${defaultVal}".`,
            code: DIAGNOSTIC_CODES.NIL_PROPAGATION,
            data: {
              insertRange: { start: end, end: end },
              newText: ` | default: ${defaultVal}`,
            },
            source: 'liquid-lsp-linter',
          });
        }
      }
    }
  } catch {
    return;
  }

  checkUnusedVariables(textDocument, diagnostics, tokens);
}
