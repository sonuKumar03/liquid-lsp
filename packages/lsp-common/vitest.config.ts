import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    bail: 1,
    testTimeout: 5000,
    hookTimeout: 5000,
    teardownTimeout: 5000,
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', '**/dist/**', 'node_modules/**', '**/node_modules/**'],
  },
});
