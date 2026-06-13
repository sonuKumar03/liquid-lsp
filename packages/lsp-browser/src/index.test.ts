import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  WORKER_INIT_MESSAGE_TYPE,
  WORKER_READY_SIGNAL,
} from './worker-protocol.js';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.join(packageRoot, '../dist');

describe('lsp-browser build output', () => {
  it('produces a bundled worker script with browser shims', () => {
    const workerPath = path.join(distRoot, 'worker.js');
    expect(fs.existsSync(workerPath)).toBe(true);
    const content = fs.readFileSync(workerPath, 'utf8');
    expect(fs.statSync(workerPath).size).toBeGreaterThan(100_000);
    expect(content).toContain('const window = globalThis;');
    expect(content).toContain(WORKER_INIT_MESSAGE_TYPE);
    expect(content).toContain(WORKER_READY_SIGNAL);
    expect(content).not.toContain('node:module');
    expect(content).toContain('invalid_dynamic_table_computation');
    expect(content).toContain('checkAtleastOneDynamicTableAssignPresent');
  });

  it('produces a browser client bundle for MessagePort transport', () => {
    const clientPath = path.join(distRoot, 'browser-client.js');
    expect(fs.existsSync(clientPath)).toBe(true);
    const content = fs.readFileSync(clientPath, 'utf8');
    expect(fs.statSync(clientPath).size).toBeGreaterThan(10_000);
    expect(content).toContain('connectBrowserLspWorker');
    expect(content).toContain(WORKER_INIT_MESSAGE_TYPE);
  });
});
