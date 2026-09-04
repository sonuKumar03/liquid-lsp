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
  inject,
  isDevMode,
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
import { RouterLink } from '@angular/router';

import {
  LiquidLspService,
  type LSPDiagnostic,
} from '../../services/liquid-lsp.service';
import { MonacoSetupService } from '../../services/monaco-setup.service';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { MonacoLanguageClient } from 'monaco-languageclient';
import { createModelReference } from 'vscode/monaco';
import { extractComputationIR } from 'liquid-core';
import {
  optimizeComputationIR,
  buildControlFlowGraph,
  optimizeCFG,
  generateLiquidFromIR,
} from 'computation-ir';

/** URI of the virtual document in the Monaco / LSP workspace. */
const MODEL_URI = 'file:///playground/playground.liquid';

/** Severity mapping from Monaco MarkerSeverity → LSP DiagnosticSeverity. */
const MARKER_SEVERITY_MAP: Record<number, number> = {
  8: 1, // Error
  4: 2, // Warning
  2: 3, // Info
  1: 4, // Hint
};

type ModelRef = {
  dispose(): void;
  object: { textEditorModel: monaco.editor.ITextModel | null };
};

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
    MatChipsModule,
    RouterLink,
  ],
  templateUrl: './playground.component.html',
  styleUrls: ['./playground.component.scss'],
})
export class PlaygroundComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('editorContainer', { static: true }) editorContainer!: ElementRef;

  private readonly lspService = inject(LiquidLspService);
  private readonly monacoSetup = inject(MonacoSetupService);

  private editor?: monaco.editor.IStandaloneCodeEditor;
  private editorModel?: monaco.editor.ITextModel;
  private modelRef?: ModelRef;
  private languageClient?: MonacoLanguageClient;
  private markerListener?: monaco.IDisposable;
  /** Guard against double-initialization in Angular strict/dev mode. */
  private monacoInitialized = false;

  public readonly editorValue = signal<string>('');
  public readonly mockContext = signal<string>('');
  public readonly variableSchema = signal<string>('');
  public readonly irViewMode = signal<
    'ir' | 'optimized_ir' | 'cfg' | 'optimized_cfg'
  >('optimized_cfg');

  public readonly lspReady = computed(() => this.lspService.isReady());

  public readonly currentDiagnostics = computed<LSPDiagnostic[]>(() => {
    return this.lspService.diagnostics()[MODEL_URI] ?? [];
  });

  public readonly computationIR = computed(() => {
    try {
      return extractComputationIR(this.editorValue());
    } catch {
      return null;
    }
  });

  public readonly optimizedComputationIR = computed(() => {
    const ir = this.computationIR();
    return ir ? optimizeComputationIR(ir) : null;
  });

  public readonly controlFlowGraph = computed(() => {
    const ir = this.computationIR();
    return ir ? buildControlFlowGraph(ir) : null;
  });

  public readonly optimizedControlFlowGraph = computed(() => {
    const cfg = this.controlFlowGraph();
    return cfg ? optimizeCFG(cfg) : null;
  });

  public readonly irDisplayText = computed(() => {
    const mode = this.irViewMode();
    if (mode === 'ir') {
      return JSON.stringify(this.computationIR(), null, 2);
    }
    if (mode === 'optimized_ir') {
      return JSON.stringify(this.optimizedComputationIR(), null, 2);
    }
    if (mode === 'cfg') {
      return JSON.stringify(this.controlFlowGraph(), null, 2);
    }
    return JSON.stringify(this.optimizedControlFlowGraph(), null, 2);
  });

  constructor() {
    // Re-sync LSP schema whenever schema/context signals change and LSP is ready.
    effect(() => {
      if (this.lspReady()) {
        this.syncLspSchemaAndContext();
      }
    });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.editorValue.set(DEFAULT_TEMPLATE);
    this.mockContext.set(JSON.stringify(DEFAULT_CONTEXT, null, 2));

    fetch('/playground-variables.json')
      .then((res) => res.json())
      .then((vars: unknown) =>
        this.variableSchema.set(JSON.stringify(vars, null, 2)),
      )
      .catch(() =>
        this.variableSchema.set(JSON.stringify({ variables: [] }, null, 2)),
      );
  }

  ngAfterViewInit(): void {
    this.initMonaco().catch((err: unknown) => {
      console.error('Failed to initialize Monaco and Language Client:', err);
    });
  }

  ngOnDestroy(): void {
    if (this.languageClient?.isRunning()) {
      this.languageClient.stop();
    }
    this.markerListener?.dispose();
    this.modelRef?.dispose();
    this.editorModel?.dispose();
    this.editor?.dispose();
  }

  // ─── Public actions ─────────────────────────────────────────────────────────

  public jumpToLine(diag: LSPDiagnostic): void {
    if (!this.editor) return;
    this.editor.revealLineInCenter(diag.range.start.line + 1);
    this.editor.setPosition({
      lineNumber: diag.range.start.line + 1,
      column: diag.range.start.character + 1,
    });
    this.editor.focus();
  }

  public formatCode(): void {
    this.editor
      ?.getAction('editor.action.formatDocument')
      ?.run()
      .then(() => {
        this.editor?.focus();
      });
  }

  // ─── Private: Monaco bootstrap ──────────────────────────────────────────────

  private async initMonaco(): Promise<void> {
    if (this.monacoInitialized) return;
    this.monacoInitialized = true;

    (window as unknown as Record<string, unknown>)['monaco'] = monaco;

    await this.lspService.whenReady();

    this.monacoSetup.ensureWorkerEnvironment();
    await this.monacoSetup.initVscodeServices();
    this.monacoSetup.registerLiquidLanguage();

    await this.startLanguageClient();
    await this.createEditorModel();
    this.registerMarkerListener();
    this.syncInitialMarkers();
    this.createEditor();
    this.syncLspSchemaAndContext();
  }

  private async startLanguageClient(): Promise<void> {
    this.languageClient = new MonacoLanguageClient({
      name: 'Liquid Language Client',
      clientOptions: {
        documentSelector: ['liquid'],
        initializationOptions: { schema: {} },
      },
      connectionProvider: {
        get: () => Promise.resolve(this.lspService.getTransports()),
      },
    });
    await this.languageClient.start();
  }

  private async createEditorModel(): Promise<void> {
    const initialCode = this.editorValue();
    this.modelRef = await createModelReference(
      monaco.Uri.parse(MODEL_URI),
      initialCode,
    );
    this.editorModel = this.modelRef.object.textEditorModel!;
    monaco.editor.setModelLanguage(this.editorModel, 'liquid');

    this.editorModel.onDidChangeContent(() => {
      this.editorValue.set(this.editorModel!.getValue());
    });
  }

  private registerMarkerListener(): void {
    this.markerListener = monaco.editor.onDidChangeMarkers(([uri]) => {
      if (!uri || uri.toString() !== MODEL_URI) return;
      const markers = monaco.editor.getModelMarkers({ resource: uri });
      const diags = markers.map((m) => this.mapMarkerToDiagnostic(m));
      this.lspService.diagnostics.update((current) => ({
        ...current,
        [uri.toString()]: diags,
      }));
    });
  }

  private syncInitialMarkers(): void {
    if (!this.editorModel) return;
    const markers = monaco.editor.getModelMarkers({
      resource: this.editorModel.uri,
    });
    if (markers.length === 0) return;
    const diags = markers.map((m) => this.mapMarkerToDiagnostic(m));
    this.lspService.diagnostics.update((current) => ({
      ...current,
      [MODEL_URI]: diags,
    }));
  }

  private createEditor(): void {
    this.editor = monaco.editor.create(this.editorContainer.nativeElement, {
      model: this.editorModel,
      theme: 'vs-light',
      fontSize: 14,
      fontFamily: "'Outfit', 'Fira Code', monospace",
      minimap: { enabled: false },
      automaticLayout: true,
      lineHeight: 22,
      tabSize: 2,
      wordWrap: 'on',
    });
  }

  // ─── Private: helpers ───────────────────────────────────────────────────────

  /** Converts a Monaco IMarkerData to an LSPDiagnostic. */
  private mapMarkerToDiagnostic(m: monaco.editor.IMarkerData): LSPDiagnostic {
    return {
      severity: MARKER_SEVERITY_MAP[m.severity] ?? m.severity,
      message: m.message,
      range: {
        start: { line: m.startLineNumber - 1, character: m.startColumn - 1 },
        end: { line: m.endLineNumber - 1, character: m.endColumn - 1 },
      },
      code: typeof m.code === 'object' ? m.code?.value : m.code,
      source: m.source,
    };
  }

  private syncLspSchemaAndContext(): void {
    if (!this.languageClient?.isRunning()) return;
    try {
      const schemaRaw = this.safeParseJson<{ variables?: unknown[] }>(
        this.variableSchema(),
      );
      const varsList = schemaRaw?.variables ?? [];
      const contextObj =
        this.safeParseJson<Record<string, unknown>>(this.mockContext()) ?? {};
      this.languageClient.sendNotification('workspace/updateSchema', {
        schema: { variables: varsList },
        contextData: contextObj,
      });
    } catch (err: unknown) {
      if (isDevMode()) {
        console.warn('LSP schema update failed:', err);
      }
    }
  }

  private safeParseJson<T>(raw: string): T | null {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}

// ─── Default fixtures ────────────────────────────────────────────────────────

const DEFAULT_TEMPLATE = [
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
  'Total Payment: {{ sd_payment | toCurrency: "USD" }}',
].join('\n');

const DEFAULT_CONTEXT = {
  sd_payment: 1500.5,
  sd_term_type: 'Fixed',
  sd_term_length: 12,
  effective_execution_same: true,
  sd_company_name: 'Acme Corporate Inc.',
  sd_registered_address: {
    street: '100 Pine Street',
    city_name: 'San Francisco',
    state_name: 'CA',
  },
  sd_line_items: [
    { item: 'License A', price: 500 },
    { item: 'Setup Fee', price: 1000 },
  ],
};
