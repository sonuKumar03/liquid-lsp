import type { DocumentOnTypeFormattingParams, DocumentFormattingParams, TextEdit } from 'vscode-languageserver/node';
import { TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

export function handleOnTypeFormatting(
  documents: TextDocuments<TextDocument>,
  params: DocumentOnTypeFormattingParams
): TextEdit[] | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const position = params.position;
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: position
  });

  // Check if they completed typing a tag closing delimiter "%}"
  if (lineText.endsWith('%}')) {
    const lastOpen = lineText.lastIndexOf('{%');
    if (lastOpen === -1) return null;

    const tagContent = lineText.slice(lastOpen + 2, -2).trim();
    const firstWord = tagContent.split(/\s+/)[0];
    if (!firstWord) return null;

    // List of block tags that require closing
    const blockTags = ['if', 'for', 'unless', 'capture', 'tablerow', 'case', 'comment'];
    if (blockTags.includes(firstWord)) {
      const endTag = `end${firstWord}`;
      
      // Auto-insert a double newline and the closing tag
      const textToInsert = `\n\n{% ${endTag} %}`;
      
      return [
        {
          range: { start: position, end: position },
          newText: textToInsert
        }
      ];
    }
  }

  return null;
}

export function handleDocumentFormatting(
  documents: TextDocuments<TextDocument>,
  params: DocumentFormattingParams
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
      newText: formattedText
    }
  ];
}

export function formatLiquid(text: string): string {
  // 1. Format tags: {% ... %}
  let formatted = text.replace(/\{%([\s\S]*?)%\}/g, (match, content) => {
    const lines = content.split('\n');
    const formattedLines = lines.map((line: string, index: number) => {
      let formattedLine = formatExpression(line);
      if (index === 0) {
        formattedLine = formattedLine.trimStart();
      }
      if (index === lines.length - 1) {
        formattedLine = formattedLine.trimEnd();
      }
      return formattedLine;
    });
    const joined = formattedLines.join('\n');
    if (!joined.trim()) return '{% %}';
    return `{% ${joined.trim()} %}`;
  });

  // 2. Format outputs: {{ ... }}
  formatted = formatted.replace(/\{\{([\s\S]*?)\}\}/g, (match, content) => {
    const lines = content.split('\n');
    const formattedLines = lines.map((line: string, index: number) => {
      let formattedLine = formatExpression(line);
      if (index === 0) {
        formattedLine = formattedLine.trimStart();
      }
      if (index === lines.length - 1) {
        formattedLine = formattedLine.trimEnd();
      }
      return formattedLine;
    });
    const joined = formattedLines.join('\n');
    if (!joined.trim()) return '{{ }}';
    return `{{ ${joined.trim()} }}`;
  });

  return formatted;
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
  return parts.join('');
}

