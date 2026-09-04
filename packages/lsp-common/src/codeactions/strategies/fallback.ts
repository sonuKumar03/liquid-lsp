import type { Range } from 'vscode-languageserver';
import { DIAGNOSTIC_CODES } from '../../shared/diagnostic-codes.js';
import { type CodeActionStrategy, createQuickFix } from './strategy.js';

export const FallbackStrategy: CodeActionStrategy = {
  matches(diagnostic) {
    return (
      diagnostic.code === DIAGNOSTIC_CODES.COERCION_WARNING ||
      diagnostic.code === DIAGNOSTIC_CODES.NIL_PROPAGATION
    );
  },
  execute(doc, diagnostic, params) {
    const diagData = diagnostic.data as
      | { insertRange?: Range; newText?: string }
      | undefined;
    if (diagData?.insertRange && diagData?.newText) {
      return [
        createQuickFix(
          `Add fallback: "${diagData.newText.trim()}"`,
          params.textDocument.uri,
          diagData.insertRange,
          diagData.newText,
          diagnostic,
        ),
      ];
    }
    return [];
  },
};
