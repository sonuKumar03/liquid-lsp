import { CodeAction } from 'vscode-languageserver';
import { getClosestTag } from 'liquid-core';
import { DIAGNOSTIC_CODES } from '../../shared/diagnostic-codes.js';
import { type CodeActionStrategy, createQuickFix } from './strategy.js';

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
      const match = message.match(
        /tag\s+["']?([a-zA-Z0-9_-]+)["']?\s+not found/,
      );
      if (match) {
        tagName = match[1];
      }
    }

    if (tagName) {
      const closestTag = getClosestTag(tagName);
      if (closestTag) {
        const newText = tagText.replace(tagName, closestTag);
        actions.push(
          createQuickFix(
            `Change tag to "${closestTag}"`,
            params.textDocument.uri,
            diagnostic.range,
            newText,
            diagnostic,
          ),
        );
      }
    }

    if (tagName && tagText.includes('=')) {
      // Correct to assignVar
      const newTextVar = tagText.replace(tagName, `assignVar ${tagName}`);
      actions.push(
        createQuickFix(
          `Use "assignVar" tag`,
          params.textDocument.uri,
          diagnostic.range,
          newTextVar,
          diagnostic,
        ),
      );

      // Correct to assign
      const newTextAssign = tagText.replace(tagName, `assign ${tagName}`);
      actions.push(
        createQuickFix(
          `Use "assign" tag`,
          params.textDocument.uri,
          diagnostic.range,
          newTextAssign,
          diagnostic,
        ),
      );
    }
    return actions;
  },
};
