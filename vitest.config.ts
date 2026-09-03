import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
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
          name: 'computation-ir',
          root: resolve(__dirname, 'packages/computation-ir'),
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'computation-reference',
          root: resolve(__dirname, 'packages/computation-reference'),
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
