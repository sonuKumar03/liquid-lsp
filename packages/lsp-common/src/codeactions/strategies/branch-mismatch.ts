import { Range } from 'vscode-languageserver';
import { TagTokenClass } from 'liquid-core';
import { DIAGNOSTIC_CODES } from '../../shared/diagnostic-codes.js';
import { type CodeActionStrategy, createQuickFix } from './strategy.js';

export const BranchMismatchStrategy: CodeActionStrategy = {
  matches(diagnostic) {
    return diagnostic.code === DIAGNOSTIC_CODES.BRANCH_TYPE_MISMATCH;
  },
  execute(doc, diagnostic, params, documentManager, liquidEngine) {
    if (!documentManager || !liquidEngine) return [];

    const diagData = diagnostic.data as
      | {
          varName: string;
          mismatchLine: number;
          mismatchRange: Range;
          expected: 'number' | 'string';
          actual: string;
          ranges: Range[];
        }
      | undefined;

    if (diagData && diagData.ranges) {
      const tokens = documentManager.getTokens(
        params.textDocument.uri,
        liquidEngine,
      );

      const mismatchedToken = tokens.find(
        (t) =>
          t instanceof TagTokenClass &&
          t.line === diagData.mismatchLine &&
          ['assign', 'assignVar', 'parseAssign'].includes(t.name),
      );

      if (mismatchedToken) {
        const tagToken = mismatchedToken as TagTokenClass;
        const tokenText = tagToken.getText();
        const argsOffset = tokenText.indexOf(tagToken.args);
        const equalsIndex = tagToken.args.indexOf('=');

        if (equalsIndex !== -1) {
          const startOffset =
            tagToken.begin +
            (argsOffset >= 0 ? argsOffset : 0) +
            equalsIndex +
            1;
          const endOffset =
            tagToken.begin +
            (argsOffset >= 0 ? argsOffset : 0) +
            tagToken.args.length;

          const rawVal = doc.getText(
            Range.create(
              doc.positionAt(startOffset),
              doc.positionAt(endOffset),
            ),
          );
          const leadingSpaces = rawVal.length - rawVal.trimStart().length;
          const trimmed = rawVal.trim();

          const valueRange = Range.create(
            doc.positionAt(startOffset + leadingSpaces),
            doc.positionAt(startOffset + leadingSpaces + trimmed.length),
          );

          const newText = diagData.expected === 'number' ? '0.0' : '""';
          return [
            createQuickFix(
              `Align "${diagData.varName}" in branch on line ${diagData.mismatchLine + 1} to type ${diagData.expected}`,
              params.textDocument.uri,
              valueRange,
              newText,
              diagnostic,
            ),
          ];
        }
      }
    }
    return [];
  },
};
