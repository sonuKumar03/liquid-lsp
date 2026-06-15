import { DiagnosticSeverity } from 'vscode-languageserver';
import type { Diagnostic } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  TagTokenClass,
  TokenKind,
  type Liquid,
  type Token,
  type TagTemplate,
  parseAssign,
  checkValidJSON,
  checkAtleastOneDynamicTableAssignPresent,
} from 'liquid-core';
import { DIAGNOSTIC_CODES } from './diagnostic-codes.js';

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

const ASSIGN_DEPENDENCY_TAG_NAMES = new Set([
  'assign',
  'assignVar',
  'parseAssign',
]);

function findTagTokenOnLine(
  tokens: Token[],
  line: number,
  tagNames?: Set<string>,
): InstanceType<typeof TagTokenClass> | undefined {
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
  token: InstanceType<typeof TagTokenClass>,
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
  token: InstanceType<typeof TagTokenClass>,
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

function pushUniqueDiagnostic(
  diagnostics: Diagnostic[],
  diagnostic: Diagnostic,
): void {
  const duplicate = diagnostics.some(
    (d) =>
      d.range.start.line === diagnostic.range.start.line &&
      d.range.start.character === diagnostic.range.start.character &&
      d.message === diagnostic.message,
  );
  if (!duplicate) {
    diagnostics.push(diagnostic);
  }
}

function findTagTokenForTemplate(
  tokens: Token[],
  template: TagTemplate,
): InstanceType<typeof TagTokenClass> | undefined {
  const tagToken = template.token;
  if (tagToken instanceof TagTokenClass) {
    return tagToken;
  }
  const line = (tagToken as { line?: number }).line;
  if (typeof line === 'number') {
    return findTagTokenOnLine(tokens, line, new Set([(template as any).name]));
  }
  return undefined;
}

function reportUseBeforeAssign(
  doc: TextDocument,
  tokens: Token[],
  template: TagTemplate,
  varName: string,
  diagnostics: Diagnostic[],
): void {
  const token = findTagTokenForTemplate(tokens, template);
  const range = token
    ? rangeForIdentifierInTagToken(doc, token, varName)
    : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  const message = `Variable "${varName}" used before assignment in expression "${(template.token as any).args}" on line ${(template.token as any).line}`;

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
  tokens: Token[],
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

function getVariablesFromValue(value: any): string[] {
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
  tokens: Token[],
  parseAssignFn: EngineValidationFns['parseAssign'],
): void {
  const currentSet = new Set(assignedVars);

  if ((template as any).name === 'if' || (template as any).name === 'unless') {
    const impl = template as any;
    for (const branch of impl.branches ?? []) {
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
      impl.elseTemplates ?? [],
      new Set(currentSet),
      diagnostics,
      tokens,
      parseAssignFn,
    );
    return;
  }

  if ((template as any).name === 'for') {
    const impl = template as any;
    const loopSet = new Set(currentSet);
    if (impl.variable) {
      loopSet.add(impl.variable);
    }
    walkTemplates(
      doc,
      engine,
      impl.templates ?? [],
      loopSet,
      diagnostics,
      tokens,
      parseAssignFn,
    );
    walkTemplates(
      doc,
      engine,
      impl.elseTemplates ?? [],
      currentSet,
      diagnostics,
      tokens,
      parseAssignFn,
    );
    return;
  }

  if (ASSIGN_DEPENDENCY_TAG_NAMES.has((template as any).name)) {
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

function walkTemplates(
  doc: TextDocument,
  engine: Liquid,
  templates: TagTemplate[],
  assignedVars: Set<string>,
  diagnostics: Diagnostic[],
  tokens: Token[],
  parseAssignFn: EngineValidationFns['parseAssign'],
): void {
  for (const template of templates) {
    if (!(template.token instanceof TagTokenClass)) {
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
    const templates = engine.parse(text) as TagTemplate[];
    for (const template of templates) {
      if (
        !(template.token instanceof TagTokenClass) ||
        (template as any).name !== 'computeColumn'
      ) {
        continue;
      }
      const impl = template as any;
      const tableName = impl.table?.content;
      const columnName = impl.column?.content;
      if (
        tableName === metadata.tableName &&
        columnName === metadata.columnName
      ) {
        const line = (template.token as { line?: number }).line;
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
  tokens: Token[],
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
  tokens: Token[],
  schemaVarNames: Set<string>,
  parseAssignFn: EngineValidationFns['parseAssign'],
): void {
  const assignedVars = new Set<string>(schemaVarNames);
  const templates = engine.parse(doc.getText()) as TagTemplate[];
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
  tokens: Token[],
  schemaVarNames?: Set<string>,
): void {
  const fns = getValidationFns();
  if (!fns) {
    return;
  }

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
