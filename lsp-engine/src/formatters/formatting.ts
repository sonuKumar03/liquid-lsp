import type {
  DocumentOnTypeFormattingParams,
  DocumentFormattingParams,
  TextEdit,
} from 'vscode-languageserver/node';
import { TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  AUTO_CLOSE_BLOCK_TAG_NAMES,
  BLOCK_CLOSE_TAG_NAMES,
  BLOCK_MIDDLE_TAG_NAMES,
  BLOCK_OPEN_TAG_NAMES,
} from 'liquid-core';

export function handleOnTypeFormatting(
  documents: TextDocuments<TextDocument>,
  params: DocumentOnTypeFormattingParams,
): TextEdit[] | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const position = params.position;
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: position,
  });

  // Check if they completed typing a tag closing delimiter "%}"
  if (lineText.endsWith('%}')) {
    const lastOpen = lineText.lastIndexOf('{%');
    if (lastOpen === -1) return null;

    const tagContent = lineText.slice(lastOpen + 2, -2).trim();
    const firstWord = tagContent.split(/\s+/)[0];
    if (!firstWord) return null;

    if (
      AUTO_CLOSE_BLOCK_TAG_NAMES.includes(
        firstWord as (typeof AUTO_CLOSE_BLOCK_TAG_NAMES)[number],
      )
    ) {
      const endTag = `end${firstWord}`;

      // Auto-insert a double newline and the closing tag
      const textToInsert = `\n\n{% ${endTag} %}`;

      return [
        {
          range: { start: position, end: position },
          newText: textToInsert,
        },
      ];
    }
  }

  return null;
}

export function handleDocumentFormatting(
  documents: TextDocuments<TextDocument>,
  params: DocumentFormattingParams,
): TextEdit[] | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const originalText = doc.getText();
  const formattedText = formatLiquid(originalText);

  if (originalText === formattedText) {
    return [];
  }

  const start = { line: 0, character: 0 };
  const end = doc.positionAt(originalText.length);
  return [
    {
      range: { start, end },
      newText: formattedText,
    },
  ];
}

export function formatLiquid(text: string): string {
  const lines = text.split(/\r?\n/);
  let indentLevel = 0;
  const indentString = '  '; // 2 spaces

  const formattedLines = lines.map((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return '';

    // 1. Check if the line starts with a block closer or middle tag
    let decreaseBefore = false;
    let isMiddle = false;

    const tagMatch = trimmedLine.match(/^\{%-?\s*(\w+)/);
    if (tagMatch && tagMatch[1]) {
      const tagName = tagMatch[1];
      if (BLOCK_CLOSE_TAG_NAMES.has(tagName)) {
        decreaseBefore = true;
      } else if (BLOCK_MIDDLE_TAG_NAMES.has(tagName)) {
        isMiddle = true;
      }
    }

    if (decreaseBefore) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    // 2. Format expressions inside tags/outputs on the line and normalize spaces
    let formattedLineText = trimmedLine;

    // Format {% ... %} tags
    formattedLineText = formattedLineText.replace(
      /\{%(-?)([\s\S]*?)(-?)%\}/g,
      (match, dash1, content, dash2) => {
        const cleanContent = formatExpression(content.trim()).trim();
        return `{%${dash1} ${cleanContent} ${dash2}%}`;
      },
    );

    // Format {{ ... }} outputs
    formattedLineText = formattedLineText.replace(
      /\{\{(-?)([\s\S]*?)(-?)\}\}/g,
      (match, dash1, content, dash2) => {
        const cleanContent = formatExpression(content.trim()).trim();
        return `{{${dash1} ${cleanContent} ${dash2}}}`;
      },
    );

    // 3. Apply indentation
    const currentIndent = isMiddle ? Math.max(0, indentLevel - 1) : indentLevel;
    const indentedLine = indentString.repeat(currentIndent) + formattedLineText;

    // 4. Check if the line ends with or contains a block opener tag
    if (tagMatch && tagMatch[1]) {
      const tagName = tagMatch[1];
      if (BLOCK_OPEN_TAG_NAMES.has(tagName)) {
        indentLevel++;
      }
    }

    return indentedLine;
  });

  return formattedLines.join('\n');
}

function formatExpression(expr: string): string {
  const parts = expr.split(/("[^"]*"|'[^']*')/);
  for (let i = 0; i < parts.length; i += 2) {
    let code = parts[i] ?? '';
    code = code.replace(/[ \t]+/g, ' ');

    code = code.replace(/\s*==\s*/g, ' == ');
    code = code.replace(/\s*!=\s*/g, ' != ');
    code = code.replace(/\s*>=\s*/g, ' >= ');
    code = code.replace(/\s*<=\s*/g, ' <= ');
    code = code.replace(/(?<![!<>=])=(?![=])/g, ' = ');
    code = code.replace(/(?<![!<>=])>(?![=])/g, ' > ');
    code = code.replace(/(?<![!<>=])<(?![=])/g, ' < ');

    code = code.replace(/\s*\|\s*/g, ' | ');
    code = code.replace(/\s*:\s*/g, ': ');
    code = code.replace(/\s*,\s*/g, ', ');

    code = code.replace(/ +/g, ' ');

    parts[i] = code;
  }

  // Normalize single quotes to double quotes for string literals (odd indices)
  // unless the literal contains a nested double quote (to avoid escaping complexity).
  for (let i = 1; i < parts.length; i += 2) {
    const literal = parts[i] ?? '';
    if (literal.startsWith("'")) {
      const inner = literal.slice(1, -1);
      if (!inner.includes('"')) {
        parts[i] = `"${inner}"`;
      }
    }
  }

  return parts.join('');
}
