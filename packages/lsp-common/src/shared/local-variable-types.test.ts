import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createLiquidEngine, tokenizeTopLevel } from 'liquid-core';
import { extractLocalVariableTypes } from './local-variable-types.js';
import { findVariableDeclarationsFromTokens } from './variable-declarations.js';

describe('extractLocalVariableTypes', () => {
  it('infers string type for assign with percent in literal', () => {
    const engine = createLiquidEngine();
    const text = '{% assign note = "100%" %}';
    const tokens = tokenizeTopLevel(text, engine);
    const types = extractLocalVariableTypes(undefined, tokens, engine);

    expect(types.get('note')).toBe('string');
  });

  it('infers number type after math filters via parser.parseValue', () => {
    const engine = createLiquidEngine();
    const schema = new Map([['x', 'number' as const]]);
    const text = '{% assign y = x | plus: 2 %}';
    const tokens = tokenizeTopLevel(text, engine);
    const types = extractLocalVariableTypes(schema, tokens, engine);

    expect(types.get('y')).toBe('number');
  });

  it('infers type for parseAssign with JSON array string', () => {
    const engine = createLiquidEngine();
    const text = `{% parseAssign local_items = '[{"title": "License", "cost": 450}]' %}`;
    const tokens = tokenizeTopLevel(text, engine);
    const types = extractLocalVariableTypes(undefined, tokens, engine);

    const localItemsType = types.get('local_items');
    expect(localItemsType).toBeDefined();
    expect(typeof localItemsType).toBe('object');
    if (typeof localItemsType === 'object' && localItemsType.kind === 'composite') {
      expect(localItemsType.fields.get('title')).toBe('string');
      expect(localItemsType.fields.get('cost')).toBe('number');
    }
  });

  it('infers type for parseAssign with JSON object string', () => {
    const engine = createLiquidEngine();
    const text = `{% parseAssign item = '{"title": "License", "cost": 450}' %}`;
    const tokens = tokenizeTopLevel(text, engine);
    const types = extractLocalVariableTypes(undefined, tokens, engine);

    const itemType = types.get('item');
    expect(itemType).toBeDefined();
    expect(typeof itemType).toBe('object');
    if (typeof itemType === 'object' && itemType.kind === 'composite') {
      expect(itemType.fields.get('title')).toBe('string');
      expect(itemType.fields.get('cost')).toBe('number');
    }
  });

  it('infers type for parseAssign with raw JSON literal', () => {
    const engine = createLiquidEngine();
    const text = `{% parseAssign local_items = [{"title": "License"}] %}`;
    const tokens = tokenizeTopLevel(text, engine);
    const types = extractLocalVariableTypes(undefined, tokens, engine);

    const localItemsType = types.get('local_items');
    expect(localItemsType).toBeDefined();
    expect(typeof localItemsType).toBe('object');
    if (typeof localItemsType === 'object' && localItemsType.kind === 'composite') {
      expect(localItemsType.fields.get('title')).toBe('string');
    }
  });
});

describe('findVariableDeclarations', () => {
  it('finds assignVar and parseAssign declarations from tokens', () => {
    const engine = createLiquidEngine();
    const text = '{% assignVar a = 1 %}{% parseAssign b = "{\\"k\\":1}" %}';
    const doc = TextDocument.create('file:///t.liquid', 'liquid', 1, text);
    const tokens = tokenizeTopLevel(text, engine);
    const declarations = findVariableDeclarationsFromTokens(doc, tokens);

    expect(declarations.map((d) => d.name)).toEqual(['a', 'b']);
  });
});
