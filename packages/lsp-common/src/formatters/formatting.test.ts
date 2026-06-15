import { test, expect } from 'vitest';
import { formatLiquid } from './formatting.js';
import {
  startLspServer,
  LSPMessageReader,
  formatLSPMessage,
} from '../shared/test-utils.js';

test('formatLiquid does not nest after same-line comments', () => {
  const input = [
    '{% comment %} E1 fix {% endcomment %}',
    '{% if x == 1 %}',
    '  hello',
    '{% endif %}',
    '{% comment %} E2 fix {% endcomment %}',
    'plain line',
  ].join('\n');

  expect(formatLiquid(input)).toBe(
    [
      '{% comment %} E1 fix {% endcomment %}',
      '{% if x == 1 %}',
      '  hello',
      '{% endif %}',
      '{% comment %} E2 fix {% endcomment %}',
      'plain line',
    ].join('\n'),
  );
});

test('Liquid auto-close block tags', () =>
  new Promise<void>((resolve) => {
    const child = startLspServer();
    let step = 0;

    new LSPMessageReader(child.stdout!, (res) => {
      if (res.method === 'window/logMessage') return;

      if (step === 0 && res.id === 1) {
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'initialized',
            params: {},
          }),
        );
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: {
              textDocument: {
                uri: 'file:///t.liquid',
                languageId: 'liquid',
                version: 1,
                text: '{% for item in items %}',
              },
            },
          }),
        );

        // Send onTypeFormatting request right after the "%}" (line 0, character 24)
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/onTypeFormatting',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              position: { line: 0, character: 24 },
              ch: '}',
              options: { tabSize: 2, insertSpaces: true },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        const edits = res.result;
        expect(edits).toBeDefined();
        expect(edits.length).toBe(1);
        expect(edits[0].newText).toBe('\n\n{% endfor %}');
        expect(edits[0].range.start.line).toBe(0);
        expect(edits[0].range.start.character).toBe(24);

        child.kill('SIGINT');
        resolve();
      }
    });

    child.stdin?.write(
      formatLSPMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { capabilities: {} },
      }),
    );
  }));

test('Liquid document formatting', () =>
  new Promise<void>((resolve) => {
    const child = startLspServer();
    let step = 0;

    new LSPMessageReader(child.stdout!, (res) => {
      if (res.method === 'window/logMessage') return;

      if (step === 0 && res.id === 1) {
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'initialized',
            params: {},
          }),
        );
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: {
              textDocument: {
                uri: 'file:///t.liquid',
                languageId: 'liquid',
                version: 1,
                text: '{%assign  x=10%}\n{{name|upcase}}',
              },
            },
          }),
        );

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/formatting',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              options: { tabSize: 2, insertSpaces: true },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        const edits = res.result;
        expect(edits).toBeDefined();
        expect(edits.length).toBe(1);
        expect(edits[0].newText).toBe(
          '{% assign x = 10 %}\n{{ name | upcase }}',
        );

        child.kill('SIGINT');
        resolve();
      }
    });

    child.stdin?.write(
      formatLSPMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    );
  }));

test('Liquid strict formatting (nesting and quotes)', () =>
  new Promise<void>((resolve) => {
    const child = startLspServer();
    let step = 0;

    new LSPMessageReader(child.stdout!, (res) => {
      if (res.method === 'window/logMessage') return;

      if (step === 0 && res.id === 1) {
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'initialized',
            params: {},
          }),
        );
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: {
              textDocument: {
                uri: 'file:///t.liquid',
                languageId: 'liquid',
                version: 1,
                text: [
                  "{% if status = 'Active' %}",
                  "{% assign name = 'sonu' %}",
                  '{{ name }}',
                  '{% else %}',
                  "{{ 'Inactive user' }}",
                  '{% endif %}',
                ].join('\n'),
              },
            },
          }),
        );

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/formatting',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              options: { tabSize: 2, insertSpaces: true },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        const edits = res.result;
        expect(edits).toBeDefined();
        expect(edits.length).toBe(1);

        const expectedText = [
          '{% if status = "Active" %}',
          '  {% assign name = "sonu" %}',
          '  {{ name }}',
          '{% else %}',
          '  {{ "Inactive user" }}',
          '{% endif %}',
        ].join('\n');

        expect(edits[0].newText).toBe(expectedText);

        child.kill('SIGINT');
        resolve();
      }
    });

    child.stdin?.write(
      formatLSPMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    );
  }));

test('Liquid document formatting regression for complex conditionals', () =>
  new Promise<void>((resolve) => {
    const child = startLspServer();
    let step = 0;

    new LSPMessageReader(child.stdout!, (res) => {
      if (res.method === 'window/logMessage') return;

      if (step === 0 && res.id === 1) {
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'initialized',
            params: {},
          }),
        );
        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: {
              textDocument: {
                uri: 'file:///t.liquid',
                languageId: 'liquid',
                version: 1,
                text: [
                  '{% if sd_effective_date and sd_term_length and sd_term_length.value and sd_term_length.type %}',
                  '{% parseAssign one_day = \'{"value": 1, "type": "DAYS", "days": 1}\' %}',
                  '{% assign temp_expiration = sd_effective_date | plus: sd_term_length %}',
                  '{% assign sd_expiration_date = temp_expiration | minus: one_day %}',
                  '{% else %}',
                  '{% assign sd_expiration_date = nil %}',
                  '{% endif %}'
                ].join('\n'),
              },
            },
          }),
        );

        child.stdin?.write(
          formatLSPMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/formatting',
            params: {
              textDocument: { uri: 'file:///t.liquid' },
              options: { tabSize: 2, insertSpaces: true },
            },
          }),
        );

        step = 1;
      } else if (step === 1 && res.id === 2) {
        const edits = res.result;
        expect(edits).toBeDefined();
        expect(edits.length).toBe(1);

        const expectedText = [
          '{% if sd_effective_date and sd_term_length and sd_term_length.value and sd_term_length.type %}',
          '  {% parseAssign one_day = \'{"value": 1, "type": "DAYS", "days": 1}\' %}',
          '  {% assign temp_expiration = sd_effective_date | plus: sd_term_length %}',
          '  {% assign sd_expiration_date = temp_expiration | minus: one_day %}',
          '{% else %}',
          '  {% assign sd_expiration_date = nil %}',
          '{% endif %}',
        ].join('\n');

        expect(edits[0].newText).toBe(expectedText);

        child.kill('SIGINT');
        resolve();
      }
    });

    child.stdin?.write(
      formatLSPMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    );
  }));

test('formatLiquid splits consecutive logic tags', () => {
  const input = '{% assign x = 1 %} {% assign y = 2 %}';
  expect(formatLiquid(input)).toBe('{% assign x = 1 %}\n{% assign y = 2 %}');
});

test('formatLiquid splits and indents consecutive logic tags inside blocks', () => {
  const input = '{% if true %}{% assign x = 1 %}{% endif %}';
  const expected = [
    '{% if true %}',
    '  {% assign x = 1 %}',
    '{% endif %}',
  ].join('\n');
  expect(formatLiquid(input)).toBe(expected);
});

