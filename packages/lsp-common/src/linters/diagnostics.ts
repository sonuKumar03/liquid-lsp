import type { Diagnostic, Connection } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { type Liquid, type TopLevelToken, tokenizeTopLevel } from 'liquid-core';
import type { LiquidType } from '../shared/schema.js';
import type { SchemaLoadError, VariableDeclaration } from 'key-pointer-schema';
import { schemaLoadErrorsToDiagnostics } from '../shared/schema-load-errors.js';
import { collectEngineValidationDiagnostics } from '../shared/engine-validations.js';
import { collectLifecycleDiagnostics } from './lifecycle.js';
import { checkUnclosedDelimiters } from './diagnostics/unclosed-delimiters.js';
import { collectSyntaxDiagnostics } from './diagnostics/syntax.js';

export async function validateTextDocument(
  connection: Connection,
  textDocument: TextDocument,
  liquidEngine: Liquid,
  globalSchema?: Map<string, LiquidType>,
  schemaVariables?: Map<string, VariableDeclaration>,
  schemaLoadErrors?: SchemaLoadError[],
  precomputedTokens?: TopLevelToken[],
): Promise<void> {
  connection.console.log(
    'LSP server: validating document: ' + textDocument.uri,
  );
  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  checkUnclosedDelimiters(text, diagnostics, textDocument);
  collectSyntaxDiagnostics(
    textDocument,
    diagnostics,
    liquidEngine,
    precomputedTokens,
  );
  collectLifecycleDiagnostics(
    textDocument,
    diagnostics,
    liquidEngine,
    globalSchema,
    schemaVariables,
    precomputedTokens,
  );

  const schemaVarNames = globalSchema
    ? new Set(globalSchema.keys())
    : new Set<string>();
  let validationTokens: TopLevelToken[];
  if (precomputedTokens !== undefined) {
    validationTokens = precomputedTokens;
  } else {
    try {
      validationTokens = tokenizeTopLevel(text, liquidEngine);
    } catch {
      validationTokens = [];
    }
  }
  collectEngineValidationDiagnostics(
    textDocument,
    liquidEngine,
    diagnostics,
    validationTokens,
    schemaVarNames,
  );

  if (schemaLoadErrors && schemaLoadErrors.length > 0) {
    diagnostics.push(...schemaLoadErrorsToDiagnostics(schemaLoadErrors));
  }

  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}
