import { DIAGNOSTIC_CODES } from '../../shared/diagnostic-codes.js';
import { type CodeActionStrategy, createQuickFix } from './strategy.js';

export const UnknownFilterStrategy: CodeActionStrategy = {
  matches(diagnostic) {
    return diagnostic.code === DIAGNOSTIC_CODES.UNKNOWN_FILTER;
  },
  execute(doc, diagnostic, params) {
    const data = diagnostic.data as { suggestedFilter?: string } | undefined;
    const suggestedFilter = data?.suggestedFilter;
    if (suggestedFilter) {
      return [
        createQuickFix(
          `Change to "${suggestedFilter}"`,
          params.textDocument.uri,
          diagnostic.range,
          suggestedFilter,
          diagnostic,
        ),
      ];
    }
    return [];
  },
};
