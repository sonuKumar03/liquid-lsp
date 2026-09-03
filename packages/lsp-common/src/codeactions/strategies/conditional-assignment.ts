import {
  CONDITIONAL_ASSIGNMENT_MESSAGE,
  SINGLE_EQUALS_ASSIGNMENT_REGEX,
} from 'liquid-core';
import { DIAGNOSTIC_CODES } from '../../shared/diagnostic-codes.js';
import { type CodeActionStrategy, createQuickFix } from './strategy.js';

export const ConditionalAssignmentStrategy: CodeActionStrategy = {
  matches(diagnostic) {
    return (
      diagnostic.code === DIAGNOSTIC_CODES.CONDITIONAL_ASSIGNMENT ||
      (typeof diagnostic.message === 'string' &&
        diagnostic.message.includes(CONDITIONAL_ASSIGNMENT_MESSAGE))
    );
  },
  execute(doc, diagnostic, params) {
    const startLine = diagnostic.range.start.line;
    const lineText = doc.getText({
      start: { line: startLine, character: 0 },
      end: { line: startLine + 1, character: 0 },
    });

    const matchIndex = lineText.search(SINGLE_EQUALS_ASSIGNMENT_REGEX);
    if (matchIndex !== -1) {
      const range = {
        start: { line: startLine, character: matchIndex },
        end: { line: startLine, character: matchIndex + 1 },
      };
      return [
        createQuickFix(
          `Change '=' to '=='`,
          params.textDocument.uri,
          range,
          '==',
          diagnostic,
        ),
      ];
    }
    return [];
  },
};
