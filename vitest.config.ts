import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'key-pointer-schema',
          root: 'packages/key-pointer-schema',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'liquid-core',
          root: 'packages/liquid-core',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'lsp-common',
          root: 'packages/lsp-common',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'lsp-browser',
          root: 'packages/lsp-browser',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
