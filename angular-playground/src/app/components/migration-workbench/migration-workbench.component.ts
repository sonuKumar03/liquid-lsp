import { CommonModule } from '@angular/common';
import { Component, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { createLiquidEngine, extractComputationIR } from 'liquid-core';
import {
  optimizeComputationIR,
  buildControlFlowGraph,
  optimizeCFG,
} from 'computation-ir';
import {
  evaluateReferenceProgramWithOutputs,
  referenceProgramFromIR,
  referenceSourceFromIR,
} from 'computation-reference';

interface BenchmarkMetrics {
  extraction: number;
  referenceCompile: number;
  referenceEvaluate: number;
  liquidRender: number;
}

const DEFAULT_SOURCE = `{% computeColumn line_items total %}
  {% assign $$answer = self.price | plus: fee %}
{% endcomputeColumn %}
{% assign subtotal = line_items | sumArray: "total" %}
{% assign tax = subtotal | times: tax_rate %}
{% assign gross = subtotal | plus: tax %}
{% if discount_rate %}
  {% assign discount = gross | times: discount_rate %}
{% else %}
  {% assign discount = 0 %}
{% endif %}
{% assign net = gross | minus: discount %}
{% assign settlement = net | toCurrency: settlement_currency %}
{{ settlement.value }}`;
const DEFAULT_CONTEXT = JSON.stringify(
  {
    line_items: [
      { name: 'Contract review', price: 120 },
      { name: 'Filing fee', price: 80 },
    ],
    fee: 5,
    tax_rate: 0.1,
    discount_rate: 0.05,
    settlement_currency: 'EUR',
  },
  null,
  2,
);
const DEFAULT_FIELD_SCHEMAS = JSON.stringify(
  {
    subtotal: { type: 'number' },
    tax: { type: 'number' },
    gross: { type: 'number' },
    discount: { type: 'number' },
    net: { type: 'number' },
    settlement: { type: 'currency', currency: 'EUR' },
  },
  null,
  2,
);

@Component({
  selector: 'app-migration-workbench',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './migration-workbench.component.html',
  styleUrl: './migration-workbench.component.scss',
})
export class MigrationWorkbenchComponent {
  readonly source = signal(DEFAULT_SOURCE);
  readonly context = signal(DEFAULT_CONTEXT);
  readonly fieldSchemas = signal(DEFAULT_FIELD_SCHEMAS);
  readonly irText = signal('{}');
  readonly optimizedIrText = signal('{}');
  readonly cfgText = signal('{}');
  readonly optimizedCfgText = signal('{}');
  readonly modelView = signal<'ir' | 'optimized_ir' | 'cfg' | 'optimized_cfg'>(
    'ir',
  );
  readonly referenceSource = signal('');
  readonly liquidOutput = signal('');
  readonly referenceOutput = signal('');
  readonly error = signal('');
  readonly metrics = signal<BenchmarkMetrics | null>(null);
  readonly isRunning = signal(false);

  private readonly liquid = createLiquidEngine();
  private runNumber = 0;

  constructor() {
    effect(
      () => {
        const source = this.source();
        const context = this.context();
        const fieldSchemas = this.fieldSchemas();
        void this.analyze(source, context, fieldSchemas);
      },
      { allowSignalWrites: true },
    );
  }

  private async analyze(
    source: string,
    contextText: string,
    fieldSchemasText: string,
  ): Promise<void> {
    const run = ++this.runNumber;
    this.isRunning.set(true);
    this.error.set('');
    const started = performance.now();

    try {
      const context = JSON.parse(contextText) as Record<string, unknown>;
      const fieldSchemas = JSON.parse(fieldSchemasText) as Record<
        string,
        {
          type:
            | 'currency'
            | 'duration'
            | 'number'
            | 'date'
            | 'dropdown'
            | 'string'
            | 'repeating'
            | 'table';
          currency?: string;
        }
      >;

      const extractionStarted = performance.now();
      const ir = extractComputationIR(source);
      const extraction = performance.now() - extractionStarted;
      this.irText.set(JSON.stringify(ir, null, 2));

      const optimizedIr = optimizeComputationIR(ir);
      this.optimizedIrText.set(JSON.stringify(optimizedIr, null, 2));

      const rawCfg = buildControlFlowGraph(ir);
      this.cfgText.set(JSON.stringify(rawCfg, null, 2));

      const optimizedCfg = optimizeCFG(rawCfg);
      this.optimizedCfgText.set(JSON.stringify(optimizedCfg, null, 2));

      const compileStarted = performance.now();
      const program = referenceProgramFromIR(ir);
      const referenceCompile = performance.now() - compileStarted;
      this.referenceSource.set(referenceSourceFromIR(ir));

      const evaluationStarted = performance.now();
      const reference = evaluateReferenceProgramWithOutputs(
        program,
        context,
        fieldSchemas,
      );
      const referenceEvaluate = performance.now() - evaluationStarted;
      const referenceValue = reference.outputs[0];
      this.referenceOutput.set(JSON.stringify(referenceValue));

      const liquidStarted = performance.now();
      const liquidValue = await this.liquid.parseAndRender(source, context);
      const liquidRender = performance.now() - liquidStarted;

      if (run !== this.runNumber) return;
      this.liquidOutput.set(liquidValue.trim());
      this.metrics.set({
        extraction,
        referenceCompile,
        referenceEvaluate,
        liquidRender,
      });
    } catch (cause: unknown) {
      if (run !== this.runNumber) return;
      this.error.set(cause instanceof Error ? cause.message : String(cause));
      this.metrics.set(null);
      this.liquidOutput.set('');
      this.referenceOutput.set('');
    } finally {
      if (run === this.runNumber) {
        this.isRunning.set(false);
        void started;
      }
    }
  }

  formatMetric(value: number): string {
    return `${value.toFixed(3)} ms`;
  }
}
