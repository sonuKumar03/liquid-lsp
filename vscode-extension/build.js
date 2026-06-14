/* global console */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sharedOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
};

console.log('Bundling VS Code extension client...');
await build({
  ...sharedOptions,
  entryPoints: [path.resolve(__dirname, 'src/client.ts')],
  outfile: path.resolve(__dirname, 'dist/client.cjs'),
  external: ['vscode'],
});

console.log('Bundling Liquid language server...');
fs.rmSync(path.resolve(__dirname, 'dist/server'), {
  recursive: true,
  force: true,
});
await build({
  ...sharedOptions,
  entryPoints: [path.resolve(__dirname, '../lsp-engine/src/main.ts')],
  outfile: path.resolve(__dirname, 'dist/server/main.cjs'),
});
