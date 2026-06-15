import { Tokenizer } from 'liquidjs';
import { closest, distance } from 'fastest-levenshtein';
import { LIQUID_FILTER_NAMES, isKnownLiquidFilter, LIQUID_TAG_NAMES } from './metadata.js';
import {
  CONDITIONAL_ASSIGNMENT_MESSAGE,
  EXPECTED_FILTER_NAME_MESSAGE,
  INLINE_MATH_OPERATOR_MESSAGE,
  hasInlineMathOperators,
  hasSingleEqualsAssignment,
  isConditionalTagLine,
} from './liquid-syntax.js';

/**
 * Truncates and formats complex parser/compiler error messages to a single line.
 */
export function cleanErrorMessage(msg: string): string {
  if (!msg) return 'Liquid syntax error';

  const match = msg.match(/unexpected "([\s\S]+?)"/);
  if (match && match[1]) {
    let rawContent = match[1];
    rawContent = rawContent.replace(/\s+/g, ' ').trim();
    if (rawContent.length > 30) {
      rawContent = rawContent.slice(0, 30) + '...';
    }
    msg = msg.replace(/unexpected "[\s\S]+?"/, `unexpected "${rawContent}"`);
  }

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

  if (cleanMsg.includes(EXPECTED_FILTER_NAME_MESSAGE)) {
    if (isConditionalTagLine(lineText) && hasSingleEqualsAssignment(lineText)) {
      return CONDITIONAL_ASSIGNMENT_MESSAGE;
    }

    if (hasInlineMathOperators(lineText)) {
      return INLINE_MATH_OPERATOR_MESSAGE;
    }
  }

  return cleanMsg;
}

/**
 * Finds the closest matching Liquid filter name from the static list.
 * Returns the match if the edit distance is 3 or less; otherwise null.
 */
export function getClosestFilter(name: string): string | null {
  const match = closest(name, LIQUID_FILTER_NAMES);
  if (match && distance(name, match) <= 3) {
    return match;
  }
  return null;
}

/**
 * Finds the closest matching Liquid tag name from the static list.
 * Returns the match if the edit distance is 3 or less; otherwise null.
 */
export function getClosestTag(name: string): string | null {
  const match = closest(name, LIQUID_TAG_NAMES as unknown as string[]);
  if (match && distance(name, match) <= 3) {
    return match;
  }
  return null;
}

interface CustomToken {
  type: string;
  text: string;
  value?: any;
}

function tokenize(str: string): CustomToken[] {
  const tokenizer = new Tokenizer(str);
  const tokens: CustomToken[] = [];
  while (tokenizer.p < tokenizer.N) {
    const start = tokenizer.p;
    
    // 1. Whitespace
    if (/\s/.test(str[tokenizer.p] || '')) {
      while (tokenizer.p < tokenizer.N && /\s/.test(str[tokenizer.p] || '')) {
        tokenizer.p++;
      }
      tokens.push({
        type: 'space',
        text: str.slice(start, tokenizer.p),
      });
      continue;
    }

    // 2. Try readValue
    const val = tokenizer.readValue();
    if (val) {
      const text = str.slice(start, tokenizer.p);
      if (text === '-') {
        tokenizer.p = start; // Rollback
      } else {
        tokens.push({
          type: 'value',
          text,
          value: val,
        });
        continue;
      }
    }

    // 3. Try readOperator
    const op = tokenizer.readOperator();
    if (op) {
      tokens.push({
        type: 'operator',
        text: str.slice(start, tokenizer.p),
        value: op,
      });
      continue;
    }

    // 4. Fallback one character
    const char = str[tokenizer.p] || '';
    tokenizer.p++;
    tokens.push({
      type: char === '|' ? 'pipe' : char === '=' ? 'equals' : 'other',
      text: char,
    });
  }
  return tokens;
}

/**
 * Automatically converts inline mathematical operations (+, -, *, /) into Liquid filters.
 */
export function convertToLiquidMath(lineText: string): string | null {
  const tokens = tokenize(lineText);
  
  // Normalize: split decrement variable (e.g. a--)
  // Also split positive/negative value prefixes if preceded by value or pipe
  const normalized: CustomToken[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.type === 'value' && token.text.endsWith('--')) {
      const varText = token.text.slice(0, -2);
      normalized.push({ type: 'value', text: varText });
      normalized.push({ type: 'other', text: '-' });
      normalized.push({ type: 'other', text: '-' });
    } else if (
      token.type === 'value' &&
      (token.text.startsWith('+') || token.text.startsWith('-')) &&
      token.text.length > 1
    ) {
      // Check if preceded by value or pipe (ignoring whitespace)
      let precededByValOrPipe = false;
      for (let j = normalized.length - 1; j >= 0; j--) {
        const prev = normalized[j]!;
        if (prev.type === 'space') continue;
        if (prev.type === 'value' || prev.type === 'pipe') {
          precededByValOrPipe = true;
        }
        break;
      }

      if (precededByValOrPipe) {
        const opChar = token.text[0]!;
        const remainingText = token.text.slice(1);
        normalized.push({ type: 'other', text: opChar });
        normalized.push({ type: 'value', text: remainingText });
      } else {
        normalized.push(token);
      }
    } else {
      normalized.push(token);
    }
  }

  let modified = false;

  // 1. Match Increments/Decrements (e.g., a++, a--)
  for (let i = 0; i < normalized.length - 2; ) {
    const t1 = normalized[i];
    if (t1 && t1.type === 'value') {
      let j = i + 1;
      let nextToken = normalized[j];
      if (nextToken && nextToken.type === 'space') {
        j++;
        nextToken = normalized[j];
      }
      const op1 = nextToken;
      if (op1 && (op1.text === '+' || op1.text === '-')) {
        let k = j + 1;
        let nextNextToken = normalized[k];
        if (nextNextToken && nextNextToken.type === 'space') {
          k++;
          nextNextToken = normalized[k];
        }
        const op2 = nextNextToken;
        if (op2 && op2.text === op1.text) {
          const filterName = op1.text === '+' ? 'plus' : 'minus';
          const newText = ` = ${t1.text} | ${filterName}: 1`;
          normalized.splice(i + 1, k - i, {
            type: 'raw',
            text: newText,
          });
          modified = true;
          i = i + 2;
          continue;
        }
      }
    }
    i++;
  }

  // 2. Match Compound Assignment (e.g., a += 5)
  for (let i = 0; i < normalized.length - 2; ) {
    const t1 = normalized[i];
    if (t1 && t1.type === 'value') {
      let j = i + 1;
      let nextToken = normalized[j];
      if (nextToken && nextToken.type === 'space') {
        j++;
        nextToken = normalized[j];
      }
      const op = nextToken;
      if (op && (op.text === '+' || op.text === '-' || op.text === '*' || op.text === '/')) {
        let k = j + 1;
        let nextNextToken = normalized[k];
        if (nextNextToken && nextNextToken.type === 'space') {
          k++;
          nextNextToken = normalized[k];
        }
        const eq = nextNextToken;
        if (eq && eq.type === 'equals') {
          // Extract expression to the end or before closing tag
          let endIdx = normalized.length;
          for (let m = k + 1; m < normalized.length; m++) {
            const currentToken = normalized[m];
            const nextTokenInLoop = normalized[m + 1];
            if (
              currentToken &&
              currentToken.text === '%' &&
              nextTokenInLoop &&
              nextTokenInLoop.text === '}'
            ) {
              endIdx = m;
              break;
            }
            if (
              currentToken &&
              currentToken.text === '}' &&
              nextTokenInLoop &&
              nextTokenInLoop.text === '}'
            ) {
              endIdx = m;
              break;
            }
          }
          const rightSideText = normalized
            .slice(k + 1, endIdx)
            .map((t) => t.text)
            .join('')
            .trim();

          const filterName =
            op.text === '+'
              ? 'plus'
              : op.text === '-'
                ? 'minus'
                : op.text === '*'
                  ? 'times'
                  : 'divided_by';

          const newText = `= ${t1.text} | ${filterName}: ${rightSideText}`;
          normalized.splice(j, endIdx - j, {
            type: 'raw',
            text: newText,
          });
          
          modified = true;
          i = j + 1;
          continue;
        }
      }
    }
    i++;
  }

  // 3. Match Standard / Chained Math (e.g., a + 2, a | + 2, 1 + 2 + 3)
  let iterations = 0;
  while (iterations < 10) {
    let mathMatchIdx = -1;
    let matchT1: CustomToken | null = null;
    let matchOpText = '';
    let matchT2: CustomToken | null = null;
    let matchStart = -1;
    let matchEnd = -1;

    for (let i = 0; i < normalized.length - 2; i++) {
      const t1 = normalized[i];
      if (!t1 || t1.type !== 'value') continue;

      let j = i + 1;
      let hasPipe = false;
      let nextToken = normalized[j];
      if (nextToken && nextToken.type === 'space') {
        j++;
        nextToken = normalized[j];
      }
      if (nextToken && nextToken.type === 'pipe') {
        hasPipe = true;
        j++;
        nextToken = normalized[j];
        if (nextToken && nextToken.type === 'space') {
          j++;
          nextToken = normalized[j];
        }
      }
      const op = nextToken;
      if (op && (op.text === '+' || op.text === '-' || op.text === '*' || op.text === '/')) {
        let k = j + 1;
        let nextNextToken = normalized[k];
        if (nextNextToken && nextNextToken.type === 'space') {
          k++;
          nextNextToken = normalized[k];
        }
        const t2 = nextNextToken;
        if (t2 && t2.type === 'value') {
          // Safety: check that if op is '-', there is space around it or it is a valid operator
          if (op.text === '-') {
            const prevToken = normalized[j - 1];
            const nextAfterOp = normalized[j + 1];
            const isSpaceBefore = prevToken && prevToken.type === 'space';
            const isSpaceAfter = nextAfterOp && nextAfterOp.type === 'space';
            if (!isSpaceBefore && !isSpaceAfter && !hasPipe) {
              continue;
            }
          }

          mathMatchIdx = i;
          matchT1 = t1;
          matchOpText = op.text;
          matchT2 = t2;
          matchStart = i;
          matchEnd = k;
          break;
        }
      }
    }

    if (mathMatchIdx === -1 || !matchT1 || !matchT2) {
      break;
    }

    const filterName =
      matchOpText === '+'
        ? 'plus'
        : matchOpText === '-'
          ? 'minus'
          : matchOpText === '*'
            ? 'times'
            : 'divided_by';

    const foldedText = `${matchT1.text} | ${filterName}: ${matchT2.text}`;
    normalized.splice(matchStart, matchEnd - matchStart + 1, {
      type: 'value',
      text: foldedText,
    });
    modified = true;
    iterations++;
  }

  if (!modified) return null;
  return normalized.map((t) => t.text).join('');
}

export { isKnownLiquidFilter };
