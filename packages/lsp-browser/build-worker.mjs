import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, '../../');

const nodeBuiltinStubs = {
  fs: `
    export function existsSync() { return false; }
    export function readFileSync() { return ''; }
    export default { existsSync, readFileSync };
  `,
  path: `
    export function join(...parts) { return parts.filter(Boolean).join('/'); }
    export function dirname(value) {
      const idx = value.lastIndexOf('/');
      return idx === -1 ? '' : value.slice(0, idx);
    }
    export default { join, dirname };
  `,
  url: `
    export function fileURLToPath(value) {
      if (typeof value === 'string') {
        return value.replace(/^file:\\/\\//, '');
      }
      return value?.pathname?.replace(/^\\//, '') ?? '';
    }
    export default { fileURLToPath };
  `,
  module: `
    export function createRequire(url) {
      const req = (id) => {
        throw new Error('createRequire is not available in the browser worker: ' + id);
      };
      req.resolve = () => '';
      return req;
    }
    export default { createRequire };
  `,
  assert: `
    export default function assert(value, message) {
      if (!value) throw new Error(message ?? 'Assertion failed');
    }
    export function ok(value, message) {
      if (!value) throw new Error(message ?? 'Assertion failed');
    }
  `,
};

await esbuild.build({
  entryPoints: [path.join(packageRoot, 'src/worker.ts')],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  outfile: path.join(packageRoot, 'dist/worker.js'),
  target: 'es2022',
  sourcemap: true,
  conditions: ['browser', 'import', 'node'],
  mainFields: ['browser', 'module', 'main'],
  plugins: [
    {
      name: 'node-builtin-stubs',
      setup(build) {
        for (const mod of Object.keys(nodeBuiltinStubs)) {
          build.onResolve({ filter: new RegExp(`^${mod}$`) }, () => ({
            path: mod,
            namespace: 'node-stub',
          }));
        }
        build.onLoad({ filter: /.*/, namespace: 'node-stub' }, (args) => ({
          contents: nodeBuiltinStubs[args.path] ?? 'export default {};',
          loader: 'js',
        }));
      },
    },
  ],
  logLevel: 'info',
});
