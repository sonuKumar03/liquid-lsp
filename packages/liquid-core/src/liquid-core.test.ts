import { describe, expect, it } from 'vitest';
import {
  createLiquidEngine,
  tokenizeTopLevel,
  tokenizeTopLevelSafe,
  TokenKind,
  TagTokenClass,
  cleanErrorMessage,
  convertToLiquidMath,
  getClosestFilter,
  getEnhancedErrorMessage,
  getWordAtPosition,
  isKnownLiquidFilter,
  isKnownLiquidTag,
  LIQUID_FILTER_NAMES,
  LIQUID_TAG_NAMES,
} from './index.js';

describe('createLiquidEngine', () => {
  it('creates a liquidjs engine instance', () => {
    const engine = createLiquidEngine();
    expect(engine).toBeDefined();
    expect(typeof engine.parse).toBe('function');
  });
});

describe('tokenizeTopLevel', () => {
  it('tokenizes assign and output tags', () => {
    const tokens = tokenizeTopLevel('{% assign x = 1 %}{{ x }}');
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    expect(tokens.some((t) => t.kind === TokenKind.Tag)).toBe(true);
    expect(tokens.some((t) => t.kind === TokenKind.Output)).toBe(true);
  });

  it('does not throw when tokenizing incomplete tags', () => {
    expect(() => tokenizeTopLevelSafe('{% if %}')).not.toThrow();
    expect(tokenizeTopLevelSafe('{% if %}')).toHaveLength(1);
  });
});

describe('metadata', () => {
  it('lists known tags and filters', () => {
    expect(LIQUID_TAG_NAMES.length).toBeGreaterThan(10);
    expect(LIQUID_FILTER_NAMES.length).toBeGreaterThan(10);
    expect(isKnownLiquidTag('assign')).toBe(true);
    expect(isKnownLiquidTag('bogus')).toBe(false);
    expect(isKnownLiquidFilter('plus')).toBe(true);
    expect(isKnownLiquidFilter('bogus')).toBe(false);
  });
});

describe('utils', () => {
  it('extracts word at cursor position', () => {
    expect(getWordAtPosition('hello world', 6)).toBe('world');
  });

  it('cleans multiline unexpected token messages', () => {
    const cleaned = cleanErrorMessage('unexpected "foo\nbar"');
    expect(cleaned).not.toContain('\n');
    expect(cleaned).toContain('unexpected');
  });

  it('enhances conditional assignment parser errors', () => {
    const msg = getEnhancedErrorMessage(
      'expected "|" before filter',
      '{% if x = 1 %}',
    );
    expect(msg).toContain('Assignments are not allowed');
  });

  it('suggests closest filter names', () => {
    expect(getClosestFilter('plu')).toBe('plus');
    expect(getClosestFilter('zzzzzz')).toBeNull();
  });

  it('converts inline math to liquid filters', () => {
    expect(convertToLiquidMath('a + 2')).toBe('a | plus: 2');
    expect(convertToLiquidMath('a | + 2')).toBe('a | plus: 2');
    expect(convertToLiquidMath('a | - 2')).toBe('a | minus: 2');
    expect(convertToLiquidMath('a |+ 2')).toBe('a | plus: 2');
    expect(convertToLiquidMath('a | +2')).toBe('a | plus: 2');
    expect(convertToLiquidMath('no math here')).toBeNull();
  });
});

describe('TagTokenClass', () => {
  it('identifies assign tag tokens', () => {
    const tokens = tokenizeTopLevel('{% assign x = 1 %}');
    const tag = tokens.find((t) => t instanceof TagTokenClass);
    expect(tag).toBeDefined();
    if (tag instanceof TagTokenClass) {
      expect(tag.name).toBe('assign');
    }
  });
});
