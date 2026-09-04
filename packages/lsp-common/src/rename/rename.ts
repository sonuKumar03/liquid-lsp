import {
  Range,
  WorkspaceEdit,
  ResponseError,
  ErrorCodes,
} from 'vscode-languageserver';
import type { TextEdit } from 'vscode-languageserver';
import type { RenameParams } from 'vscode-languageserver';
import {
  getWordAtPosition,
  tokenizeTopLevelSafe,
  createLiquidEngine,
  TagTokenClass,
} from 'liquid-core';
import type { Token } from 'liquid-core';
import {
  findVariableDeclarationsFromTokens,
  type VarDeclaration,
} from '../shared/variable-declarations.js';
import type { DocumentManager } from '../server/document-manager.js';
import type { LiquidType } from '../shared/schema.js';

interface ScopeRange {
  start: number;
  end: number;
  tagName: string;
}

const BLOCK_START_TAGS = ['if', 'unless', 'for', 'case', 'tablerow', 'capture'];

function getScopes(tokens: Token[], docText: string): ScopeRange[] {
  const blockStack: { name: string; begin: number }[] = [];
  const scopes: ScopeRange[] = [];

  for (const token of tokens) {
    if (!(token instanceof TagTokenClass)) continue;
    const name = token.name;
    if (BLOCK_START_TAGS.includes(name)) {
      blockStack.push({ name, begin: token.begin });
    } else if (name.startsWith('end')) {
      const startName = name.slice(3);
      const idx = blockStack.map((s) => s.name).lastIndexOf(startName);
      if (idx !== -1) {
        const startTag = blockStack[idx]!;
        scopes.push({
          start: startTag.begin,
          end: token.end,
          tagName: startTag.name,
        });
        blockStack.splice(idx, 1);
      }
    }
  }

  for (const openBlock of blockStack) {
    scopes.push({
      start: openBlock.begin,
      end: docText.length,
      tagName: openBlock.name,
    });
  }

  return scopes;
}

function sameScope(a: ScopeRange, b: ScopeRange): boolean {
  return a.start === b.start && a.end === b.end && a.tagName === b.tagName;
}

function getInnermostScope(
  scopes: ScopeRange[],
  offset: number,
  docLength: number,
): ScopeRange {
  let innermost: ScopeRange = { start: 0, end: docLength, tagName: 'root' };
  let minLength = docLength;

  for (const s of scopes) {
    if (s.start <= offset && offset <= s.end) {
      const len = s.end - s.start;
      if (len < minLength) {
        minLength = len;
        innermost = s;
      }
    }
  }

  return innermost;
}

function rangeContainsPosition(
  range: Range,
  position: RenameParams['position'],
): boolean {
  const startsBefore =
    range.start.line < position.line ||
    (range.start.line === position.line &&
      range.start.character <= position.character);
  const endsAfter =
    range.end.line > position.line ||
    (range.end.line === position.line &&
      position.character <= range.end.character);
  return startsBefore && endsAfter;
}

function getBindingScope(
  declarations: VarDeclaration[],
  scopes: ScopeRange[],
  word: string,
  cursorOffset: number,
  cursorPosition: RenameParams['position'],
  docLength: number,
  offsetAt: (position: RenameParams['position']) => number,
): ScopeRange {
  const declarationAtCursor = declarations.find(
    (decl) =>
      decl.name === word && rangeContainsPosition(decl.range, cursorPosition),
  );

  if (declarationAtCursor) {
    const declOffset = offsetAt(declarationAtCursor.range.start);
    return getInnermostScope(scopes, declOffset, docLength);
  }

  let bestDeclaration: { scope: ScopeRange; offset: number } | undefined;

  for (const declaration of declarations) {
    if (declaration.name !== word) {
      continue;
    }

    const declarationOffset = offsetAt(declaration.range.start);
    const scope = getInnermostScope(scopes, declarationOffset, docLength);
    if (
      scope.start <= cursorOffset &&
      cursorOffset <= scope.end &&
      declarationOffset <= cursorOffset
    ) {
      if (
        !bestDeclaration ||
        scope.end - scope.start <
          bestDeclaration.scope.end - bestDeclaration.scope.start ||
        (sameScope(scope, bestDeclaration.scope) &&
          declarationOffset > bestDeclaration.offset)
      ) {
        bestDeclaration = { scope, offset: declarationOffset };
      }
    }
  }

  return (
    bestDeclaration?.scope ?? getInnermostScope(scopes, cursorOffset, docLength)
  );
}

function isNestedInsideScope(child: ScopeRange, parent: ScopeRange): boolean {
  return (
    parent.start <= child.start &&
    child.end <= parent.end &&
    !sameScope(child, parent)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function handleRename(
  documentManager: DocumentManager,
  params: RenameParams,
  globalSchema?: Map<string, LiquidType>,
): WorkspaceEdit | null {
  const doc = documentManager.documents.get(params.textDocument.uri);
  if (!doc) return null;

  const position = params.position;
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 },
  });

  const word = getWordAtPosition(lineText, position.character);
  if (!word) return null;

  const newName = params.newName.trim();
  if (!newName) {
    throw new ResponseError(
      ErrorCodes.InvalidParams,
      'New name cannot be empty.',
    );
  }

  // 1. External Schema Guard for old variable name
  if (globalSchema?.has(word)) {
    throw new ResponseError(
      ErrorCodes.InternalError,
      `Cannot rename "${word}" — it is defined in the external schema and controlled by the backend. Renaming it here will break runtime data injection.`,
    );
  }

  // 2. External Schema Guard for new variable name
  if (globalSchema?.has(newName)) {
    throw new ResponseError(
      ErrorCodes.InternalError,
      `Cannot rename to "${newName}" — it is defined in the external schema and controlled by the backend.`,
    );
  }

  const engine = createLiquidEngine();
  const tokens = tokenizeTopLevelSafe(doc.getText(), engine);
  const declarations = findVariableDeclarationsFromTokens(doc, tokens);

  const docText = doc.getText();
  const cursorOffset = doc.offsetAt(position);
  const scopes = getScopes(tokens, docText);
  const targetScope = getBindingScope(
    declarations,
    scopes,
    word,
    cursorOffset,
    position,
    docText.length,
    (pos) => doc.offsetAt(pos),
  );
  const shadowScopes = declarations
    .filter((declaration) => declaration.name === word)
    .map((declaration) =>
      getInnermostScope(
        scopes,
        doc.offsetAt(declaration.range.start),
        docText.length,
      ),
    )
    .filter((scope) => isNestedInsideScope(scope, targetScope));

  // 3. Naming Collision / Shadowing Check
  const collisions = declarations.filter((d) => d.name === newName);
  if (collisions.length > 0) {
    const cursorInner = getInnermostScope(scopes, cursorOffset, docText.length);

    for (const collision of collisions) {
      const declOffset = doc.offsetAt(collision.range.start);
      const declInner = getInnermostScope(scopes, declOffset, docText.length);

      const isConflict =
        JSON.stringify(cursorInner) === JSON.stringify(declInner) ||
        (cursorInner.start <= declOffset && declOffset <= cursorInner.end) ||
        (declInner.start <= cursorOffset && cursorOffset <= declInner.end);

      if (isConflict) {
        const declLine = collision.range.start.line;
        throw new ResponseError(
          ErrorCodes.InternalError,
          `Naming collision: renaming "${word}" to "${newName}" will shadow an existing variable defined on line ${declLine + 1}.`,
        );
      }
    }
  }
  // Clean comments and strings preserving character counts
  let cleanText = docText;

  // Clean {% comment %} ... {% endcomment %}
  cleanText = cleanText.replace(
    /\{%\s*comment\s*%\}([\s\S]*?)\{%\s*endcomment\s*%\}/g,
    (match) => {
      return ' '.repeat(match.length);
    },
  );

  // Clean {# ... #}
  cleanText = cleanText.replace(/\{#([\s\S]*?)#\}/g, (match) => {
    return ' '.repeat(match.length);
  });

  // Clean strings preserving quotes
  cleanText = cleanText.replace(/"([^"\\]|\\.)*"/g, (match) => {
    return '"' + ' '.repeat(match.length - 2) + '"';
  });
  cleanText = cleanText.replace(/'([^'\\]|\\.)*'/g, (match) => {
    return "'" + ' '.repeat(match.length - 2) + "'";
  });

  const regex = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'g');
  const textEdits: TextEdit[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(cleanText)) !== null) {
    const matchIndex = match.index;
    if (matchIndex < targetScope.start || matchIndex > targetScope.end) {
      continue;
    }
    if (
      shadowScopes.some(
        (scope) => scope.start <= matchIndex && matchIndex <= scope.end,
      )
    ) {
      continue;
    }

    const startPos = doc.positionAt(matchIndex);
    const endPos = doc.positionAt(matchIndex + word.length);
    textEdits.push({
      range: Range.create(startPos, endPos),
      newText: newName,
    });
  }

  if (textEdits.length === 0) {
    return null;
  }

  return {
    changes: {
      [params.textDocument.uri]: textEdits,
    },
  };
}
