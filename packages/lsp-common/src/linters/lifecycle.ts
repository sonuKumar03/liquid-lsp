import { DiagnosticSeverity, Range } from 'vscode-languageserver';
import type { Diagnostic } from 'vscode-languageserver';
import type { Liquid, Token, TopLevelToken, TagToken } from 'liquid-core';
import {
  TokenKind,
  TagTokenClass,
  tokenizeTopLevel,
  isKnownLiquidFilter,
  isConditionalTagLine,
  getClosestFilter,
  parseAssignKeyValueWithOffsets,
  parseCaptureVariableWithOffsets,
  parseForLoopVariableWithOffsets,
  parseOutputValue,
  LIQUID_FILTER_METAS,
} from 'liquid-core';
import { PropertyAccessToken, Tokenizer } from 'liquidjs';
import {
  MATH_FILTERS,
  STRING_FILTERS,
  jsonValueToLiquidType,
  unquoteString,
} from '../shared/local-variable-types.js';
import { resolveTypeForPath } from '../hovers/hovers.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { LiquidType } from '../shared/schema.js';
import type { VariableDeclaration } from 'key-pointer-schema';
import { supportsKeyPointerComputation } from 'key-pointer-schema';
import { findVariableDeclarations } from '../shared/variable-declarations.js';
import { DIAGNOSTIC_CODES } from '../shared/diagnostic-codes.js';

type BranchMismatchType = {
  kind: 'branch_mismatch';
  types: LiquidType[];
  lines: number[];
  ranges: Range[];
};

type LinterVariableType = LiquidType | BranchMismatchType;

type ActiveVar = {
  declRange: Range;
  line: number;
  hasBeenRead: boolean;
  type: LinterVariableType;
};

interface BlockStackEntry {
  branches: Array<Map<string, { type: LinterVariableType; line: number; range: Range }>>;
  currentBranchIndex: number;
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

    const activeVars = new Map<string, ActiveVar>();
    populateSchemaVars(activeVars, globalSchema);

    const blockStack: BlockStackEntry[] = [];

    for (const token of tokens) {
      const line = textDocument.positionAt(token.begin).line;
      if (token instanceof TagTokenClass) {
        console.log("LINTER TOKEN:", token.name, token.constructor.name);
        const tagName = token.name;
        if (tagName === 'if' || tagName === 'unless') {
          blockStack.push({
            branches: [new Map()],
            currentBranchIndex: 0,
          });
        } else if (tagName === 'else' || tagName === 'elsif') {
          if (blockStack.length > 0) {
            const block = blockStack[blockStack.length - 1]!;
            block.currentBranchIndex++;
            block.branches.push(new Map());
          }
        } else if (tagName === 'endif' || tagName === 'endunless') {
          if (blockStack.length > 0) {
            const block = blockStack.pop()!;
            console.log("POP BLOCK:", JSON.stringify(block));
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
                console.log("VARNAME:", varName, "mismatch:", mismatch);

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

                  activeVars.set(varName, {
                    declRange: first.range,
                    line: first.line,
                    hasBeenRead: false,
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
                    activeVars.set(varName, {
                      declRange: first.range,
                      line: first.line,
                      hasBeenRead: false,
                      type: optType,
                    });
                  } else {
                    activeVars.set(varName, {
                      declRange: first.range,
                      line: first.line,
                      hasBeenRead: false,
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
          activeVars,
          line,
          liquidEngine,
          schemaVariables,
          blockStack,
        );
      } else if (token.kind === TokenKind.Output) {
        const expr = token.getText().slice(2, -2).trim();
        const resolved = processExpression(
          expr,
          token,
          textDocument,
          diagnostics,
          activeVars,
          liquidEngine,
        );

        if (resolved && isOptionalType(resolved)) {
          const tokenText = token.getText();
          const exprOffset = tokenText.indexOf(expr);
          const start = textDocument.positionAt(token.begin + (exprOffset !== -1 ? exprOffset : 2));
          const end = textDocument.positionAt(token.begin + (exprOffset !== -1 ? exprOffset + expr.length : tokenText.length - 2));
          
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
  activeVars: Map<string, ActiveVar>,
  line: number,
  engine: Liquid,
  schemaVariables?: Map<string, VariableDeclaration>,
  blockStack?: BlockStackEntry[],
): void {
  const tokenText = token.getText();
  const name = token.name;

  if (name === 'assign' || name === 'assignVar' || name === 'parseAssign') {
    const parsed = parseAssignKeyValueWithOffsets(token.args);
    if (parsed) {
      const varName = parsed.key;
      const expr = parsed.value;
      const prev = activeVars.get(varName);
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
              activeVars,
              engine,
            )
          : processExpression(
              expr,
              token,
              doc,
              diagnostics,
              activeVars,
              engine,
            );
      redefineIfNeeded(diagnostics, activeVars, varName, blockStack);
      activeVars.set(
        varName,
        createDecl(varName, line, token, absOffset, inferredType, doc),
      );
      if (blockStack && blockStack.length > 0) {
        const block = blockStack[blockStack.length - 1]!;
        const branchMap = block.branches[block.currentBranchIndex];
        if (branchMap) {
          branchMap.set(varName, {
            type: inferredType,
            line,
            range: createDecl(varName, line, token, absOffset, inferredType, doc).declRange,
          });
        }
      }
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

      redefineIfNeeded(diagnostics, activeVars, varName, blockStack);
      const inferredType = 'string';
      activeVars.set(
        varName,
        createDecl(varName, line, token, absOffset, inferredType, doc),
      );
      if (blockStack && blockStack.length > 0) {
        const block = blockStack[blockStack.length - 1]!;
        const branchMap = block.branches[block.currentBranchIndex];
        if (branchMap) {
          branchMap.set(varName, {
            type: inferredType,
            line,
            range: createDecl(varName, line, token, absOffset, inferredType, doc).declRange,
          });
        }
      }
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
          activeVars,
          engine,
        );
      }

      // Infer loop variable type from collection expression type if it's a composite
      let inferredType: LiquidType = 'unknown';
      if (collectionExpr) {
        const activeVarsTypes = new Map<string, LiquidType>();
        for (const [k, v] of activeVars.entries()) {
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

      activeVars.set(
        varName,
        createDecl(varName, line, token, absOffset, inferredType, doc),
      );
    }
  } else if (isConditionalTagLine(name)) {
    processExpression(token.args, token, doc, diagnostics, activeVars, engine);
  }
}

function createDecl(
  varName: string,
  line: number,
  token: TagToken,
  offsetInToken: number,
  type: LinterVariableType,
  doc: TextDocument,
): ActiveVar {
  const absPos = doc.positionAt(token.begin + offsetInToken);
  const start = { line: absPos.line, character: absPos.character };
  const end = { line: absPos.line, character: absPos.character + varName.length };
  return {
    declRange: Range.create(start, end),
    line,
    hasBeenRead: false,
    type,
  };
}

function isParallelBranchAssignment(
  activeVars: Map<string, ActiveVar>,
  varName: string,
  blockStack?: BlockStackEntry[],
): boolean {
  if (!blockStack || blockStack.length === 0) return false;
  const prev = activeVars.get(varName);
  if (!prev) return false;

  for (let i = blockStack.length - 1; i >= 0; i--) {
    const block = blockStack[i]!;
    for (let bIdx = 0; bIdx < block.branches.length; bIdx++) {
      if (bIdx === block.currentBranchIndex) continue;
      const branchMap = block.branches[bIdx]!;
      const branchVar = branchMap.get(varName);
      if (branchVar) {
        if (
          prev.declRange.start.line === branchVar.range.start.line &&
          prev.declRange.start.character === branchVar.range.start.character &&
          prev.declRange.end.line === branchVar.range.end.line &&
          prev.declRange.end.character === branchVar.range.end.character
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function redefineIfNeeded(
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
  varName: string,
  blockStack?: BlockStackEntry[],
): void {
  if (isParallelBranchAssignment(activeVars, varName, blockStack)) {
    return;
  }
  const prev = activeVars.get(varName);
  if (prev && !prev.hasBeenRead && prev.line !== -1) {
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: prev.declRange,
      message: `You assigned a value to "${varName}" but never used it before overwriting it.`,
      source: 'liquid-lsp-linter',
    });
  }
}

function validateDropdownValue(
  doc: TextDocument,
  diagnostics: Diagnostic[],
  prev: ActiveVar | undefined,
  varName: string,
  expr: string,
  tokenBegin: number,
  tokenEnd: number,
): void {
  if (!prev || typeof prev.type !== 'object' || prev.type.kind !== 'dropdown')
    return;

  const cleanExpr = expr.trim();
  if (!/^"[^"]*"|'[^']*'$/.test(cleanExpr)) return;

  const strVal = cleanExpr.slice(1, -1);
  if (prev.type.options.includes(strVal)) return;

  diagnostics.push({
    severity: DiagnosticSeverity.Warning,
    range: Range.create(doc.positionAt(tokenBegin), doc.positionAt(tokenEnd)),
    message: `"${strVal}" is not one of the choices for "${varName}". Valid choices are: ${prev.type.options.map((o) => `"${o}"`).join(', ')}.`,
    source: 'liquid-lsp-linter',
  });
}

function validateNonComputableSchemaAssignment(
  doc: TextDocument,
  diagnostics: Diagnostic[],
  token: TagToken,
  varName: string,
  offsetInToken: number,
  schemaVariables?: Map<string, VariableDeclaration>,
): void {
  if (!schemaVariables?.has(varName)) {
    return;
  }

  const declaration = schemaVariables.get(varName);
  if (!declaration || supportsKeyPointerComputation(declaration.data_type)) {
    return;
  }

  const absPos = doc.positionAt(token.begin + offsetInToken);
  const start = {
    line: absPos.line,
    character: absPos.character,
  };
  const end = {
    line: start.line,
    character: start.character + varName.length,
  };

  diagnostics.push({
    severity: DiagnosticSeverity.Warning,
    range: Range.create(start, end),
    message: `"${varName}" is a database field of type "${declaration.data_type}" and cannot be set directly in the template.`,
    code: DIAGNOSTIC_CODES.COMPUTATION_ASSIGN_NOT_SUPPORTED,
    data: {
      field_name: varName,
      data_type: declaration.data_type,
    },
    source: 'liquid-lsp-linter',
  });
}

function processParseAssignExpression(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
  engine: Liquid,
): LinterVariableType {
  const trimmedExpr = expr.trim();
  
  // Try raw JSON literal first
  if (
    (trimmedExpr.startsWith('[') && trimmedExpr.endsWith(']')) ||
    (trimmedExpr.startsWith('{') && trimmedExpr.endsWith('}'))
  ) {
    try {
      const parsedJson = JSON.parse(trimmedExpr);
      return jsonValueToLiquidType(parsedJson);
    } catch {
      // ignore
    }
  }

  // Try quoted JSON string literal
  const isQuoted =
    (trimmedExpr.startsWith("'") && trimmedExpr.endsWith("'")) ||
    (trimmedExpr.startsWith('"') && trimmedExpr.endsWith('"'));
  if (isQuoted) {
    try {
      const innerStr = unquoteString(trimmedExpr);
      const parsedJson = JSON.parse(innerStr);
      return jsonValueToLiquidType(parsedJson);
    } catch {
      // ignore
    }
  }

  const filterParts = expr.split('|');
  const pathPart = (filterParts[0] ?? '').trim();
  const parts = pathPart.split('.');
  const baseVarRaw = (parts[0] ?? '').trim();
  const baseVar = baseVarRaw.replace(/\[\s*[a-zA-Z0-9_-]+\s*\]/g, '');

  if (!baseVar) return 'unknown';

  let currentType: LinterVariableType = 'unknown';
  if (activeVars.has(baseVar)) {
    const v = activeVars.get(baseVar)!;
    v.hasBeenRead = true;
    currentType = v.type;
  } else if (/^""|''$/.test(baseVar) || /^"[^"]*"|'[^']*'$/.test(baseVar)) {
    currentType = 'string';
  } else if (/^(true|false)$/.test(baseVar)) {
    currentType = 'boolean';
  } else if (/^\d+(\.\d+)?$/.test(baseVar)) {
    currentType = 'number';
  }

  const equalIndex = token.getText().indexOf('=');
  let searchIndex = token.begin + (equalIndex !== -1 ? equalIndex + 1 : 0);

  for (let i = 1; i < parts.length; i++) {
    const fieldNameRaw = (parts[i] ?? '').trim();
    if (!fieldNameRaw) continue;

    if (currentType === 'unknown') {
      currentType = 'unknown';
      continue;
    }

    const fieldName = fieldNameRaw.replace(/\[\s*[a-zA-Z0-9_-]+\s*\]/g, '');
    const offsetInToken = token
      .getText()
      .indexOf(fieldNameRaw, searchIndex - token.begin);
    const offset =
      offsetInToken !== -1
        ? offsetInToken
        : token.getText().indexOf(fieldNameRaw);
    if (offsetInToken !== -1) {
      searchIndex = token.begin + offsetInToken + fieldNameRaw.length;
    }

    const start = doc.positionAt(token.begin + (offset !== -1 ? offset : 0));
    const end = doc.positionAt(
      token.begin +
        (offset !== -1 ? offset + fieldNameRaw.length : token.getText().length),
    );

    if (typeof currentType === 'object' && currentType.kind !== 'branch_mismatch' && currentType.optional === true) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: { start, end },
        message: `"${fieldName}" might be missing because its parent is optional. Use a fallback value or check if the parent is defined.`,
        source: 'liquid-lsp-linter',
        code: 'liquid.linter.optional_access',
      });
    }

    if (typeof currentType === 'object' && currentType.kind !== 'branch_mismatch') {
      if (currentType.kind === 'composite') {
        const nextType = currentType.fields.get(fieldName);
        if (nextType) {
          const isParentOpt = currentType.optional === true;
          if (isParentOpt) {
            if (typeof nextType === 'string') {
              if (nextType === 'unknown') {
                currentType = 'unknown';
              } else {
                currentType = { kind: 'primitive', type: nextType, optional: true };
              }
            } else if (typeof nextType === 'object') {
              currentType = { ...nextType, optional: true };
            }
          } else {
            currentType = nextType;
          }
        } else if (currentType.open) {
          currentType = 'unknown';
        } else {
          const parentPath = parts.slice(0, i).join('.');
          const available = Array.from(currentType.fields.keys()).map((f) => `"${f}"`).join(', ');
          const availStr = available ? ` Available fields are: ${available}.` : '';
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: `"${parentPath}" doesn't have a field called "${fieldName}".${availStr}`,
            source: 'liquid-lsp-linter',
          });
          currentType = 'unknown';
          break;
        }
      } else {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: { start, end },
          message: `You can't access "${fieldName}" because parent is not a container structure (it is a single value).`,
          source: 'liquid-lsp-linter',
        });
        currentType = 'unknown';
        break;
      }
    } else if (currentType === 'currency') {
      if (fieldName === 'amount') {
        currentType = 'number';
      } else if (fieldName === 'symbol') {
        currentType = 'string';
      } else {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: { start, end },
          message: `Currency values only have "amount" and "symbol". "${fieldName}" is not valid.`,
          source: 'liquid-lsp-linter',
        });
        currentType = 'unknown';
        break;
      }
    } else {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: { start, end },
        message: `You can't access "${fieldName}" on "${currentType}" because it is a single value, not a list or record.`,
        source: 'liquid-lsp-linter',
      });
      currentType = 'unknown';
      break;
    }
  }

  if (parts.length === 1 && !baseVarRaw.includes('[')) {
    if (typeof currentType === 'object' && currentType.kind === 'composite') {
      currentType = 'string';
    } else if (currentType === 'currency') {
      currentType = 'number';
    }
  }

  if (filterParts.length > 1) {
    currentType = applyFilterTypeWarnings(
      expr,
      token,
      doc,
      diagnostics,
      activeVars,
      currentType,
      engine,
    );
  }

  return currentType;
}

function buildSpacedFilterExpr(expr: string): string {
  return expr
    .replace(/"[^"]*"/g, (m) => '"' + ' '.repeat(m.length - 2) + '"')
    .replace(/'[^']*'/g, (m) => "'" + ' '.repeat(m.length - 2) + "'");
}

function validateFilterNameSyntax(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
): void {
  const spacedExpr = buildSpacedFilterExpr(expr);
  let pipeIdx = spacedExpr.indexOf('|');
  while (pipeIdx !== -1) {
    const afterPipe = expr.substring(pipeIdx + 1);
    const trimmedAfterPipe = afterPipe.trimStart();
    const leadingWhitespaceLen = afterPipe.length - trimmedAfterPipe.length;
    const filterNameStart = pipeIdx + 1 + leadingWhitespaceLen;

    const filterNameMatch = trimmedAfterPipe.match(
      /^([a-zA-Z_][a-zA-Z0-9_-]*)/,
    );
    if (!filterNameMatch) {
      const tokenText = token.getText();
      const exprOffsetInToken = tokenText.indexOf(expr);
      const errorStartOffset =
        token.begin +
        (exprOffsetInToken !== -1 ? exprOffsetInToken : 0) +
        filterNameStart;
      const quotedMatch = trimmedAfterPipe.match(/^("[^"]*"|'[^']*')/);
      const matchWord = quotedMatch ? quotedMatch : trimmedAfterPipe.match(/^[^\s|]*/);
      const highlightLen = Math.max(1, matchWord ? matchWord[0].length : 1);
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: doc.positionAt(errorStartOffset),
          end: doc.positionAt(errorStartOffset + highlightLen),
        },
        message: 'Expected filter name.',
        code: DIAGNOSTIC_CODES.EXPECTED_FILTER_NAME,
        source: 'liquid-lsp-linter',
      });
    } else {
      const filterName = filterNameMatch[1]!;
      if (!isKnownLiquidFilter(filterName)) {
        const tokenText = token.getText();
        const exprOffsetInToken = tokenText.indexOf(expr);
        const errorStartOffset =
          token.begin +
          (exprOffsetInToken !== -1 ? exprOffsetInToken : 0) +
          filterNameStart;
        const closestFilter = getClosestFilter(filterName);
        const message = closestFilter
          ? `Unknown filter "${filterName}". Did you mean "${closestFilter}"?`
          : `Unknown filter "${filterName}".`;
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: {
            start: doc.positionAt(errorStartOffset),
            end: doc.positionAt(errorStartOffset + filterName.length),
          },
          message,
          code: DIAGNOSTIC_CODES.UNKNOWN_FILTER,
          data: { filterName, suggestedFilter: closestFilter },
          source: 'liquid-lsp-linter',
        });
      }
    }
    pipeIdx = spacedExpr.indexOf('|', pipeIdx + 1);
  }
}

function isOptionalType(type: LinterVariableType): boolean {
  if (type && typeof type === 'object') {
    if (type.kind === 'branch_mismatch') {
      return false;
    }
    return type.optional === true;
  }
  return false;
}

function inferArgumentType(
  argToken: unknown,
  activeVars: Map<string, ActiveVar>,
): string {
  if (argToken && typeof argToken === 'object') {
    const constructorName = argToken.constructor?.name;
    if (constructorName === 'LiteralToken') {
      const txt = (argToken as { getText?: () => string }).getText?.();
      if (txt === 'true' || txt === 'false') return 'boolean';
    } else if (constructorName === 'NumberToken') {
      return 'number';
    } else if (constructorName === 'QuotedToken') {
      return 'string';
    } else if (constructorName === 'PropertyAccessToken') {
      const varName = (argToken as { getText?: () => string }).getText?.();
      if (varName && activeVars.has(varName)) {
        const t = activeVars.get(varName)!.type;
        return typeof t === 'object' && t.kind === 'primitive' ? t.type : typeof t === 'string' ? t : 'unknown';
      }
    }
  }
  return 'unknown';
}

function applyFilterTypeWarnings(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
  currentType: LinterVariableType,
  engine: Liquid,
): LinterVariableType {
  const parsed = parseOutputValue(engine, expr);
  if (!parsed) return currentType;

  const tokenText = token.getText();
  const exprOffsetInToken = tokenText.indexOf(expr);
  const basePart = expr.split('|')[0]?.trim() ?? '';

  const isStringLiteral = /^"[^"]*"|'[^']*'$/.test(basePart);
  const unquotedBase = isStringLiteral ? basePart.slice(1, -1) : basePart;
  const isBaseNumeric = /^\s*-?\d+(\.\d+)?\s*$/.test(unquotedBase);

  console.log("APPLY FILTER currentType:", JSON.stringify(currentType));
  let tempType = currentType;

  for (const filter of parsed.filters) {
    const filterName = filter.name;
    const filterOffsetInToken = tokenText.indexOf(filterName, exprOffsetInToken);
    
    const start = doc.positionAt(
      token.begin + (filterOffsetInToken !== -1 ? filterOffsetInToken : 0)
    );
    const end = doc.positionAt(
      token.begin +
        (filterOffsetInToken !== -1
          ? filterOffsetInToken + filterName.length
          : tokenText.length)
    );

    if (tempType && typeof tempType === 'object' && tempType.kind === 'branch_mismatch') {
      const bm = tempType;
      for (let j = 0; j < bm.types.length; j++) {
        const t = bm.types[j]!;
        const l = bm.lines[j]!;
        const r = bm.ranges[j]!;
        const tStr = typeof t === 'object' && t.kind === 'primitive' ? t.type : typeof t === 'string' ? t : 'unknown';

        if (MATH_FILTERS.has(filterName) && tStr !== 'number' && tStr !== 'currency' && tStr !== 'unknown') {
          const branchDesc = j === 0 ? 'if-branch' : 'else-branch';
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: `"${basePart}" is a string in the ${branchDesc} (line ${l + 1}) — math filter "${filterName}" will break at runtime.`,
            code: DIAGNOSTIC_CODES.BRANCH_TYPE_MISMATCH,
            data: {
              varName: basePart,
              mismatchLine: l,
              mismatchRange: r,
              expected: 'number',
              actual: tStr,
              ranges: bm.ranges,
            },
            source: 'liquid-lsp-linter',
          });
        } else if (STRING_FILTERS.has(filterName) && tStr !== 'string' && tStr !== 'unknown') {
          const branchDesc = j === 0 ? 'if-branch' : 'else-branch';
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: `"${basePart}" is a number in the ${branchDesc} (line ${l + 1}) — string filter "${filterName}" will break at runtime.`,
            code: DIAGNOSTIC_CODES.BRANCH_TYPE_MISMATCH,
            data: {
              varName: basePart,
              mismatchLine: l,
              mismatchRange: r,
              expected: 'string',
              actual: tStr,
              ranges: bm.ranges,
            },
            source: 'liquid-lsp-linter',
          });
        }
      }
      if (MATH_FILTERS.has(filterName)) {
        tempType = 'number';
      } else if (STRING_FILTERS.has(filterName)) {
        tempType = 'string';
      }
    } else {
      if (MATH_FILTERS.has(filterName)) {
        const isString = tempType === 'string' || (typeof tempType === 'object' && tempType.kind === 'primitive' && tempType.type === 'string');
        const isOpt = isOptionalType(tempType);
        const isUnk = tempType === 'unknown';

        if (isString && isStringLiteral && !isBaseNumeric) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: { start, end },
            message: `String literal "${unquotedBase}" contains non-numeric characters and cannot be used in math operations.`,
            code: DIAGNOSTIC_CODES.NON_NUMERIC_COERCION,
            source: 'liquid-lsp-linter',
          });
        } else if (isString) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: { start, end },
            message: `"${filterName}" only works on numbers. The value is text, not a number.`,
            code: DIAGNOSTIC_CODES.NON_NUMERIC_COERCION,
            source: 'liquid-lsp-linter',
          });
        } else if (isOpt || isUnk) {
          const offset = exprOffsetInToken !== -1 ? exprOffsetInToken : 0;
          const insertPos = doc.positionAt(token.begin + offset + basePart.length);
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: { start, end },
            message: `"${basePart}" might be blank. Add a fallback value using "| default: 0".`,
            code: DIAGNOSTIC_CODES.COERCION_WARNING,
            data: {
              insertRange: { start: insertPos, end: insertPos },
              newText: ' | default: 0',
            },
            source: 'liquid-lsp-linter',
          });
        }

        tempType = 'number';
      } else if (STRING_FILTERS.has(filterName)) {
        const isNumber = tempType === 'number' || tempType === 'currency' || (typeof tempType === 'object' && tempType.kind === 'primitive' && (tempType.type === 'number' || tempType.type === 'currency'));
        if (isNumber) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: { start, end },
            message: `"${filterName}" only works on text. The value is a number, not text.`,
            source: 'liquid-lsp-linter',
          });
        }
        tempType = 'string';
      }
    }

    const filterMeta = LIQUID_FILTER_METAS.find((m) => m.name === filterName);
    if (filterMeta && filterMeta.argTypes) {
      let argIndex = 0;
      for (const arg of filter.args) {
        const isNamed = Array.isArray(arg);
        if (!isNamed) {
          const valToken = arg;
          const expectedType = filterMeta.argTypes[argIndex];
          if (expectedType && expectedType !== 'any') {
            const actualType = inferArgumentType(valToken, activeVars);
            if (actualType !== 'unknown' && actualType !== expectedType) {
              const argOffset = tokenText.indexOf(valToken.getText(), filterOffsetInToken);
              const argStart = doc.positionAt(token.begin + (argOffset !== -1 ? argOffset : 0));
              const argEnd = doc.positionAt(token.begin + (argOffset !== -1 ? argOffset + valToken.getText().length : tokenText.length));

              diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: Range.create(argStart, argEnd),
                message: `"${filterName}" expects a ${expectedType} argument, got a ${actualType} literal "${valToken.getText()}".`,
                code: DIAGNOSTIC_CODES.FILTER_ARGUMENT_TYPE_MISMATCH,
                source: 'liquid-lsp-linter',
              });
            }
          }
          argIndex++;
        }
      }
    }

    if (filterName === 'date') {
      for (const arg of filter.args) {
        const valToken = Array.isArray(arg) ? arg[1] : arg;
        if (valToken && valToken.constructor?.name === 'QuotedToken') {
          const rawVal = (valToken as { getText?: () => string }).getText?.() ?? '';
          const val = rawVal.slice(1, -1);
          if (val && !val.includes('%')) {
            const argOffset = tokenText.indexOf(rawVal, filterOffsetInToken);
            const argStart = doc.positionAt(token.begin + (argOffset !== -1 ? argOffset : 0));
            const argEnd = doc.positionAt(token.begin + (argOffset !== -1 ? argOffset + rawVal.length : tokenText.length));

            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              range: Range.create(argStart, argEnd),
              message: `Date format string "${val}" doesn't contain any standard formatting placeholders (like %Y, %m, %d).`,
              code: DIAGNOSTIC_CODES.FILTER_ARGUMENT_TYPE_MISMATCH,
              source: 'liquid-lsp-linter',
            });
          }
        }
      }
    }

    if (filterName === 'default') {
      if (typeof tempType === 'object' && tempType.kind !== 'branch_mismatch') {
        tempType = { ...tempType, optional: false };
      }
    } else {
      if (isOptionalType(currentType)) {
        if (typeof tempType === 'string') {
          if (tempType === 'unknown') {
            // Keep it unknown
          } else {
            tempType = { kind: 'primitive', type: tempType, optional: true };
          }
        } else if (typeof tempType === 'object' && tempType.kind !== 'branch_mismatch') {
          tempType = { ...tempType, optional: true };
        }
      }
    }
  }

  return tempType;
}

function resolveBaseExpressionType(
  basePart: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
  engine: Liquid,
): LinterVariableType {
  let currentType: LinterVariableType = 'unknown';
  if (/^"[^"]*"|'[^']*'$/.test(basePart)) {
    currentType = 'string';
  } else if (/^(true|false)$/.test(basePart)) {
    currentType = 'boolean';
  } else if (/^\d+(\.\d+)?$/.test(basePart)) {
    currentType = 'number';
  } else if (/^[a-zA-Z0-9_-]+$/.test(basePart)) {
    const varName = basePart;
    if (activeVars.has(varName)) {
      const v = activeVars.get(varName)!;
      v.hasBeenRead = true;
      currentType = v.type;
    }
  } else if (basePart.includes('.')) {
    let isSimpleProp = false;
    try {
      const tokenizer = new Tokenizer(basePart, engine.options);
      const val = tokenizer.readValue();
      if (val instanceof PropertyAccessToken) {
        tokenizer.skipBlank();
        if (tokenizer.p === tokenizer.N) {
          isSimpleProp = true;
        }
      }
    } catch {
      // Ignore
    }

    if (isSimpleProp) {
      currentType = processParseAssignExpression(
        basePart,
        token,
        doc,
        diagnostics,
        activeVars,
        engine,
      );
    } else {
      const words = basePart.match(/[a-zA-Z_][a-zA-Z0-9_-]*/g) || [];
      const keywords = new Set([
        'true',
        'false',
        'nil',
        'null',
        'and',
        'or',
        'contains',
        'in',
      ]);
      for (const word of words) {
        if (!keywords.has(word) && activeVars.has(word)) {
          activeVars.get(word)!.hasBeenRead = true;
        }
      }
      if (/[=!<>+]/.test(basePart)) {
        currentType = 'boolean';
      }
    }
  } else {
    const words = basePart.match(/[a-zA-Z_][a-zA-Z0-9_-]*/g) || [];
    const keywords = new Set([
      'true',
      'false',
      'nil',
      'null',
      'and',
      'or',
      'contains',
      'in',
    ]);
    for (const word of words) {
      if (!keywords.has(word) && activeVars.has(word)) {
        activeVars.get(word)!.hasBeenRead = true;
      }
    }
    if (/[=!<>+]/.test(basePart)) {
      currentType = 'boolean';
    }
  }

  return currentType;
}

function extractVariables(token: unknown, variables: string[]): void {
  if (token instanceof PropertyAccessToken) {
    if (token.props && token.props.length > 0) {
      const base = token.props[0];
      if (base) {
        variables.push(base.getText());
      }
      for (let i = 1; i < token.props.length; i++) {
        extractVariables(token.props[i], variables);
      }
    }
  }
}

function markVariableUsage(
  value: string,
  activeVars: Map<string, ActiveVar>,
): void {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }

  const baseVar = trimmed
    .split('.')[0]
    ?.replace(/\[\s*.+\s*\]/g, '')
    .trim();
  if (baseVar && activeVars.has(baseVar)) {
    activeVars.get(baseVar)!.hasBeenRead = true;
  }
}

function markVariablesReadFromExpression(
  expr: string,
  activeVars: Map<string, ActiveVar>,
  engine: Liquid,
): void {
  const parsed = parseOutputValue(engine, expr);
  if (!parsed) {
    return;
  }

  const vars: string[] = [];

  if (parsed.initial && parsed.initial.postfix) {
    for (const token of parsed.initial.postfix) {
      extractVariables(token, vars);
    }
  }

  for (const filter of parsed.filters) {
    for (const arg of filter.args) {
      const valueToken = Array.isArray(arg) ? arg[1] : arg;
      if (valueToken) {
        if (valueToken instanceof PropertyAccessToken) {
          extractVariables(valueToken, vars);
        }
      }
    }
  }

  for (const v of vars) {
    markVariableUsage(v, activeVars);
  }
}

function processExpression(
  expr: string,
  token: Token,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  activeVars: Map<string, ActiveVar>,
  engine: Liquid,
): LinterVariableType {
  validateFilterNameSyntax(expr, token, doc, diagnostics);
  markVariablesReadFromExpression(expr, activeVars, engine);

  const cleanExpr = expr.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  const parts = cleanExpr.split('|');
  const basePart = (parts[0] ?? '').trim();

  const currentType = resolveBaseExpressionType(
    basePart,
    token,
    doc,
    diagnostics,
    activeVars,
    engine,
  );

  return applyFilterTypeWarnings(
    expr,
    token,
    doc,
    diagnostics,
    activeVars,
    currentType,
    engine,
  );
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

    if (totalCount === declCount) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: decl.range,
        message: `You created "${name}" but never read it anywhere. If it isn't needed, you can delete this line.`,
        source: 'liquid-lsp-linter',
      });
    }
  }
}
