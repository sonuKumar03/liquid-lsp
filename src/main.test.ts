import { test } from 'node:test';
import assert from 'node:assert';
import { greet } from './main.js';

test('greet function returns hello message', () => {
  assert.strictEqual(greet('TypeScript'), 'Hello, TypeScript!');
});
