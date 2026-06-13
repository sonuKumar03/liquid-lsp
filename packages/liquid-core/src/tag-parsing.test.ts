import { describe, expect, it } from 'vitest';
import {
  parseAssignKeyValue,
  parseCaptureVariable,
  parseForLoopVariable,
} from './tag-parsing.js';
import { lexical } from './lexical.js';

describe('tag-parsing', () => {
  it('parses assign key/value using liquidjs identifier grammar', () => {
    const parsed = parseAssignKeyValue('my_var = 1 | plus: 2');
    expect(parsed).toEqual({ key: 'my_var', value: '1 | plus: 2' });
  });

  it('parses assign values containing percent signs', () => {
    const parsed = parseAssignKeyValue('note = "100%"');
    expect(parsed).toEqual({ key: 'note', value: '"100%"' });
  });

  it('parses capture and for loop variables', () => {
    expect(parseCaptureVariable('captured_body')).toBe('captured_body');
    expect(parseForLoopVariable('item in items')).toBe('item');
  });

  it('exposes lexical helpers from liquidjs', () => {
    expect(lexical.isVariable('user.address')).toBe(true);
    expect(lexical.isLiteral('"hello"')).toBe(true);
  });
});
