import { LIQUID_TAGS } from '../../shared/constants.js';
import type { CompletionProvider } from './provider.js';
import { extractDeclaredVariables } from './provider.js';

export const TagCompletionProvider: CompletionProvider = {
  matches(lineText) {
    const lastTagOpen = lineText.lastIndexOf('{%');
    const lastTagClose = lineText.lastIndexOf('%}');
    return lastTagOpen !== -1 && lastTagOpen > lastTagClose;
  },

  getCompletionItems(context) {
    const { lineText, globalSchema, tokens } = context;
    const lastTagOpen = lineText.lastIndexOf('{%');
    const tagContent = lineText.slice(lastTagOpen + 2);
    const cleanContent = tagContent.replace(/^\s+/, '');
    const parts = cleanContent.split(/\s+/);

    if (parts.length > 1 && parts[0] !== '') {
      return extractDeclaredVariables(globalSchema, tokens);
    }
    return LIQUID_TAGS;
  },
};
