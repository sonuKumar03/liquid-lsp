import { describe, expect, it } from 'vitest';
import {
  parseAssignKeyValue,
  parseCaptureVariable,
  parseForLoopVariable,
  parseAssignKeyValueWithOffsets,
  parseCaptureVariableWithOffsets,
  parseForLoopVariableWithOffsets,
  lexical,
} from './index.js';

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

  describe('chevrotain offset-aware parsing', () => {
    it('parses assignments and computes exact offsets', () => {
      const parsed = parseAssignKeyValueWithOffsets('  my_var   = 1 | plus: 2');
      expect(parsed).toEqual({
        key: 'my_var',
        keyStart: 2,
        keyEnd: 8,
        value: '1 | plus: 2',
      });
    });

    it('handles incomplete assignments gracefully', () => {
      const parsed = parseAssignKeyValueWithOffsets('my_var = ');
      expect(parsed).toEqual({
        key: 'my_var',
        keyStart: 0,
        keyEnd: 6,
        value: '',
      });
    });

    it('returns null on invalid assignment syntax', () => {
      expect(parseAssignKeyValueWithOffsets('  = 123')).toBeNull();
      expect(parseAssignKeyValueWithOffsets('my_var 123')).toBeNull();
    });

    it('parses capture tags and computes exact offsets', () => {
      const parsed = parseCaptureVariableWithOffsets('  my_captured_var  ');
      expect(parsed).toEqual({
        key: 'my_captured_var',
        keyStart: 2,
        keyEnd: 17,
      });
    });

    it('parses for loops and computes exact offsets', () => {
      const parsed = parseForLoopVariableWithOffsets('  item   in   items  ');
      expect(parsed).toEqual({
        key: 'item',
        keyStart: 2,
        keyEnd: 6,
        collection: 'items',
      });
    });

    it('returns null on invalid for loop syntax', () => {
      expect(parseForLoopVariableWithOffsets('item items')).toBeNull();
      expect(parseForLoopVariableWithOffsets('  in items')).toBeNull();
    });
  });
});
