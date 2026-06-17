import { CodeAction } from 'vscode-languageserver';
import { getClosestFilter } from 'liquid-core';
import { DIAGNOSTIC_CODES } from '../../shared/diagnostic-codes.js';
import { type CodeActionStrategy, createQuickFix } from './strategy.js';

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
      actions.push(
        createQuickFix(
          `Remove quotes from filter name`,
          params.textDocument.uri,
          diagnostic.range,
          unquoted,
          diagnostic,
        ),
      );

      // Correct spelling suggestion
      const closestFilter = getClosestFilter(unquoted);
      if (closestFilter) {
        actions.push(
          createQuickFix(
            `Change to filter "${closestFilter}"`,
            params.textDocument.uri,
            diagnostic.range,
            closestFilter,
            diagnostic,
          ),
        );
      }
    }
    return actions;
  },
};
