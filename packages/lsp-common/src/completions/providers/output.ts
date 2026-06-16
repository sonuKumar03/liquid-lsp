import type { CompletionProvider } from './provider.js';
import { extractDeclaredVariables } from './provider.js';

export const OutputCompletionProvider: CompletionProvider = {
  matches(lineText) {
    const lastOutputOpen = lineText.lastIndexOf('{{');
    const lastOutputClose = lineText.lastIndexOf('}}');
    return lastOutputOpen !== -1 && lastOutputOpen > lastOutputClose;
  },

  getCompletionItems(context) {
    const { globalSchema, tokens } = context;
    return extractDeclaredVariables(globalSchema, tokens);
  },
};
