import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    teardownTimeout: 30000,
    projects: [
      {
        test: {
          name: 'key-pointer-schema',
          root: resolve(__dirname, 'packages/key-pointer-schema'),
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'liquid-core',
          root: resolve(__dirname, 'packages/liquid-core'),
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'lsp-common',
          root: resolve(__dirname, 'packages/lsp-common'),
          include: ['src/**/*.test.ts'],
          environment: 'node',
          bail: 1,
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
      {
        test: {
          name: 'lsp-browser',
          root: resolve(__dirname, 'packages/lsp-browser'),
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
