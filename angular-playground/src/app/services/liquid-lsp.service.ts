import { Injectable, OnDestroy, signal } from '@angular/core';
import {
  BrowserMessageReader,
  BrowserMessageWriter,
} from 'vscode-languageserver-protocol/browser';
import {
  WORKER_INIT_MESSAGE_TYPE,
  WORKER_READY_SIGNAL,
} from 'lsp-browser/protocol';

export interface LSPDiagnostic {
  severity: number;
  message: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  code?: string;
  source?: string;
}

/** Path to the bundled LSP Web Worker asset. */
const LSP_WORKER_ASSET = '/assets/lsp/worker.js';

/** Timeout (ms) waiting for the worker to send the ready signal. */
const WORKER_READY_TIMEOUT_MS = 15_000;

/**
 * Manages the lifecycle of the Liquid LSP Web Worker:
 *   - Spawns the worker and transfers a MessageChannel port
 *   - Exposes typed message transports for MonacoLanguageClient
 *   - Provides reactive `isReady` and `diagnostics` signals
 */
@Injectable({ providedIn: 'root' })
export class LiquidLspService implements OnDestroy {
  private worker?: Worker;
  private reader?: BrowserMessageReader;
  private writer?: BrowserMessageWriter;
  private readonly readyPromise: Promise<void>;

  /** True once the worker has sent the ready handshake. */
  public readonly isReady = signal<boolean>(false);

  /** Map of document URI → active diagnostics. */
  public readonly diagnostics = signal<Record<string, LSPDiagnostic[]>>({});

  constructor() {
    this.readyPromise = this.initWorker().catch((err: unknown) => {
      console.error('Failed to initialize Liquid LSP Web Worker:', err);
      throw err;
    });
  }

  /** Resolves when the worker is ready to accept LSP traffic. */
  public whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /** Returns the JSON-RPC transports for MonacoLanguageClient. */
  public getTransports(): {
    reader: BrowserMessageReader;
    writer: BrowserMessageWriter;
  } {
    if (!this.reader || !this.writer) {
      throw new Error('LSP transports are not initialised yet.');
    }
    return { reader: this.reader, writer: this.writer };
  }

  ngOnDestroy(): void {
    this.teardown();
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async initWorker(): Promise<void> {
    const channel = new MessageChannel();
    this.worker = new Worker(LSP_WORKER_ASSET, { type: 'module' });

    channel.port1.start();
    channel.port2.start();

    this.reader = new BrowserMessageReader(channel.port2);
    this.writer = new BrowserMessageWriter(channel.port2);

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.teardown();
        reject(
          new Error('LSP worker did not become ready (handshake timeout)'),
        );
      }, WORKER_READY_TIMEOUT_MS);

      this.worker!.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.teardown();
        reject(new Error('LSP worker failed to load'));
      };

      this.worker!.onmessage = (event: MessageEvent) => {
        if (event.data !== WORKER_READY_SIGNAL) return;
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.isReady.set(true);
        resolve();
      };

      this.worker!.postMessage(
        { type: WORKER_INIT_MESSAGE_TYPE, port: channel.port1 },
        [channel.port1],
      );
    });
  }

  private teardown(): void {
    this.reader?.dispose();
    this.reader = undefined;
    this.writer?.dispose();
    this.writer = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    this.isReady.set(false);
  }
}
