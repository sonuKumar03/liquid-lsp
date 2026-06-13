import { describe, expect, it } from 'vitest';
import { tokenizeTopLevelSafe } from 'liquid-core';
import { collectVariableNamesFromTokens } from './token-variables.js';

describe('collectVariableNamesFromTokens', () => {
  it('collects assign, capture, and for variables from tokens', () => {
    const tokens = tokenizeTopLevelSafe(
      '{% assign x = 1 %}{% capture y %}{% for item in list %}',
    );

    expect(collectVariableNamesFromTokens(tokens)).toEqual(['x', 'y', 'item']);
  });
});
