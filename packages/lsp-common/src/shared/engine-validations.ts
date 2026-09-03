import { DiagnosticSeverity } from 'vscode-languageserver';
import type { Diagnostic } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  TagTokenClass,
  TokenKind,
  type Liquid,
  type TopLevelToken,
  type TagTemplate,
  type ValueTemplate,
  parseAssign,
  checkValidJSON,
  checkAtleastOneDynamicTableAssignPresent,
  Tag,
  IfTag,
  UnlessTag,
  ForTag,
  ComputeColumnTag,
} from 'liquid-core';
import { DIAGNOSTIC_CODES } from './diagnostic-codes.js';
import { ASSIGN_TAG_NAMES } from './constants.js';
import { pushUniqueDiagnostic } from './diagnostic-utils.js';

export type EngineValidationFns = {
  checkValidJSON: (
    engine: Liquid,
    expression: string,
  ) => Array<{ expression: string; errorMessage: string }>;
  checkAtleastOneDynamicTableAssignPresent: (
    engine: Liquid,
    expression: string,
  ) => Array<{
    message: string;
    metadata?: { tableName?: string; columnName?: string };
  }>;
  parseAssign: (
    assignTemplate: TagTemplate,
    engine: Liquid,
  ) => { defined: string; dependsOn: string[] };
};

/** Browser worker registers bundled liquidjs validators before starting the LSP. (Now a no-op since we use static imports) */
export function setEngineValidationFns(fns: EngineValidationFns): void {
  void fns;
}

function getValidationFns(): EngineValidationFns {
  return {
    checkValidJSON,
    checkAtleastOneDynamicTableAssignPresent,
    parseAssign,
  };
}

const PARSE_ASSIGN_LINE_RE = /at line (\d+)/;

// Replaced by shared ASSIGN_TAG_NAMES from constants.js

function findTagTokenOnLine(
  tokens: TopLevelToken[],
  line: number,
  tagNames?: Set<string>,
): TagTokenClass | undefined {
  for (const token of tokens) {
    if (!(token instanceof TagTokenClass)) {
      continue;
    }
    if (token.line !== line) {
      continue;
    }
    if (tagNames && !tagNames.has(token.name)) {
      continue;
    }
    return token;
  }
  return undefined;
}

function rangeForIdentifierInTagToken(
  doc: TextDocument,
  token: TagTokenClass,
  identifier: string,
): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  const raw = token.getText();
  const openIdx = raw.indexOf('%');
  const searchFrom = openIdx >= 0 ? openIdx + 1 : 0;
  const idIdx = raw.indexOf(identifier, searchFrom);
  const nameStart = idIdx >= 0 ? token.begin + idIdx : token.begin;
  const nameEnd = nameStart + identifier.length;
  return {
    start: doc.positionAt(nameStart),
    end: doc.positionAt(nameEnd),
  };
}

function rangeForTagToken(
  doc: TextDocument,
  token: TagTokenClass,
): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return {
    start: doc.positionAt(token.begin),
    end: doc.positionAt(token.end),
  };
}

function isVariableAssigned(
  varName: string,
  assignedVars: Set<string>,
): boolean {
  if (assignedVars.has(varName)) {
    return true;
  }
  const dotIdx = varName.indexOf('.');
  if (dotIdx > 0) {
    const root = varName.slice(0, dotIdx);
    if (assignedVars.has(root)) {
      return true;
    }
  }
  return false;
}

// Replaced by shared pushUniqueDiagnostic from diagnostic-utils.js

/**
 * Resolves the Token for a given TagTemplate, checking if the token
 * is already a TagTokenClass or performing a line-based lookup if it
 * is a plain token from the parser.
 */
function findTagTokenForTemplate(
  tokens: TopLevelToken[],
  template: TagTemplate,
): TagTokenClass | undefined {
  const tagToken = template.token;
  if (tagToken instanceof TagTokenClass) {
    return tagToken;
  }
  const line =
    tagToken && typeof tagToken === 'object' && 'line' in tagToken
      ? (tagToken as { line: unknown }).line
      : undefined;
  if (typeof line === 'number') {
    const name = template instanceof Tag ? template.name : '';
    return findTagTokenOnLine(tokens, line, name ? new Set([name]) : undefined);
  }
  return undefined;
}

function reportUseBeforeAssign(
  doc: TextDocument,
  tokens: TopLevelToken[],
  template: TagTemplate,
  varName: string,
  diagnostics: Diagnostic[],
): void {
  const token = findTagTokenForTemplate(tokens, template);
  const range = token
    ? rangeForIdentifierInTagToken(doc, token, varName)
    : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  const message = `You used "${varName}" before defining it.`;

  pushUniqueDiagnostic(diagnostics, {
    severity: DiagnosticSeverity.Error,
    range,
    message,
    code: DIAGNOSTIC_CODES.USE_BEFORE_ASSIGN,
    data: { variableName: varName },
    source: 'liquid-lsp-linter',
  });
}

function handleAssignTemplate(
  doc: TextDocument,
  engine: Liquid,
  template: TagTemplate,
  assignedVars: Set<string>,
  diagnostics: Diagnostic[],
  tokens: TopLevelToken[],
  parseAssignFn: EngineValidationFns['parseAssign'],
): void {
  const dependency = parseAssignFn(template, engine);
  const curErrors: string[] = [];

  for (const varName of dependency.dependsOn) {
    if (!isVariableAssigned(varName, assignedVars)) {
      curErrors.push(varName);
      reportUseBeforeAssign(doc, tokens, template, varName, diagnostics);
    }
  }

  if (curErrors.length === 0 && dependency.defined) {
    assignedVars.add(dependency.defined);
  }
}

function getVariablesFromValue(value: ValueTemplate): string[] {
  if (!value || !value.initial || !value.initial.postfix) {
    return [];
  }
  const variables: string[] = [];
  for (const token of value.initial.postfix) {
    if (token.kind === TokenKind.PropertyAccess) {
      variables.push(token.getText());
    }
  }
  return variables;
}

function walkTagTemplate(
  doc: TextDocument,
  engine: Liquid,
  template: TagTemplate,
  assignedVars: Set<string>,
  diagnostics: Diagnostic[],
  tokens: TopLevelToken[],
  parseAssignFn: EngineValidationFns['parseAssign'],
): void {
  const currentSet = new Set(assignedVars);

  if (template instanceof IfTag || template instanceof UnlessTag) {
    for (const branch of template.branches ?? []) {
      const branchSet = new Set(currentSet);
      if (branch.value) {
        const condVars = getVariablesFromValue(branch.value);
        for (const variable of condVars) {
          branchSet.add(variable);
        }
      }
      walkTemplates(
        doc,
        engine,
        branch.templates ?? [],
        branchSet,
        diagnostics,
        tokens,
        parseAssignFn,
      );
    }
    walkTemplates(
      doc,
      engine,
      template.elseTemplates ?? [],
      new Set(currentSet),
      diagnostics,
      tokens,
      parseAssignFn,
    );
    return;
  }

  if (template instanceof ForTag) {
    const loopSet = new Set(currentSet);
    if (template.variable) {
      loopSet.add(template.variable);
    }
    walkTemplates(
      doc,
      engine,
      template.templates ?? [],
      loopSet,
      diagnostics,
      tokens,
      parseAssignFn,
    );
    walkTemplates(
      doc,
      engine,
      template.elseTemplates ?? [],
      currentSet,
      diagnostics,
      tokens,
      parseAssignFn,
    );
    return;
  }

  if (template instanceof Tag && ASSIGN_TAG_NAMES.has(template.name)) {
    handleAssignTemplate(
      doc,
      engine,
      template,
      assignedVars,
      diagnostics,
      tokens,
      parseAssignFn,
    );
  }
}

function isTagTemplate(template: unknown): template is TagTemplate {
  return (
    typeof template === 'object' &&
    template !== null &&
    'token' in template &&
    (template as { token: unknown }).token instanceof TagTokenClass
  );
}

function walkTemplates(
  doc: TextDocument,
  engine: Liquid,
  templates: unknown[],
  assignedVars: Set<string>,
  diagnostics: Diagnostic[],
  tokens: TopLevelToken[],
  parseAssignFn: EngineValidationFns['parseAssign'],
): void {
  for (const template of templates) {
    if (!isTagTemplate(template)) {
      continue;
    }
    walkTagTemplate(
      doc,
      engine,
      template,
      assignedVars,
      diagnostics,
      tokens,
      parseAssignFn,
    );
  }
}

function findComputeColumnOpenLine(
  engine: Liquid,
  text: string,
  metadata: { tableName?: string; columnName?: string },
): number | undefined {
  try {
    const { templates } = engine.parser.parseResilient(text);
    for (const template of templates) {
      if (!(template instanceof ComputeColumnTag)) {
        continue;
      }
      const args = template.token.args.trim().split(/\s+/);
      const tableName = args[0];
      const columnName = args[1];
      if (
        tableName === metadata.tableName &&
        columnName === metadata.columnName
      ) {
        const line = template.token.line;
        if (typeof line === 'number') {
          return line;
        }
      }
    }
  } catch {
    // Parser errors are reported by syntax diagnostics.
  }
  return undefined;
}

function collectComputeColumnDiagnostics(
  doc: TextDocument,
  engine: Liquid,
  diagnostics: Diagnostic[],
  tokens: TopLevelToken[],
  checkDynamicTableFn: EngineValidationFns['checkAtleastOneDynamicTableAssignPresent'],
): void {
  const text = doc.getText();

  try {
    for (const tableError of checkDynamicTableFn(engine, text)) {
      const line = findComputeColumnOpenLine(
        engine,
        text,
        tableError.metadata ?? {},
      );
      const token =
        line !== undefined
          ? findTagTokenOnLine(tokens, line, new Set(['computeColumn']))
          : undefined;
      const range = token
        ? rangeForTagToken(doc, token)
        : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

      const tableName = tableError.metadata?.tableName;
      const columnName = tableError.metadata?.columnName;
      const locationHint =
        tableName && columnName ? ` (${tableName}.${columnName})` : '';

      pushUniqueDiagnostic(diagnostics, {
        severity: DiagnosticSeverity.Warning,
        range,
        message: `${tableError.message}${locationHint}`,
        code: DIAGNOSTIC_CODES.INVALID_DYNAMIC_TABLE_COMPUTATION,
        data: tableError.metadata,
        source: 'liquid-lsp-linter',
      });
    }
  } catch {
    // Invalid templates are reported by syntax diagnostics.
  }
}

function collectAssignDependencyDiagnostics(
  doc: TextDocument,
  engine: Liquid,
  diagnostics: Diagnostic[],
  tokens: TopLevelToken[],
  schemaVarNames: Set<string>,
  parseAssignFn: EngineValidationFns['parseAssign'],
): void {
  const assignedVars = new Set<string>(schemaVarNames);
  const { templates } = engine.parser.parseResilient(doc.getText());
  walkTemplates(
    doc,
    engine,
    templates,
    assignedVars,
    diagnostics,
    tokens,
    parseAssignFn,
  );
}

/**
 * Maps liquidjs validation helpers to LSP diagnostics with token-backed ranges.
 */
export function collectEngineValidationDiagnostics(
  doc: TextDocument,
  engine: Liquid,
  diagnostics: Diagnostic[],
  tokens: TopLevelToken[],
  schemaVarNames?: Set<string>,
): void {
  const fns = getValidationFns();

  const text = doc.getText();

  try {
    for (const jsonError of fns.checkValidJSON(engine, text)) {
      const lineMatch = jsonError.errorMessage.match(PARSE_ASSIGN_LINE_RE);
      const line = lineMatch?.[1] ? Number(lineMatch[1]) : undefined;
      const token =
        line !== undefined
          ? findTagTokenOnLine(tokens, line, new Set(['parseAssign']))
          : undefined;
      const range = token
        ? rangeForTagToken(doc, token)
        : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

      pushUniqueDiagnostic(diagnostics, {
        severity: DiagnosticSeverity.Error,
        range,
        message: jsonError.errorMessage,
        code: DIAGNOSTIC_CODES.INVALID_PARSE_ASSIGN_JSON,
        data: { expression: jsonError.expression },
        source: 'liquid-lsp-linter',
      });
    }
  } catch {
    // Invalid templates are reported by syntax diagnostics.
  }

  try {
    collectComputeColumnDiagnostics(
      doc,
      engine,
      diagnostics,
      tokens,
      fns.checkAtleastOneDynamicTableAssignPresent,
    );
  } catch {
    // Invalid templates are reported by syntax diagnostics.
  }

  try {
    collectAssignDependencyDiagnostics(
      doc,
      engine,
      diagnostics,
      tokens,
      schemaVarNames ?? new Set(),
      fns.parseAssign,
    );
  } catch {
    // Parser errors are reported by syntax diagnostics.
  }
}
