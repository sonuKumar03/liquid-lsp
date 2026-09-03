import { performance } from 'node:perf_hooks';
import {
  createLiquidEngine,
  extractComputationIR,
} from '../packages/liquid-core/src/index.js';
import {
  evaluateReferenceProgramWithOutputs,
  type ReferenceFieldSchemas,
} from '../packages/computation-reference/src/reference-language.js';
import { referenceProgramFromIR } from '../packages/computation-reference/src/reference-from-ir.js';

interface BenchmarkCase {
  name: string;
  description: string;
  source: string;
  input: Record<string, unknown>;
  schemas?: ReferenceFieldSchemas;
}

const iterations = 1000;
const cases: BenchmarkCase[] = [
  {
    name: 'primitive-arithmetic',
    description: 'Basic plus/tax arithmetic',
    source: '{% assign total = amount | plus: tax %}{{ total }}',
    input: { amount: 183.357, tax: 12 },
  },
  {
    name: 'branching-conditional',
    description: 'If/else threshold branch',
    source:
      '{% if amount > threshold %}{% assign result = amount | times: 2 %}{% else %}{% assign result = 0 %}{% endif %}{{ result }}',
    input: { amount: 12, threshold: 10 },
  },
  {
    name: 'full-worksheet-quote',
    description:
      'Dynamic table computeColumn, sumArray, tax, discount branch, toCurrency',
    source: `{% computeColumn line_items total %}
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
{{ settlement.value }}`,
    input: {
      line_items: [
        { name: 'Contract review', price: 120 },
        { name: 'Filing fee', price: 80 },
        { name: 'Consulting', price: 250 },
        { name: 'Retainer', price: 500 },
      ],
      fee: 5,
      tax_rate: 0.1,
      discount_rate: 0.05,
      settlement_currency: 'EUR',
    },
    schemas: {
      subtotal: { type: 'number' },
      tax: { type: 'number' },
      gross: { type: 'number' },
      discount: { type: 'number' },
      net: { type: 'number' },
      settlement: { type: 'currency', currency: 'EUR' },
    },
  },
  {
    name: 'compensation-plan-durations',
    description:
      'Date subtraction, duration addition, and currency OTE calculations',
    source: `{% assign sd_total_days = sd_plan_end_date | minus: sd_quota_start_date %}
{% assign sd_annual_ote = sd_annual_base_salary | plus: sd_variable_amount %}
{{ sd_annual_ote.value }}:{{ sd_total_days.days }}`,
    input: {
      sd_quota_start_date: '2022-01-01',
      sd_plan_end_date: '2022-12-31',
      sd_annual_base_salary: { value: 120000, type: 'USD' },
      sd_variable_amount: { value: 30000, type: 'USD' },
    },
    schemas: {
      sd_annual_ote: { type: 'currency', currency: 'USD' },
      sd_total_days: { type: 'duration' },
    },
  },
  {
    name: 'loop-and-string-sanitization',
    description: 'For loop, strip_html, strip, concat, and uniq deduplication',
    source: `{% parseAssign _result = "[]" %}
{% for p in commercials %}
  {% assign _prod = p.product | strip_html | strip %}
  {% assign _result = _result | concat: _prod %}
{% endfor %}
{% assign unique_products = _result | uniq %}
{{ unique_products[0] }}:{{ unique_products[1] }}`,
    input: {
      commercials: [
        { product: '<p>  License Tier A  </p>' },
        { product: '<div>License Tier B</div>' },
        { product: '<p>License Tier A</p>' },
        { product: '<span>  License Tier C  </span>' },
      ],
    },
  },
];

function opsPerSec(msPerOp: number): string {
  if (msPerOp <= 0) return '∞';
  const ops = 1000 / msPerOp;
  return `${Math.round(ops).toLocaleString()} ops/sec`;
}

async function benchmark(testCase: BenchmarkCase): Promise<void> {
  const engine = createLiquidEngine();
  const ir = extractComputationIR(testCase.source);
  const program = referenceProgramFromIR(ir);

  // Warmup
  const liquidWarmup = await engine.parseAndRender(
    testCase.source,
    testCase.input,
  );
  const referenceWarmup = evaluateReferenceProgramWithOutputs(
    program,
    testCase.input,
    testCase.schemas,
  );

  // Measure IR extraction
  const extractionStart = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    extractComputationIR(testCase.source);
  }
  const extractionMs = (performance.now() - extractionStart) / iterations;

  // Measure IR compilation
  const compileStart = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    referenceProgramFromIR(ir);
  }
  const compileMs = (performance.now() - compileStart) / iterations;

  // Measure Reference Evaluation
  const evaluationStart = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    evaluateReferenceProgramWithOutputs(
      program,
      testCase.input,
      testCase.schemas,
    );
  }
  const evaluationMs = (performance.now() - evaluationStart) / iterations;

  // Measure LiquidJS Render
  const liquidStart = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    await engine.parseAndRender(testCase.source, testCase.input);
  }
  const liquidMs = (performance.now() - liquidStart) / iterations;

  const speedup = liquidMs / evaluationMs;

  console.log(
    `\n===============================================================`,
  );
  console.log(`📌 Case: ${testCase.name} (${testCase.description})`);
  console.log(
    `---------------------------------------------------------------`,
  );
  console.log(
    `  Output Match: LiquidJS="${liquidWarmup.trim()}" | Reference="${referenceWarmup.outputs.join(':')}"`,
  );
  console.log(
    `  • LiquidJS Render:     ${liquidMs.toFixed(4)} ms/op (${opsPerSec(liquidMs)})`,
  );
  console.log(
    `  • Reference Evaluate:  ${evaluationMs.toFixed(4)} ms/op (${opsPerSec(evaluationMs)})`,
  );
  console.log(
    `  • IR Extraction:       ${extractionMs.toFixed(4)} ms/op (${opsPerSec(extractionMs)})`,
  );
  console.log(
    `  • Reference Compile:   ${compileMs.toFixed(4)} ms/op (${opsPerSec(compileMs)})`,
  );
  console.log(
    `  🚀 Evaluation Speedup: ${speedup.toFixed(1)}x faster than LiquidJS AST rendering`,
  );
}

console.log(
  `🚀 Running Computation Migration Benchmark (${iterations} iterations/case)...`,
);
for (const testCase of cases) {
  await benchmark(testCase);
}
console.log(`\n✅ Benchmark completed successfully.\n`);
