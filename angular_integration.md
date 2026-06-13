# Integrating Liquid Monaco Editor in Angular

This guide describes how to embed Monaco Editor inside an existing Angular project (compatible with both standalone components and module-based architectures) and connect it to your Express WebSocket LSP gateway.

We use `@monaco-editor/loader` because it works across all Angular versions without strict version dependency matches or complex configurations in `angular.json`.

---

## 1. Install Dependencies

Install the lightweight Monaco loader package in your Angular project:
```bash
npm install @monaco-editor/loader
```

Ensure your `tsconfig.json` supports browser types for Monaco (optional, but prevents compile warnings if typing Monaco variables):
```bash
npm install --save-dev @types/monaco-editor
```

---

## 2. Create the Editor Component

Here is a complete, copy-pasteable Angular component that loads Monaco, registers the custom `liquid` language, sets up the WebSocket bridge, and pipes autocompletes, hovers, document formatting, and live diagnostics.

### TypeScript File (`liquid-editor.component.ts`)

```typescript
import { Component, ElementRef, OnInit, OnDestroy, ViewChild } from '@angular/core';
import loader from '@monaco-editor/loader';

@Component({
  selector: 'app-liquid-editor',
  standalone: true,
  template: `
    <div class="editor-workspace">
      <div class="editor-header">
        <span class="title">Liquid Template Editor</span>
        <span class="status" [class.connected]="isConnected">
          {{ isConnected ? 'Connected' : 'Connecting...' }}
        </span>
      </div>
      <div #editorHost class="editor-host"></div>
    </div>
  `,
  styles: [`
    .editor-workspace {
      display: flex;
      flex-direction: column;
      height: 600px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      overflow: hidden;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .editor-header {
      height: 48px;
      background: #f8fafc;
      border-bottom: 1px solid #cbd5e1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
    }
    .title {
      font-weight: 600;
      color: #0f172a;
    }
    .status {
      font-size: 0.75rem;
      color: #ef4444;
    }
    .status.connected {
      color: #10b981;
    }
    .editor-host {
      flex: 1;
      width: 100%;
      height: 100%;
    }
  `]
})
export class LiquidEditorComponent implements OnInit, OnDestroy {
  @ViewChild('editorHost', { static: true }) editorHost!: ElementRef;

  private editorInstance: any;
  private socket!: WebSocket;
  private isConnected = false;
  private requestId = 0;
  private pendingRequests = new Map<number, (value: any) => void>();

  // Predefined variables schema (tells LSP what types to check)
  private schema = {
    status: {
      type: 'dropdown',
      options: ['Active', 'Inactive']
    },
    price: 'currency',
    user: {
      type: 'composite',
      fields: {
        first_name: 'string',
        items: {
          type: 'composite',
          fields: {
            title: 'string'
          }
        }
      }
    }
  };

  private initialCode = [
    '{% assignVar name = user.first_name %}',
    '<h2>Welcome, {{ name }}!</h2>',
    '',
    '{% if status = "Active" %}',
    '  <p>Your subscription is active.</p>',
    '{% else %}',
    '  <p>Your subscription status: {{ status | default: "Pending" }}</p>',
    '{% endif %}'
  ].join('\n');

  ngOnInit() {
    this.initWebSocket();
  }

  ngOnDestroy() {
    if (this.socket) {
      this.socket.close();
    }
    if (this.editorInstance) {
      this.editorInstance.dispose();
    }
  }

  private initWebSocket() {
    // Replace with your Express server's WebSocket address
    this.socket = new WebSocket('ws://localhost:3000/lsp');

    this.socket.onopen = () => {
      this.isConnected = true;
      this.initMonaco();
    };

    this.socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        this.handleLSPMessage(payload);
      } catch (err) {
        console.error('Failed to parse WebSocket JSON payload', err);
      }
    };

    this.socket.onclose = () => {
      this.isConnected = false;
      console.log('LSP Server connection closed.');
    };
  }

  private initMonaco() {
    loader.init().then((monaco) => {
      // 1. Register Custom Liquid Language
      monaco.languages.register({ id: 'liquid' });

      // 2. Define Custom Syntax Themes
      monaco.languages.setMonarchTokensProvider('liquid', {
        tokenizer: {
          root: [
            [/{[{%].*?[}%]}/, 'keyword'],
            [/"[^"]*"/, 'string'],
            [/'[^']*'/, 'string'],
            [/\b\d+\b/, 'number']
          ]
        }
      });

      monaco.editor.defineTheme('liquid-light', {
        base: 'vs',
        inherit: true,
        rules: [
          { token: 'keyword', foreground: '7c3aed', fontStyle: 'bold' },
          { token: 'string', foreground: '059669' },
          { token: 'number', foreground: 'd97706' }
        ],
        colors: {
          'editor.background': '#ffffff',
          'editor.lineHighlightBackground': '#f1f5f9',
          'editorLineNumber.foreground': '#94a3b8',
          'editorLineNumber.activeForeground': '#7c3aed'
        }
      });

      // 3. Create Monaco Instance
      const model = monaco.editor.createModel(
        this.initialCode,
        'liquid',
        monaco.Uri.parse('inmemory://model/1')
      );

      this.editorInstance = monaco.editor.create(this.editorHost.nativeElement, {
        model: model,
        theme: 'liquid-light',
        automaticLayout: true,
        fontSize: 14,
        fontFamily: "'Fira Code', monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2
      });

      // Send initial LSP handshake
      this.sendHandshake();

      // Listen for text changes to compile diagnostics
      model.onDidChangeContent(() => {
        this.sendDocumentContent(model.getValue());
      });

      // 4. Register Autocomplete Providers
      monaco.languages.registerCompletionItemProvider('liquid', {
        provideCompletionItems: async (docModel: any, position: any) => {
          const res = await this.sendRPCRequest('textDocument/completion', {
            textDocument: { uri: docModel.uri.toString() },
            position: { line: position.lineNumber - 1, character: position.column - 1 }
          });
          if (!res) return { suggestions: [] };
          
          const suggestions = (res.items || res).map((item: any) => ({
            label: item.label,
            kind: item.kind - 1, // Shift Monaco completion kind offset
            insertText: item.insertText || item.label,
            documentation: item.documentation,
            detail: item.detail
          }));
          return { suggestions };
        }
      });

      // 5. Register Hover Info Providers
      monaco.languages.registerHoverProvider('liquid', {
        provideHover: async (docModel: any, position: any) => {
          const res = await this.sendRPCRequest('textDocument/hover', {
            textDocument: { uri: docModel.uri.toString() },
            position: { line: position.lineNumber - 1, character: position.column - 1 }
          });
          if (!res || !res.contents) return null;
          return {
            contents: Array.isArray(res.contents) 
              ? res.contents.map((c: any) => ({ value: c.value || c }))
              : [{ value: res.contents.value || res.contents }]
          };
        }
      });

      // 6. Register Strict Formatter Providers
      monaco.languages.registerDocumentFormattingEditProvider('liquid', {
        provideDocumentFormattingEdits: async (docModel: any) => {
          const res = await this.sendRPCRequest('textDocument/formatting', {
            textDocument: { uri: docModel.uri.toString() },
            options: { tabSize: 2, insertSpaces: true }
          });
          if (!res || res.length === 0) return [];
          return res.map((edit: any) => ({
            range: new monaco.Range(
              edit.range.start.line + 1,
              edit.range.start.character + 1,
              edit.range.end.line + 1,
              edit.range.end.character + 1
            ),
            text: edit.newText
          }));
        }
      });

      // Trigger first diagnostics validation pass
      this.sendDocumentContent(model.getValue());
    });
  }

  // Send JSON-RPC Initializing Handshake containing settings and variable schema
  private sendHandshake() {
    this.sendRPCNotification('initialize', {
      initializationOptions: { schema: this.schema }
    });
  }

  // Notify LSP server of changes to text content
  private sendDocumentContent(content: string) {
    this.sendRPCNotification('textDocument/didChange', {
      textDocument: { uri: 'inmemory://model/1', version: 1 },
      contentChanges: [{ text: content }]
    });
  }

  // Handle Response / Diagnostics notifications from LSP Server
  private handleLSPMessage(payload: any) {
    // If it's a response to a request we sent, trigger the promise callback
    if (payload.id !== undefined && this.pendingRequests.has(payload.id)) {
      const resolve = this.pendingRequests.get(payload.id);
      this.pendingRequests.delete(payload.id);
      if (resolve) resolve(payload.result);
    }
    
    // If it's a live Diagnostics linter push
    if (payload.method === 'textDocument/publishDiagnostics') {
      const diagnostics = payload.params.diagnostics || [];
      const markers = diagnostics.map((diag: any) => ({
        severity: diag.severity === 1 ? 8 : 4, // Map LSP Severity -> Monaco Severity (Error/Warning)
        message: diag.message,
        startLineNumber: diag.range.start.line + 1,
        startColumn: diag.range.start.character + 1,
        endLineNumber: diag.range.end.line + 1,
        endColumn: diag.range.end.character + 1
      }));

      // Bind diagnostic squiggles to our active Monaco Model
      const monacoInstance = (window as any).monaco;
      if (monacoInstance && this.editorInstance) {
        monacoInstance.editor.setModelMarkers(
          this.editorInstance.getModel(),
          'liquid',
          markers
        );
      }
    }
  }

  // JSON-RPC Request Helper (expects response)
  private sendRPCRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve) => {
      const id = this.requestId++;
      this.pendingRequests.set(id, resolve);
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  // JSON-RPC Notification Helper (one-way message, no response expected)
  private sendRPCNotification(method: string, params: any) {
    this.socket.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }
}
```

---

## 3. Summary of How it Works

1. **Loader Init**: Loads Monaco resources dynamically in Angular using lazy-loading (avoids cluttering Angular webpack configs).
2. **Language Customization**: Register `'liquid'` as a custom language so the editor uses it for provider registration.
3. **JSON-RPC Bridge**: Sets up standard event listeners that wrap completions, hovers, and formatting API promises inside `JSON-RPC 2.0` request headers, sending them over the WebSocket connection to your gateway.
4. **Interactive Diagnostics**: Listens to the custom `textDocument/publishDiagnostics` notification from the server and updates model markers (`setModelMarkers()`) to show red/yellow underline squiggles for validation errors in real-time.
