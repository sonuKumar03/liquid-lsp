import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    bail: 1,
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 30000,
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', '**/dist/**', 'node_modules/**', '**/node_modules/**'],
  },
});
