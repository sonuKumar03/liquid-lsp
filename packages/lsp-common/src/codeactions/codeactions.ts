import { Command, type CodeAction, type CodeActionParams } from 'vscode-languageserver';
import { TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Liquid } from 'liquid-core';
import type { DocumentManager } from '../server/document-manager.js';
import { DIAGNOSTIC_CODES } from '../shared/diagnostic-codes.js';
import type { CodeActionStrategy } from './strategies/strategy.js';
import { FallbackStrategy } from './strategies/fallback.js';
import { BranchMismatchStrategy } from './strategies/branch-mismatch.js';
import { DelimiterStrategy } from './strategies/delimiter.js';
import { UnknownFilterStrategy } from './strategies/unknown-filter.js';
import { QuotedFilterStrategy } from './strategies/quoted-filter.js';
import { InlineMathStrategy } from './strategies/inline-math.js';
import { ConditionalAssignmentStrategy } from './strategies/conditional-assignment.js';
import { UnknownTagStrategy } from './strategies/unknown-tag.js';

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
