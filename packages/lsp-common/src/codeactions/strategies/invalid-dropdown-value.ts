import { DIAGNOSTIC_CODES } from '../../shared/diagnostic-codes.js';
import { type CodeActionStrategy, createQuickFix } from './strategy.js';

export const InvalidDropdownValueStrategy: CodeActionStrategy = {
  matches(diagnostic) {
    return diagnostic.code === DIAGNOSTIC_CODES.INVALID_DROPDOWN_VALUE;
  },
  execute(doc, diagnostic, params) {
    const data = diagnostic.data as { options?: string[] } | undefined;
    const options = data?.options ?? [];

    return options.map((option) =>
      createQuickFix(
        `Replace with "${option}"`,
        params.textDocument.uri,
        diagnostic.range,
        `"${option}"`,
        diagnostic,
      ),
    );
  },
};
