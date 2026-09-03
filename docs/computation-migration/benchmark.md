# Computation Migration Benchmark

This benchmark tracks the execution performance and throughput of the migration pipeline against native LiquidJS AST rendering without external benchmarking dependencies.

## What it measures

Across real-world SpotDraft computation patterns, it measures:

- **LiquidJS render time & throughput** (native LiquidJS parse & render)
- **IR extraction time** (`liquid-core` tokenizer, AST, and IR extractor)
- **IR-to-reference compilation time** (`computation-reference` AST builder)
- **Reference evaluation time & throughput** (evaluation of compiled IR AST)
- **Output parity** (exact string & numerical equivalence)
- **Evaluation Speedup Multiplier**

The benchmark runs **1,000 iterations per case**.

## Run

From the repository root:

```sh
rtk node_modules/.bin/tsx scripts/computation-benchmark.ts
```

## Baseline Results

Captured on **2026-09-04** (1,000 iterations per test case on Apple Silicon Node v22):

| Benchmark Case                     | Workload Details                                                  |               LiquidJS Render |                 Reference Evaluate | IR Extraction | Reference Compile |   Speedup | Output Parity |
| ---------------------------------- | ----------------------------------------------------------------- | ----------------------------: | ---------------------------------: | ------------: | ----------------: | --------: | :-----------: |
| **`primitive-arithmetic`**         | Basic `plus` / tax arithmetic                                     | 0.0233 ms<br>_(43,010 ops/s)_ | **0.0012 ms**<br>_(802,676 ops/s)_ |     0.0932 ms |         0.0048 ms | **18.7x** |   ✅ Exact    |
| **`branching-conditional`**        | `if/else` threshold calculation                                   | 0.0264 ms<br>_(37,944 ops/s)_ | **0.0010 ms**<br>_(981,555 ops/s)_ |     0.1650 ms |         0.0055 ms | **25.9x** |   ✅ Exact    |
| **`full-worksheet-quote`**         | `computeColumn`, `sumArray`, tax, discount, `toCurrency`          | 0.0889 ms<br>_(11,243 ops/s)_ | **0.0050 ms**<br>_(199,664 ops/s)_ |     0.3460 ms |         0.0166 ms | **17.8x** |   ✅ Exact    |
| **`compensation-plan-durations`**  | Date diff (`minus`), duration math, OTE currency fold             | 0.0279 ms<br>_(35,878 ops/s)_ | **0.0023 ms**<br>_(440,173 ops/s)_ |     0.1153 ms |         0.0053 ms | **12.3x** |   ✅ Exact    |
| **`loop-and-string-sanitization`** | `for` loop, `strip_html`, `strip`, `concat`, `uniq` deduplication | 0.0578 ms<br>_(17,300 ops/s)_ | **0.0051 ms**<br>_(196,526 ops/s)_ |     0.1743 ms |         0.0087 ms | **11.4x** |   ✅ Exact    |

---

### Key Takeaways

1. **Evaluation Throughput**: Reference evaluation averages between **200,000 to 980,000 ops/sec** across complex worksheets, executing **11x to 26x faster** than LiquidJS template rendering.
2. **One-time Extraction Overhead**: IR extraction occurs once per template version (~0.09–0.34 ms), making compiled IR execution ideal for high-throughput batch evaluation in contract export pipelines.
3. **Behavioral Integrity**: 100% output agreement across all tested arithmetic, date differences, duration folds, loop accumulators, and HTML sanitization workflows.
