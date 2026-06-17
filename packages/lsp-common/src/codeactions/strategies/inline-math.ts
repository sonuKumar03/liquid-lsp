import { convertToLiquidMath, INLINE_MATH_OPERATOR_MESSAGE } from 'liquid-core';
import { DIAGNOSTIC_CODES } from '../../shared/diagnostic-codes.js';
import { type CodeActionStrategy, createQuickFix } from './strategy.js';

export const InlineMathStrategy: CodeActionStrategy = {
  matches(diagnostic) {
    return (
      diagnostic.code === DIAGNOSTIC_CODES.INLINE_MATH ||
      (typeof diagnostic.message === 'string' &&
        diagnostic.message.includes(INLINE_MATH_OPERATOR_MESSAGE))
    );
  },
  execute(doc, diagnostic, params) {
    const startLine = diagnostic.range.start.line;
    const lineText = doc.getText({
      start: { line: startLine, character: 0 },
      end: { line: startLine + 1, character: 0 },
    });

    const convertedText = convertToLiquidMath(lineText);
    if (convertedText) {
      const range = {
        start: { line: startLine, character: 0 },
        end: { line: startLine, character: lineText.length },
      };
      const replacementText = convertedText.replace(/\r?\n/g, '');
      let filterName = 'plus';
      if (replacementText.includes('divided_by:')) {
        filterName = 'divided_by';
      } else if (replacementText.includes('times:')) {
        filterName = 'times';
      } else if (replacementText.includes('minus:')) {
        filterName = 'minus';
      }

      return [
        createQuickFix(
          `Replace operator with filter | ${filterName}`,
          params.textDocument.uri,
          range,
          replacementText,
          diagnostic,
        ),
      ];
    }
    return [];
  },
};
