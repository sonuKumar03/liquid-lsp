import { DiagnosticSeverity } from 'vscode-languageserver';
import type { Diagnostic } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DIAGNOSTIC_CODES } from '../../shared/diagnostic-codes.js';

export function checkUnclosedDelimiters(
  text: string,
  diagnostics: Diagnostic[],
  doc: TextDocument,
): void {
  const openPattern = /\{[%{]/g;
  let match;
  while ((match = openPattern.exec(text)) !== null) {
    const startIdx = match.index;
    const isTag = text[startIdx + 1] === '%';
    const closeStr = isTag ? '%}' : '}}';

    const nextClose = text.indexOf(closeStr, startIdx + 2);
    const nextOpen = text.slice(startIdx + 2).search(/\{[%{]/);
    const nextOpenIdx = nextOpen !== -1 ? startIdx + 2 + nextOpen : -1;

    if (nextClose === -1 || (nextOpenIdx !== -1 && nextOpenIdx < nextClose)) {
      const start = doc.positionAt(startIdx);
      const lineEnd = text.indexOf('\n', startIdx);
      const endIdx = lineEnd !== -1 ? lineEnd : text.length;
      const end = doc.positionAt(endIdx);
      const rawTag = text.slice(startIdx, endIdx).trim();
      const tagName = rawTag.match(/^\{%\s*(\w+)/)?.[1] ?? '';

      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: { start, end },
        message: `tag ${rawTag} not closed`,
        code: DIAGNOSTIC_CODES.UNCLOSED_DELIMITER,
        data: { tagName, rawTag },
        source: 'liquid-lsp',
      });
    }
  }
}
