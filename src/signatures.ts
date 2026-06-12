import { TextDocuments } from 'vscode-languageserver/node';
import type { SignatureHelp, SignatureHelpParams } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

const FILTER_SIGNATURES: Record<string, { label: string; parameters: { label: string }[]; documentation?: string }> = {
  truncate: {
    label: 'truncate(length: number, truncate_string: string = "...")',
    parameters: [
      { label: 'length' },
      { label: 'truncate_string' }
    ],
    documentation: 'Truncates a string down to the number of characters passed as the first parameter. An optional second parameter can be passed to append to the truncated string.'
  },
  default: {
    label: 'default(fallback: any)',
    parameters: [
      { label: 'fallback' }
    ],
    documentation: 'Returns a fallback value if the input is nil, false, or empty.'
  },
  plus: {
    label: 'plus(value: number)',
    parameters: [
      { label: 'value' }
    ],
    documentation: 'Adds a number to another number.'
  },
  minus: {
    label: 'minus(value: number)',
    parameters: [
      { label: 'value' }
    ],
    documentation: 'Subtracts a number from another number.'
  },
  times: {
    label: 'times(factor: number)',
    parameters: [
      { label: 'factor' }
    ],
    documentation: 'Multiplies a number by another number.'
  },
  divided_by: {
    label: 'divided_by(divisor: number)',
    parameters: [
      { label: 'divisor' }
    ],
    documentation: 'Divides a number by another number. The result is rounded to an integer unless either the dividend or divisor is a float.'
  },
  modulo: {
    label: 'modulo(divisor: number)',
    parameters: [
      { label: 'divisor' }
    ],
    documentation: 'Returns the remainder of a division operation.'
  },
  replace: {
    label: 'replace(search: string, replace: string)',
    parameters: [
      { label: 'search' },
      { label: 'replace' }
    ],
    documentation: 'Replaces every occurrence of the first argument with the second argument.'
  },
  slice: {
    label: 'slice(start: number, length: number = 1)',
    parameters: [
      { label: 'start' },
      { label: 'length' }
    ],
    documentation: 'Returns a substring starting at the specified index.'
  },
  split: {
    label: 'split(delimiter: string)',
    parameters: [
      { label: 'delimiter' }
    ],
    documentation: 'Splits a string on the matching delimiter.'
  },
  join: {
    label: 'join(connector: string = " ")',
    parameters: [
      { label: 'connector' }
    ],
    documentation: 'Combines the items of an array into a single string using the connector.'
  },
  date: {
    label: 'date(format: string)',
    parameters: [
      { label: 'format' }
    ],
    documentation: 'Formats a date using strftime format syntax.'
  }
};

export function handleSignatureHelp(
  documents: TextDocuments<TextDocument>,
  params: SignatureHelpParams
): SignatureHelp | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const position = params.position;
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: position
  });

  // Regex to match the current filter and its arguments up to the cursor:
  // e.g. name | truncate: 10, "..."
  const match = lineText.match(/\|\s*([a-zA-Z0-9_-]+)\s*:\s*([^|]*)$/);
  if (!match) return null;

  const filterName = match[1];
  if (!filterName) return null;
  const argsText = match[2] ?? '';

  const sigInfo = FILTER_SIGNATURES[filterName];
  if (!sigInfo) return null;

  // Determine active parameter by counting commas
  const commaCount = (argsText.match(/,/g) || []).length;
  const activeParameter = Math.min(commaCount, sigInfo.parameters.length - 1);

  const sigObj: any = {
    label: sigInfo.label,
    parameters: sigInfo.parameters
  };
  if (sigInfo.documentation) {
    sigObj.documentation = sigInfo.documentation;
  }

  return {
    signatures: [sigObj],
    activeSignature: 0,
    activeParameter
  };
}
