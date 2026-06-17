import { Injectable, OnDestroy, signal } from '@angular/core';
import {
  BrowserMessageReader,
  BrowserMessageWriter
} from 'vscode-languageserver-protocol/browser';

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

@Injectable({
  providedIn: 'root'
})
export class LiquidLspService implements OnDestroy {
  private worker?: Worker;
  private reader?: BrowserMessageReader;
  private writer?: BrowserMessageWriter;
  private readyPromise: Promise<void>;
  
  // Signals for application state
  public isReady = signal<boolean>(false);
  public diagnostics = signal<Record<string, LSPDiagnostic[]>>({});

  constructor() {
    this.readyPromise = this.initLsp().catch(err => {
      console.error('Failed to initialize Liquid LSP Web Worker:', err);
      throw err;
    });
  }

  public whenReady(): Promise<void> {
    return this.readyPromise;
  }

  private async initLsp(): Promise<void> {
    try {
      const channel = new MessageChannel();
      this.worker = new Worker('/assets/lsp/worker.js', { type: 'module' });

      // Start the MessagePorts explicitly to enable JSON-RPC communication
      channel.port1.start();
      channel.port2.start();

      // Wrap port2 to spy on messages
      (window as any).lspMessages = [];
      const originalPostMessage = channel.port2.postMessage.bind(channel.port2);
      channel.port2.postMessage = (message: any, transfer?: any) => {
        try {
          (window as any).lspMessages.push({ direction: 'client-to-server', data: JSON.parse(JSON.stringify(message)) });
        } catch {}
        console.log('[LSP Client -> Server]', message);
        if (transfer) {
          originalPostMessage(message, transfer);
        } else {
          originalPostMessage(message);
        }
      };

      channel.port2.addEventListener('message', (event) => {
        try {
          (window as any).lspMessages.push({ direction: 'server-to-client', data: JSON.parse(JSON.stringify(event.data)) });
        } catch {}
        console.log('[LSP Server -> Client]', event.data);
      });

      this.reader = new BrowserMessageReader(channel.port2);
      this.writer = new BrowserMessageWriter(channel.port2);

      return new Promise<void>((resolve, reject) => {
        let settled = false;

        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          this.cleanup();
          reject(new Error('LSP worker did not become ready (handshake timeout)'));
        }, 15000);

        this.worker!.onerror = (e: Event) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          this.cleanup();
          reject(new Error('LSP worker failed to load'));
        };

        this.worker!.onmessage = (event: MessageEvent) => {
          if (event.data === 'liquid-lsp-worker-ready') {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);

            this.isReady.set(true);
            console.log('Liquid LSP Web Worker is ready.');
            resolve();
          }
        };

        // Send MessageChannel port1 to worker to start LSP JSON-RPC stream
        this.worker!.postMessage({
          type: 'liquid-lsp-worker-init',
          port: channel.port1
        }, [channel.port1]);
      });
    } catch (err) {
      console.error('LSP Initialization Error:', err);
      throw err;
    }
  }

  /**
   * Get the message transports for Monaco Language Client.
   */
  public getTransports(): { reader: BrowserMessageReader; writer: BrowserMessageWriter } {
    if (!this.reader || !this.writer) {
      throw new Error('LSP transports are not initialized yet.');
    }
    return { reader: this.reader, writer: this.writer };
  }

  private cleanup(): void {
    if (this.reader) {
      this.reader.dispose();
      this.reader = undefined;
    }
    if (this.writer) {
      this.writer.dispose();
      this.writer = undefined;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = undefined;
    }
    this.isReady.set(false);
  }

  ngOnDestroy(): void {
    this.cleanup();
  }
}
