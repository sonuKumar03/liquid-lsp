import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

describe('lsp-browser build output', () => {
  it('produces a bundled worker script', () => {
    const workerPath = path.join(packageRoot, '../dist/worker.js');
    expect(fs.existsSync(workerPath)).toBe(true);
    expect(fs.statSync(workerPath).size).toBeGreaterThan(1000);
  });
});
