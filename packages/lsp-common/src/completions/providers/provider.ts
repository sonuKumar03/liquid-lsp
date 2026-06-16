import { CompletionItemKind } from 'vscode-languageserver';
import type { CompletionItem, CompletionParams } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Liquid, Token } from 'liquid-core';
import type { LiquidType } from '../../shared/schema.js';
import { collectVariableNamesFromTokens } from '../../shared/token-variables.js';

export interface CompletionContext {
  doc: TextDocument;
  lineText: string;
  tokens: Token[];
  params: CompletionParams;
  localSchema: Map<string, LiquidType>;
  globalSchema?: Map<string, LiquidType> | undefined;
}

export interface CompletionProvider {
  matches(lineText: string): boolean;
  getCompletionItems(context: CompletionContext): CompletionItem[] | null;
}

export function extractDeclaredVariables(
  globalSchema?: Map<string, LiquidType>,
  tokens?: Token[],
): CompletionItem[] {
  const variables = new Set<string>();

  if (tokens) {
    for (const name of collectVariableNamesFromTokens(tokens)) {
      variables.add(name);
    }
  }

  const items = Array.from(variables).map((name) => ({
    label: name,
    kind: CompletionItemKind.Variable,
    data: `var-${name}`,
    detail: 'Liquid Variable',
    documentation: `User-defined Liquid variable extracted from the template.`,
  }));

  if (globalSchema) {
    for (const [varName, varType] of globalSchema.entries()) {
      let detail = 'Schema Variable';
      let docText = `Global context variable of type `;
      if (typeof varType === 'string') {
        detail = `${varType} (Schema)`;
        docText += `\`${varType}\`.`;
      } else if (typeof varType === 'object') {
        detail = `${varType.kind} (Schema)`;
        if (varType.kind === 'dropdown') {
          docText += `dropdown options: ${varType.options.map((o) => `"${o}"`).join(', ')}.`;
        } else {
          docText += `composite structure.`;
        }
      }
      items.push({
        label: varName,
        kind: CompletionItemKind.Variable,
        data: `schema-var-${varName}`,
        detail,
        documentation: docText,
      });
    }
  }

  return items;
}

