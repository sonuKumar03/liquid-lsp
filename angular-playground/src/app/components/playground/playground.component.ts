import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  signal,
  computed,
  effect,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatListModule } from '@angular/material/list';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';

import { LiquidLspService, LSPDiagnostic } from '../../services/liquid-lsp.service';
import { Liquid } from 'liquidjs';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { MonacoLanguageClient } from 'monaco-languageclient';
import { initServices } from 'monaco-languageclient/vscode/services';
import { createModelReference } from 'vscode/monaco';

@Component({
  selector: 'app-playground',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatToolbarModule,
    MatSidenavModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatListModule,
    MatFormFieldModule,
    MatInputModule,
    MatCardModule,
    MatTooltipModule,
    MatDividerModule,
    MatProgressBarModule,
    MatChipsModule
  ],
  templateUrl: './playground.component.html',
  styleUrls: ['./playground.component.scss']
})
export class PlaygroundComponent implements OnInit, AfterViewInit, OnDestroy {
  public lspService = inject(LiquidLspService);

  @ViewChild('editorContainer', { static: true }) editorContainer!: ElementRef;

  private editor?: monaco.editor.IStandaloneCodeEditor;
  private editorModel?: monaco.editor.ITextModel;
  private modelRef?: { dispose(): void; object: { textEditorModel: monaco.editor.ITextModel | null } };
  private liquidEngine!: Liquid;
  private languageClient?: MonacoLanguageClient;

  // Guard: prevent double initialization (Angular strict mode / dev mode)
  private _monacoInitialized = false;
  // Disposable for the global marker change listener
  private _markerListener?: monaco.IDisposable;

  // Signals
  public editorValue = signal<string>('');
  public mockContext = signal<string>('');
  public variableSchema = signal<string>('');
  public theme = signal<'vs-dark' | 'vs-light'>('vs-light');

  // Computed values
  public lspReady = computed(() => this.lspService.isReady());
  
  public currentDiagnostics = computed<LSPDiagnostic[]>(() => {
    const list = this.lspService.diagnostics();
    const uri = 'file:///playground/playground.liquid';
    return list[uri] || [];
  });

  public renderedOutput = signal<string>('');
  public renderError = signal<string>('');

  constructor() {
    // Instantiate Liquid engine with ESM/CJS interop support
    const LiquidClass = (Liquid as any).Liquid || Liquid;
    this.liquidEngine = new LiquidClass();

    // Register custom filters
    this.registerCustomFilters();

    // Effect to update schema and context in LSP whenever variables or context change
    effect(() => {
      if (this.lspReady()) {
        this.updateLspSchemaAndContext();
      }
    });

    // Effect to run live rendering of template whenever code or context changes
    effect(() => {
      const code = this.editorValue();
      const contextStr = this.mockContext();
      this.runLiquidRender(code, contextStr);
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    // Setup initial template text
    const defaultTemplate = [
      '{% comment %}',
      '  Liquid LSP Angular Playground',
      '  Intentional errors — verify squiggles, hovers, completions, and quick-fixes:',
      '  E1: Assigning in if condition: {% if sd_term_type = "Fixed" %}',
      '  E2: Invalid dropdown option:   {% assignVar sd_term_type = "Yearly" %}',
      '  E3: Math filter on string:     {{ sd_company_name | plus: 1 }}',
      '  E4: Inline math:               {% assign x = 1 + 2 %}',
      '  E5: Unknown sub-property:      {{ sd_registered_address.zipcode }}',
      '{% endcomment %}',
      '',
      '{% if sd_term_type == "Fixed" %}',
      '  Term Length is: {{ sd_term_length | toDuration: "MONTHS" }}',
      '{% else %}',
      '  Company Name is: {{ sd_company_name }}',
      '{% endif %}',
      '',
      'Line Items Count: {{ sd_line_items | sumArray }}',
      'Total Payment: {{ sd_payment | toCurrency: "USD" }}'
    ].join('\n');

    this.editorValue.set(defaultTemplate);

    // Setup initial mock context
    const defaultContext = {
      sd_payment: 1500.50,
      sd_term_type: 'Fixed',
      sd_term_length: 12,
      effective_execution_same: true,
      sd_company_name: 'Acme Corporate Inc.',
      sd_registered_address: {
        street: '100 Pine Street',
        city_name: 'San Francisco',
        state_name: 'CA'
      },
      sd_line_items: [
        { item: 'License A', price: 500 },
        { item: 'Setup Fee', price: 1000 }
      ]
    };
    this.mockContext.set(JSON.stringify(defaultContext, null, 2));

    // Load default variables asynchronously
    fetch('/playground-variables.json')
      .then(res => res.json())
      .then(vars => {
        this.variableSchema.set(JSON.stringify(vars, null, 2));
      })
      .catch(() => {
        this.variableSchema.set(JSON.stringify({ variables: [] }, null, 2));
      });
  }

  ngAfterViewInit(): void {
    this.initMonaco().catch(err => {
      console.error('Failed to initialize Monaco and Language Client:', err);
    });
  }

  private async initMonaco(): Promise<void> {
    // BUG FIX #4: Guard against double-initialization (Angular strict/dev mode)
    if (this._monacoInitialized) return;
    this._monacoInitialized = true;
    (window as any).monaco = monaco;

    // Wait for the LSP Web Worker service to be fully ready
    await this.lspService.whenReady();

    // BUG FIX #5: MonacoEnvironment should be set before initServices.
    // We do it here (idempotent) rather than in main.ts to avoid
    // a hard dependency on the asset path at app bootstrap.
    if (!(window as any).MonacoEnvironment) {
      (window as any).MonacoEnvironment = {
        getWorkerUrl: (_moduleId: string, _label: string): string => {
          return '/assets/monaco/vs/base/worker/workerMain.js';
        }
      };
    }

    // 1. Initialize Monaco Services (idempotent — vscodeApiInitialised guard is built in)
    // BUG FIX #1: Pass a proper InitServicesInstruction with workspaceConfig.
    // BUG FIX #6: Do not swallow errors; only skip if already initialized.
    const env = (window as any).MonacoEnvironment as Record<string, unknown> | undefined;
    if (!env?.['vscodeApiInitialised']) {
      await initServices({
        serviceConfig: {
          userServices: {},
          workspaceConfig: {
            workspaceProvider: {
              workspace: {
                folderUri: monaco.Uri.parse('file:///playground')
              },
              trusted: true,
              open: async () => true
            }
          },
          debugLogging: true
        },
        caller: 'liquid-playground'
      });
    }

    // 2. Register language
    monaco.languages.register({
      id: 'liquid',
      extensions: ['.liquid']
    });

    monaco.languages.setLanguageConfiguration('liquid', {
      comments: {
        blockComment: ['{% comment %}', '{% endcomment %}']
      },
      brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')']
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '{%', close: ' %}' },
        { open: '{{', close: ' }}' }
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '{%', close: '%}' },
        { open: '{{', close: '}}' }
      ]
    });

    // Register Monarch Tokenizer for basic syntax highlighting (tags, operators, comments, strings)
    monaco.languages.setMonarchTokensProvider('liquid', {
      defaultToken: '',
      tokenPostfix: '.liquid',
      keywords: [
        'if', 'else', 'elsif', 'endif', 'unless', 'endunless',
        'case', 'when', 'endcase', 'for', 'endfor', 'in', 'reversed',
        'tablerow', 'endtablerow', 'assign', 'assignVar', 'parseAssign',
        'capture', 'endcapture', 'increment', 'decrement', 'comment', 'endcomment',
        'raw', 'endraw', 'computeColumn'
      ],
      operators: [
        '==', '!=', '<', '>', '<=', '>=', 'contains'
      ],
      tokenizer: {
        root: [
          // Comments
          [/{%\s*comment\s*%}/, { token: 'comment', next: '@comment' }],
          [/{#/, { token: 'comment', next: '@commentHash' }],
          
          // Tags and Outputs
          [/{%/, { token: 'delimiter.tag', next: '@tag' }],
          [/{{/, { token: 'delimiter.output', next: '@output' }],
          
          // HTML Markup fallback
          [/./, '']
        ],
        comment: [
          [/{%\s*endcomment\s*%}/, { token: 'comment', next: '@pop' }],
          [/./, 'comment']
        ],
        commentHash: [
          [/#}/, { token: 'comment', next: '@pop' }],
          [/./, 'comment']
        ],
        tag: [
          [/%}/, { token: 'delimiter.tag', next: '@pop' }],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*'/, 'string'],
          [/[\w\-]+/, {
            cases: {
              '@keywords': 'keyword',
              '@operators': 'operator',
              '@default': 'identifier'
            }
          }],
          [/[{}()\[\]]/, 'delimiter'],
          [/[:|]/, 'operator'],
          [/[ \t\r\n]+/, '']
        ],
        output: [
          [/}}/, { token: 'delimiter.output', next: '@pop' }],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*'/, 'string'],
          [/[\w\-]+/, {
            cases: {
              '@operators': 'operator',
              '@default': 'identifier'
            }
          }],
          [/[:|]/, 'operator'],
          [/[ \t\r\n]+/, '']
        ]
      }
    });

    // Map Monaco MarkerSeverity back to LSP DiagnosticSeverity values
    const severityMap: Record<number, number> = {
      8: 1, // Error
      4: 2, // Warning
      2: 3, // Info
      1: 4  // Hint
    };

    const modelUriStr = 'file:///playground/playground.liquid';

    // 3. Setup Monaco Language Client using transports from service
    const languageClient = new MonacoLanguageClient({
      name: 'Liquid Language Client',
      clientOptions: {
        documentSelector: ['liquid'],
        initializationOptions: {
          schema: {}
        }
      },
      connectionProvider: {
        get: (_encoding: string) => Promise.resolve(this.lspService.getTransports())
      }
    });

    await languageClient.start();
    this.languageClient = languageClient;

    // 4. Create model reference AFTER languageClient starts to ensure that VS Code workspace onDidOpenTextDocument is registered
    const initialCode = this.editorValue();
    this.modelRef = await createModelReference(
      monaco.Uri.parse(modelUriStr),
      initialCode
    );
    this.editorModel = this.modelRef!.object.textEditorModel!;
    monaco.editor.setModelLanguage(this.editorModel, 'liquid');

    // Register marker change listener
    this._markerListener = monaco.editor.onDidChangeMarkers(([uri]) => {
      console.log('[PlaygroundComponent] Monaco markers changed for uri:', uri?.toString());
      if (uri && uri.toString() === modelUriStr) {
        const markers = monaco.editor.getModelMarkers({ resource: uri });
        console.log('[PlaygroundComponent] Found model markers:', markers);
        const diags = markers.map(m => ({
          severity: severityMap[m.severity] || m.severity,
          message: m.message,
          range: {
            start: { line: m.startLineNumber - 1, character: m.startColumn - 1 },
            end: { line: m.endLineNumber - 1, character: m.endColumn - 1 }
          },
          code: typeof m.code === 'object' ? m.code.value : m.code,
          source: m.source
        }));
        this.lspService.diagnostics.update(current => ({
          ...current,
          [uri.toString()]: diags
        }));
      }
    });

    // Sync any markers that might have been populated instantly on creation
    const initialMarkers = monaco.editor.getModelMarkers({ resource: this.editorModel.uri });
    if (initialMarkers.length > 0) {
      const diags = initialMarkers.map(m => ({
        severity: severityMap[m.severity] || m.severity,
        message: m.message,
        range: {
          start: { line: m.startLineNumber - 1, character: m.startColumn - 1 },
          end: { line: m.endLineNumber - 1, character: m.endColumn - 1 }
        },
        code: typeof m.code === 'object' ? m.code.value : m.code,
        source: m.source
      }));
      this.lspService.diagnostics.update(current => ({
        ...current,
        [modelUriStr]: diags
      }));
    }

    // 5. Instantiate Editor
    this.editor = monaco.editor.create(this.editorContainer.nativeElement, {
      model: this.editorModel,
      theme: this.theme(),
      fontSize: 14,
      fontFamily: "'Outfit', 'Fira Code', monospace",
      minimap: { enabled: false },
      automaticLayout: true,
      lineHeight: 22,
      tabSize: 2,
      wordWrap: 'on'
    });

    // 6. Listen to changes
    this.editorModel.onDidChangeContent(() => {
      this.editorValue.set(this.editorModel!.getValue());
    });

    // Send schema/context notification AFTER the model is created and client started.
    this.updateLspSchemaAndContext();
  }

  private updateLspSchemaAndContext(): void {
    if (!this.languageClient || !this.languageClient.isRunning()) {
      return;
    }
    try {
      let varsList: any[] = [];
      try {
        const parsed = JSON.parse(this.variableSchema());
        varsList = parsed.variables || [];
      } catch {}

      let contextObj: any = {};
      try {
        contextObj = JSON.parse(this.mockContext());
      } catch {}

      this.languageClient.sendNotification('workspace/updateSchema', {
        schema: { variables: varsList },
        contextData: contextObj
      });
    } catch (err) {
      console.warn('LSP schema update failed:', err);
    }
  }

  private registerCustomFilters(): void {
    // 1. sumArray
    this.liquidEngine.registerFilter('sumArray', (arr: any, key: any) => {
      if (!Array.isArray(arr)) return 0;
      return arr.reduce((sum, item) => {
        const val = Number(item && key ? item[key] : item);
        return sum + (isNaN(val) ? 0 : val);
      }, 0);
    });

    // 2. toCurrency
    this.liquidEngine.registerFilter('toCurrency', (val: any, currency = 'USD') => {
      const num = Number(val);
      if (isNaN(num)) return val;
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency
      }).format(num);
    });

    // 3. toDuration
    this.liquidEngine.registerFilter('toDuration', (val: any, unit = 'DAYS') => {
      const num = Number(val);
      if (isNaN(num)) return val;
      const unitStr = unit.toLowerCase();
      return `${num} ${num === 1 ? unitStr.replace(/s$/, '') : unitStr}`;
    });

    // 4. updateAttribute
    this.liquidEngine.registerFilter('updateAttribute', (obj: any, attr: any, val: any) => {
      if (obj && typeof obj === 'object') {
        const copy = { ...obj };
        copy[attr] = val;
        return copy;
      }
      return obj;
    });

    // 5. updateTypeAttribute
    this.liquidEngine.registerFilter('updateTypeAttribute', (val: any) => val);
  }

  private async runLiquidRender(code: string, contextStr: string): Promise<void> {
    if (!code || !contextStr) {
      this.renderedOutput.set('');
      this.renderError.set('');
      return;
    }
    try {
      const context = JSON.parse(contextStr);
      this.renderError.set('');
      const html = await this.liquidEngine.parseAndRender(code, context);
      console.log('Liquid template rendered successfully:', html);
      this.renderedOutput.set(html);
    } catch (err: any) {
      console.error('Liquid template rendering failed:', err);
      this.renderError.set(err.message || 'Render error');
    }
  }

  public jumpToLine(diag: LSPDiagnostic): void {
    if (this.editor) {
      this.editor.revealLineInCenter(diag.range.start.line + 1);
      this.editor.setPosition({
        lineNumber: diag.range.start.line + 1,
        column: diag.range.start.character + 1
      });
      this.editor.focus();
    }
  }



  ngOnDestroy(): void {
    // BUG FIX #3: Properly clean up all resources in reverse creation order.

    // 1. Stop language client — sends textDocument/didClose + shutdown/exit to server
    if (this.languageClient?.isRunning()) {
      this.languageClient.stop();
    }

    // 2. Dispose global marker listener
    this._markerListener?.dispose();

    // 3. Dispose model reference and model
    this.modelRef?.dispose();
    this.editorModel?.dispose();

    // 4. Dispose editor last
    this.editor?.dispose();
  }
}
