import type {
  DocumentOnTypeFormattingParams,
  DocumentFormattingParams,
  TextEdit,
} from 'vscode-languageserver';
import { TextDocuments } from 'vscode-languageserver';
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

function extractBlockTagsFromLine(line: string): string[] {
  const tags: string[] = [];
  const tagRe = /\{%-?\s*(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(line)) !== null) {
    const tagName = match[1];
    if (tagName) {
      tags.push(tagName);
    }
  }
  return tags;
}

export function formatLiquid(text: string): string {
  const lines = text.split(/\r?\n/);
  let indentLevel = 0;
  const indentString = '  '; // 2 spaces

  const formattedLines = lines.map((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return '';

    const blockTags = extractBlockTagsFromLine(trimmedLine);
    let closeTagCount = 0;
    let openTagCount = 0;
    for (const tagName of blockTags) {
      if (BLOCK_CLOSE_TAG_NAMES.has(tagName)) {
        closeTagCount++;
      }
      if (BLOCK_OPEN_TAG_NAMES.has(tagName)) {
        openTagCount++;
      }
    }

    const indentBefore = Math.max(0, indentLevel - closeTagCount);
    const isMiddle =
      blockTags.length > 0 &&
      BLOCK_MIDDLE_TAG_NAMES.has(blockTags[0] as string);

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
    const currentIndent = isMiddle
      ? Math.max(0, indentBefore - 1)
      : indentBefore;
    const indentedLine = indentString.repeat(currentIndent) + formattedLineText;

    // 4. Update indent for following lines (open/close on the same line net out)
    indentLevel = Math.max(0, indentLevel - closeTagCount + openTagCount);

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
