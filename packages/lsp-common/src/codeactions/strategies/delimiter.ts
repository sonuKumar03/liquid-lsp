import { CodeAction, CodeActionKind, Range } from 'vscode-languageserver';
import { BLOCK_OPEN_TAG_NAMES } from 'liquid-core';
import { DIAGNOSTIC_CODES } from '../../shared/diagnostic-codes.js';
import { type CodeActionStrategy, createQuickFix } from './strategy.js';

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
    if (
      trimmedText.startsWith('{%') &&
      trimmedText.endsWith('}') &&
      !trimmedText.endsWith('%}')
    ) {
      const lastBraceIndex = rangeText.lastIndexOf('}');
      if (lastBraceIndex !== -1) {
        const bracePosition = doc.positionAt(
          doc.offsetAt(diagnostic.range.start) + lastBraceIndex,
        );
        const replaceRange = Range.create(bracePosition, {
          line: bracePosition.line,
          character: bracePosition.character + 1,
        });
        actions.push(
          createQuickFix(
            `Close with %}`,
            params.textDocument.uri,
            replaceRange,
            '%}',
            diagnostic,
          ),
        );
      }
    } else if (
      trimmedText.startsWith('{{') &&
      trimmedText.endsWith('}') &&
      !trimmedText.endsWith('}}')
    ) {
      const lastBraceIndex = rangeText.lastIndexOf('}');
      if (lastBraceIndex !== -1) {
        const bracePosition = doc.positionAt(
          doc.offsetAt(diagnostic.range.start) + lastBraceIndex,
        );
        const replaceRange = Range.create(bracePosition, {
          line: bracePosition.line,
          character: bracePosition.character + 1,
        });
        actions.push(
          createQuickFix(
            `Close with }}`,
            params.textDocument.uri,
            replaceRange,
            '}}',
            diagnostic,
          ),
        );
      }
    }
    return actions;
  },
};
