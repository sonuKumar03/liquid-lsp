import { CodeAction, CodeActionKind, Command, Range } from 'vscode-languageserver';
import type { CodeActionParams } from 'vscode-languageserver';
import { TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CONDITIONAL_ASSIGNMENT_MESSAGE,
  INLINE_MATH_OPERATOR_MESSAGE,
  SINGLE_EQUALS_ASSIGNMENT_REGEX,
  convertToLiquidMath,
  getClosestTag,
  getClosestFilter,
  TagTokenClass,
  BLOCK_OPEN_TAG_NAMES,
  type Liquid,
} from 'liquid-core';
import { DIAGNOSTIC_CODES } from '../shared/diagnostic-codes.js';
import type { DocumentManager } from '../server/document-manager.js';
import type { Diagnostic } from 'vscode-languageserver';

/**
 * Strategy pattern interface for generating CodeActions based on diagnostics.
 */
export interface CodeActionStrategy {
  execute(
    doc: TextDocument,
    diagnostic: Diagnostic,
    params: CodeActionParams,
    documentManager?: DocumentManager,
    liquidEngine?: Liquid,
  ): CodeAction[];
  matches?(diagnostic: Diagnostic): boolean;
}

// ==========================================
// Strategy Implementations
// ==========================================

export const FallbackStrategy: CodeActionStrategy = {
  matches(diagnostic) {
    return (
      diagnostic.code === DIAGNOSTIC_CODES.COERCION_WARNING ||
      diagnostic.code === DIAGNOSTIC_CODES.NIL_PROPAGATION
    );
  },
  execute(doc, diagnostic, params) {
    const actions: CodeAction[] = [];
    const diagData = diagnostic.data as { insertRange?: Range; newText?: string } | undefined;
    if (diagData?.insertRange && diagData?.newText) {
      const edit = {
        changes: {
          [params.textDocument.uri]: [
            {
              range: diagData.insertRange,
              newText: diagData.newText,
            },
          ],
        },
      };
      const action = CodeAction.create(
        `Add fallback: "${diagData.newText.trim()}"`,
        edit,
        CodeActionKind.QuickFix,
      );
      action.diagnostics = [diagnostic];
      actions.push(action);
    }
    return actions;
  },
};

export const BranchMismatchStrategy: CodeActionStrategy = {
  matches(diagnostic) {
    return diagnostic.code === DIAGNOSTIC_CODES.BRANCH_TYPE_MISMATCH;
  },
  execute(doc, diagnostic, params, documentManager, liquidEngine) {
    const actions: CodeAction[] = [];
    if (!documentManager || !liquidEngine) return actions;

    const diagData = diagnostic.data as {
      varName: string;
      mismatchLine: number;
      mismatchRange: Range;
      expected: 'number' | 'string';
      actual: string;
      ranges: Range[];
    } | undefined;

    if (diagData && diagData.ranges) {
      const tokens = documentManager.getTokens(params.textDocument.uri, liquidEngine);

      const mismatchedToken = tokens.find(
        (t) =>
          t instanceof TagTokenClass &&
          t.line === diagData.mismatchLine &&
          ['assign', 'assignVar', 'parseAssign'].includes(t.name),
      );

      if (mismatchedToken && mismatchedToken.constructor?.name === 'TagTokenClass') {
        const tagToken = mismatchedToken as TagTokenClass;
        const tokenText = tagToken.getText();
        const argsOffset = tokenText.indexOf(tagToken.args);
        const equalsIndex = tagToken.args.indexOf('=');

        if (equalsIndex !== -1) {
          const startOffset =
            tagToken.begin + (argsOffset >= 0 ? argsOffset : 0) + equalsIndex + 1;
          const endOffset = tagToken.begin + (argsOffset >= 0 ? argsOffset : 0) + tagToken.args.length;

          const rawVal = doc.getText(Range.create(doc.positionAt(startOffset), doc.positionAt(endOffset)));
          const leadingSpaces = rawVal.length - rawVal.trimStart().length;
          const trimmed = rawVal.trim();

          const valueRange = Range.create(
            doc.positionAt(startOffset + leadingSpaces),
            doc.positionAt(startOffset + leadingSpaces + trimmed.length),
          );

          const newText = diagData.expected === 'number' ? '0.0' : '""';
          const edit = {
            changes: {
              [params.textDocument.uri]: [
                {
                  range: valueRange,
                  newText,
                },
              ],
            },
          };
          const action = CodeAction.create(
            `Align "${diagData.varName}" in branch on line ${diagData.mismatchLine + 1} to type ${diagData.expected}`,
            edit,
            CodeActionKind.QuickFix,
          );
          action.diagnostics = [diagnostic];
          actions.push(action);
        }
      }
    }
    return actions;
  },
};

export const DelimiterStrategy: CodeActionStrategy = {
  matches(diagnostic) {
    return diagnostic.code === DIAGNOSTIC_CODES.UNCLOSED_DELIMITER;
  },
  execute(doc, diagnostic, params) {
    const actions: CodeAction[] = [];
    const data = diagnostic.data as { tagName?: string } | undefined;

    const lineText = doc.getText({
      start: { line: diagnostic.range.start.line, character: 0 },
      end: { line: diagnostic.range.start.line + 1, character: 0 },
    });
    const tagName = lineText.match(/\{%\s*(\w+)/)?.[1] ?? data?.tagName ?? null;

    // 1. If it's a block tag, offer to insert the missing closing tag
    if (tagName && BLOCK_OPEN_TAG_NAMES.has(tagName)) {
      const endTagName = `end${tagName}`;
      const lastLine = doc.lineCount - 1;
      const lastLineText = doc.getText({
        start: { line: lastLine, character: 0 },
        end: { line: lastLine + 1, character: 0 },
      });
      const endPosition = { line: lastLine, character: lastLineText.length };

      const edit = {
        changes: {
          [params.textDocument.uri]: [
            {
              range: { start: endPosition, end: endPosition },
              newText: `\n{% ${endTagName} %}`,
            },
          ],
        },
      };

      const action = CodeAction.create(
        `Insert missing {% ${endTagName} %}`,
        edit,
        CodeActionKind.QuickFix,
      );
      action.diagnostics = [diagnostic];
      actions.push(action);
    }

    // 2. Offer to fix/close the delimiter itself (e.g. change tag end to %} or output end to }})
    const rangeText = doc.getText(diagnostic.range);
    const trimmedText = rangeText.trim();
    if (trimmedText.startsWith('{%') && trimmedText.endsWith('}') && !trimmedText.endsWith('%}')) {
      const lastBraceIndex = rangeText.lastIndexOf('}');
      if (lastBraceIndex !== -1) {
        const bracePosition = doc.positionAt(doc.offsetAt(diagnostic.range.start) + lastBraceIndex);
        const replaceRange = Range.create(bracePosition, {
          line: bracePosition.line,
          character: bracePosition.character + 1,
        });
        const edit = {
          changes: {
            [params.textDocument.uri]: [
              {
                range: replaceRange,
                newText: '%}',
              },
            ],
          },
        };
        const action = CodeAction.create(`Close with %}`, edit, CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        actions.push(action);
      }
    } else if (trimmedText.startsWith('{{') && trimmedText.endsWith('}') && !trimmedText.endsWith('}}')) {
      const lastBraceIndex = rangeText.lastIndexOf('}');
      if (lastBraceIndex !== -1) {
        const bracePosition = doc.positionAt(doc.offsetAt(diagnostic.range.start) + lastBraceIndex);
        const replaceRange = Range.create(bracePosition, {
          line: bracePosition.line,
          character: bracePosition.character + 1,
        });
        const edit = {
          changes: {
            [params.textDocument.uri]: [
              {
                range: replaceRange,
                newText: '}}',
              },
            ],
          },
        };
        const action = CodeAction.create(`Close with }}`, edit, CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        actions.push(action);
      }
    }
    return actions;
  },
};

export const UnknownFilterStrategy: CodeActionStrategy = {
  matches(diagnostic) {
    return diagnostic.code === DIAGNOSTIC_CODES.UNKNOWN_FILTER;
  },
  execute(doc, diagnostic, params) {
    const actions: CodeAction[] = [];
    const data = diagnostic.data as { suggestedFilter?: string } | undefined;
    const suggestedFilter = data?.suggestedFilter;
    if (suggestedFilter) {
      const edit = {
        changes: {
          [params.textDocument.uri]: [
            {
              range: diagnostic.range,
              newText: suggestedFilter,
            },
          ],
        },
      };

      const action = CodeAction.create(
        `Change to "${suggestedFilter}"`,
        edit,
        CodeActionKind.QuickFix,
      );
      action.diagnostics = [diagnostic];
      actions.push(action);
    }
    return actions;
  },
};

export const QuotedFilterStrategy: CodeActionStrategy = {
  matches(diagnostic) {
    return (
      diagnostic.code === DIAGNOSTIC_CODES.EXPECTED_FILTER_NAME ||
      (typeof diagnostic.message === 'string' &&
        diagnostic.message.toLowerCase().includes('expected filter name'))
    );
  },
  execute(doc, diagnostic, params) {
    const actions: CodeAction[] = [];
    const text = doc.getText(diagnostic.range).trim();
    const isQuoted = /^("[^"]*"|'[^']*')$/.test(text);
    if (isQuoted) {
      const unquoted = text.slice(1, -1);

      // Remove quotes suggestion
      const editUnquote = {
        changes: {
          [params.textDocument.uri]: [
            {
              range: diagnostic.range,
              newText: unquoted,
            },
          ],
        },
      };
      const actionUnquote = CodeAction.create(
        `Remove quotes from filter name`,
        editUnquote,
        CodeActionKind.QuickFix,
      );
      actionUnquote.diagnostics = [diagnostic];
      actions.push(actionUnquote);

      // Correct spelling suggestion
      const closestFilter = getClosestFilter(unquoted);
      if (closestFilter) {
        const editSuggest = {
          changes: {
            [params.textDocument.uri]: [
              {
                range: diagnostic.range,
                newText: closestFilter,
              },
            ],
          },
        };
        const actionSuggest = CodeAction.create(
          `Change to filter "${closestFilter}"`,
          editSuggest,
          CodeActionKind.QuickFix,
        );
        actionSuggest.diagnostics = [diagnostic];
        actions.push(actionSuggest);
      }
    }
    return actions;
  },
};

export const InlineMathStrategy: CodeActionStrategy = {
  matches(diagnostic) {
    return (
      diagnostic.code === DIAGNOSTIC_CODES.INLINE_MATH ||
      (typeof diagnostic.message === 'string' &&
        diagnostic.message.includes(INLINE_MATH_OPERATOR_MESSAGE))
    );
  },
  execute(doc, diagnostic, params) {
    const actions: CodeAction[] = [];
    const startLine = diagnostic.range.start.line;
    const lineText = doc.getText({
      start: { line: startLine, character: 0 },
      end: { line: startLine + 1, character: 0 },
    });

    const convertedText = convertToLiquidMath(lineText);
    if (convertedText) {
      const edit = {
        changes: {
          [params.textDocument.uri]: [
            {
              range: {
                start: { line: startLine, character: 0 },
                end: { line: startLine, character: lineText.length },
              },
              newText: convertedText.replace(/\r?\n/g, ''),
            },
          ],
        },
      };

      const action = CodeAction.create(
        `Convert inline math to Liquid filter`,
        edit,
        CodeActionKind.QuickFix,
      );
      action.diagnostics = [diagnostic];
      actions.push(action);
    }
    return actions;
  },
};

export const ConditionalAssignmentStrategy: CodeActionStrategy = {
  matches(diagnostic) {
    return (
      diagnostic.code === DIAGNOSTIC_CODES.CONDITIONAL_ASSIGNMENT ||
      (typeof diagnostic.message === 'string' &&
        diagnostic.message.includes(CONDITIONAL_ASSIGNMENT_MESSAGE))
    );
  },
  execute(doc, diagnostic, params) {
    const actions: CodeAction[] = [];
    const startLine = diagnostic.range.start.line;
    const lineText = doc.getText({
      start: { line: startLine, character: 0 },
      end: { line: startLine + 1, character: 0 },
    });

    const matchIndex = lineText.search(SINGLE_EQUALS_ASSIGNMENT_REGEX);
    if (matchIndex !== -1) {
      const edit = {
        changes: {
          [params.textDocument.uri]: [
            {
              range: {
                start: { line: startLine, character: matchIndex },
                end: { line: startLine, character: matchIndex + 1 },
              },
              newText: '==',
            },
          ],
        },
      };

      const action = CodeAction.create(
        `Change '=' to '=='`,
        edit,
        CodeActionKind.QuickFix,
      );
      action.diagnostics = [diagnostic];
      actions.push(action);
    }
    return actions;
  },
};

export const UnknownTagStrategy: CodeActionStrategy = {
  matches(diagnostic) {
    return (
      diagnostic.code === DIAGNOSTIC_CODES.UNKNOWN_TAG ||
      (typeof diagnostic.message === 'string' &&
        /tag\s+["']?([a-zA-Z0-9_-]+)["']?\s+not found/.test(diagnostic.message))
    );
  },
  execute(doc, diagnostic, params) {
    const actions: CodeAction[] = [];
    const data = diagnostic.data as { tagName?: string } | undefined;
    const tagText = doc.getText(diagnostic.range);
    let tagName = data?.tagName;
    const message = diagnostic.message;

    if (!tagName && typeof message === 'string') {
      const match = message.match(/tag\s+["']?([a-zA-Z0-9_-]+)["']?\s+not found/);
      if (match) {
        tagName = match[1];
      }
    }

    if (tagName) {
      const closestTag = getClosestTag(tagName);
      if (closestTag) {
        const newText = tagText.replace(tagName, closestTag);
        const edit = {
          changes: {
            [params.textDocument.uri]: [
              {
                range: diagnostic.range,
                newText,
              },
            ],
          },
        };
        const action = CodeAction.create(
          `Change tag to "${closestTag}"`,
          edit,
          CodeActionKind.QuickFix,
        );
        action.diagnostics = [diagnostic];
        actions.push(action);
      }
    }

    if (tagName && tagText.includes('=')) {
      // Correct to assignVar
      const newTextVar = tagText.replace(tagName, `assignVar ${tagName}`);
      const editVar = {
        changes: {
          [params.textDocument.uri]: [
            {
              range: diagnostic.range,
              newText: newTextVar,
            },
          ],
        },
      };
      const actionVar = CodeAction.create(`Use "assignVar" tag`, editVar, CodeActionKind.QuickFix);
      actionVar.diagnostics = [diagnostic];
      actions.push(actionVar);

      // Correct to assign
      const newTextAssign = tagText.replace(tagName, `assign ${tagName}`);
      const editAssign = {
        changes: {
          [params.textDocument.uri]: [
            {
              range: diagnostic.range,
              newText: newTextAssign,
            },
          ],
        },
      };
      const actionAssign = CodeAction.create(`Use "assign" tag`, editAssign, CodeActionKind.QuickFix);
      actionAssign.diagnostics = [diagnostic];
      actions.push(actionAssign);
    }
    return actions;
  },
};

// ==========================================
// Strategy Registry
// ==========================================

const STRATEGY_REGISTRY = new Map<string, CodeActionStrategy>();
const STRATEGY_LIST: CodeActionStrategy[] = [
  FallbackStrategy,
  BranchMismatchStrategy,
  DelimiterStrategy,
  UnknownFilterStrategy,
  QuotedFilterStrategy,
  InlineMathStrategy,
  ConditionalAssignmentStrategy,
  UnknownTagStrategy,
];

const registerStrategy = (strategy: CodeActionStrategy, ...codes: string[]) => {
  for (const code of codes) {
    STRATEGY_REGISTRY.set(code, strategy);
  }
};

registerStrategy(
  FallbackStrategy,
  DIAGNOSTIC_CODES.COERCION_WARNING,
  DIAGNOSTIC_CODES.NIL_PROPAGATION,
);
registerStrategy(BranchMismatchStrategy, DIAGNOSTIC_CODES.BRANCH_TYPE_MISMATCH);
registerStrategy(DelimiterStrategy, DIAGNOSTIC_CODES.UNCLOSED_DELIMITER);
registerStrategy(UnknownFilterStrategy, DIAGNOSTIC_CODES.UNKNOWN_FILTER);
registerStrategy(QuotedFilterStrategy, DIAGNOSTIC_CODES.EXPECTED_FILTER_NAME);
registerStrategy(InlineMathStrategy, DIAGNOSTIC_CODES.INLINE_MATH);
registerStrategy(ConditionalAssignmentStrategy, DIAGNOSTIC_CODES.CONDITIONAL_ASSIGNMENT);
registerStrategy(UnknownTagStrategy, DIAGNOSTIC_CODES.UNKNOWN_TAG);

// ==========================================
// Main Dispatcher Handler
// ==========================================

export function handleCodeAction(
  documents: TextDocuments<TextDocument>,
  params: CodeActionParams,
  documentManager?: DocumentManager,
  liquidEngine?: Liquid,
): (Command | CodeAction)[] {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const codeActions: CodeAction[] = [];

  for (const diagnostic of params.context.diagnostics) {
    const message = diagnostic.message;
    if (typeof message !== 'string') {
      continue;
    }

    const codeStr = diagnostic.code?.toString();
    let strategy = codeStr ? STRATEGY_REGISTRY.get(codeStr) : undefined;
    if (!strategy) {
      strategy = STRATEGY_LIST.find((s) => s.matches?.(diagnostic));
    }

    if (strategy) {
      const actions = strategy.execute(doc, diagnostic, params, documentManager, liquidEngine);
      codeActions.push(...actions);
    }
  }

  return codeActions;
}
