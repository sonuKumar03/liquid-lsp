import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createLiquidEngine, tokenizeTopLevel } from 'liquid-core';
import {
  extractLocalVariableTypes,
  unquoteString,
} from './local-variable-types.js';
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
    if (typeof localItemsType === 'object' && localItemsType.kind === 'array') {
      const elem = localItemsType.elementType;
      expect(typeof elem).toBe('object');
      if (typeof elem === 'object' && elem.kind === 'composite') {
        expect(elem.fields.get('title')).toBe('string');
        expect(elem.fields.get('cost')).toBe('number');
      }
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
    if (typeof localItemsType === 'object' && localItemsType.kind === 'array') {
      const elem = localItemsType.elementType;
      expect(typeof elem).toBe('object');
      if (typeof elem === 'object' && elem.kind === 'composite') {
        expect(elem.fields.get('title')).toBe('string');
      }
    }
  });

  it('infers loop variable type from array collection in for loops', () => {
    const engine = createLiquidEngine();
    const compositeType = {
      kind: 'composite' as const,
      fields: new Map([['title', 'string' as const]]),
    };
    const schema = new Map([
      ['items', { kind: 'array' as const, elementType: compositeType }],
    ]);
    const text = '{% for item in items %}{% endfor %}';
    const tokens = tokenizeTopLevel(text, engine);
    const types = extractLocalVariableTypes(schema, tokens, engine);

    const itemType = types.get('item');
    expect(itemType).toBeDefined();
    expect(typeof itemType).toBe('object');
    if (typeof itemType === 'object' && itemType.kind === 'composite') {
      expect(itemType.fields.get('title')).toBe('string');
    }
  });

  it('infers array type for split filter and element type for first/last', () => {
    const engine = createLiquidEngine();
    const schema = new Map([['full_name', 'string' as const]]);

    // Test split -> array<string>
    const text1 = '{% assign names = full_name | split: " " %}';
    const tokens1 = tokenizeTopLevel(text1, engine);
    const types1 = extractLocalVariableTypes(schema, tokens1, engine);
    const namesType = types1.get('names');
    expect(namesType).toBeDefined();
    expect(typeof namesType).toBe('object');
    if (typeof namesType === 'object' && namesType.kind === 'array') {
      expect(namesType.elementType).toBe('string');
    }

    // Test first/last -> string
    const text2 =
      '{% assign names = full_name | split: " " %}{% assign first_name = names | first %}';
    const tokens2 = tokenizeTopLevel(text2, engine);
    const types2 = extractLocalVariableTypes(schema, tokens2, engine);
    expect(types2.get('first_name')).toBe('string');
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

describe('unquoteString', () => {
  it('unquotes double quoted strings', () => {
    expect(unquoteString('"hello"')).toBe('hello');
  });

  it('unquotes single quoted strings', () => {
    expect(unquoteString("'hello'")).toBe('hello');
  });

  it('handles standard escape sequences', () => {
    expect(unquoteString('"line1\\nline2"')).toBe('line1\nline2');
    expect(unquoteString('"tab\\tchar"')).toBe('tab\tchar');
  });

  it('handles Unicode escape sequences', () => {
    expect(unquoteString('"\\u0041"')).toBe('A');
    expect(unquoteString('"\\u0031\\u0032"')).toBe('12');
  });

  it('gracefully handles malformed Unicode escape sequences', () => {
    expect(unquoteString('"\\u00"')).toBe('\\u00');
    expect(unquoteString('"\\u00XYZ"')).toBe('\\u00XYZ');
  });
});
