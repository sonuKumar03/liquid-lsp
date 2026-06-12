import { closest, distance } from 'fastest-levenshtein';
import { LIQUID_FILTERS } from './constants.js';

/**
 * Truncates and formats complex parser/compiler error messages to a single line.
 */
export function cleanErrorMessage(msg: string): string {
  if (!msg) return 'Liquid syntax error';

  // Match the 'unexpected "..."' pattern and clean it up
  const match = msg.match(/unexpected "([\s\S]+?)"/);
  if (match && match[1]) {
    let rawContent = match[1];
    // Replace newlines and excessive whitespace with a single space
    rawContent = rawContent.replace(/\s+/g, ' ').trim();
    // Truncate if it's too long
    if (rawContent.length > 30) {
      rawContent = rawContent.slice(0, 30) + '...';
    }
    // Re-insert it
    msg = msg.replace(/unexpected "[\s\S]+?"/, `unexpected "${rawContent}"`);
  }

  // Replace any remaining newlines with spaces in the whole message
  return msg.replace(/\r?\n/g, ' ');
}

/**
 * Extracts the full alphanumeric word under the cursor position.
 */
export function getWordAtPosition(text: string, character: number): string {
  if (character < 0 || character >= text.length) return '';

  let start = character;
  while (start > 0 && /[a-zA-Z0-9_-]/.test(text[start - 1] || '')) {
    start--;
  }

  let end = character;
  while (end < text.length && /[a-zA-Z0-9_-]/.test(text[end] || '')) {
    end++;
  }

  return text.slice(start, end).trim();
}

/**
 * Enhances standard Liquid parser errors into helpful suggestions for math operators or conditional assignments.
 */
export function getEnhancedErrorMessage(msg: string, lineText: string): string {
  const cleanMsg = cleanErrorMessage(msg);

  if (cleanMsg.includes('expected "|" before filter')) {
    // 1. Check if they wrote a single equal assignment inside a conditional block
    const singleEqualRegex = /(?<![=!<>])=(?![=<>])/;
    const isConditional = /\b(if|unless|elsif|when)\b/.test(lineText);
    if (isConditional && singleEqualRegex.test(lineText)) {
      return 'Assignments are not allowed inside conditional statements. Did you mean "=="?';
    }

    // 2. Check if they used math operators (+, -, *, /)
    const mathOperatorRegex = /\+|(?<=\s)-(?=\s)|(?<=\d)-(?=\d)|\*|\//;
    if (mathOperatorRegex.test(lineText)) {
      return 'Liquid does not support inline mathematical operators. Use filters instead, e.g. "| plus: 2".';
    }
  }

  return cleanMsg;
}

/**
 * Finds the closest matching Liquid filter name from our static list.
 * Returns the match if the edit distance is 3 or less; otherwise null.
 */
export function getClosestFilter(name: string): string | null {
  const list = LIQUID_FILTERS.map(f => f.label);
  const match = closest(name, list);
  if (match && distance(name, match) <= 3) {
    return match;
  }
  return null;
}

/**
 * Automatically converts inline mathematical operations (+, -, *, /) into Liquid filters.
 * E.g. "a + 5" becomes "a | plus: 5", "x - y" becomes "x | minus: y".
 */
export function convertToLiquidMath(lineText: string): string | null {
  const mathRegex = /([a-zA-Z0-9_-]+|\d+(?:\.\d+)?)\s*([\+\-\*\/])\s*([a-zA-Z0-9_-]+|\d+(?:\.\d+)?)/g;

  let hasMath = false;
  const newText = lineText.replace(mathRegex, (match, op1, operator, op2) => {
    // If it's a hyphenated variable name, like my-var, ignore!
    if (operator === '-' && !lineText.includes(` ${match} `) && !/\s-\s/.test(match)) {
      return match;
    }
    hasMath = true;
    let filter = '';
    switch (operator) {
      case '+': filter = `| plus: ${op2}`; break;
      case '-': filter = `| minus: ${op2}`; break;
      case '*': filter = `| times: ${op2}`; break;
      case '/': filter = `| divided_by: ${op2}`; break;
    }
    return `${op1} ${filter}`;
  });

  return hasMath ? newText : null;
}
