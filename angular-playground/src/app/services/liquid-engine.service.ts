import { Injectable } from '@angular/core';
import { Liquid } from 'liquidjs';

/**
 * Manages the LiquidJS engine lifecycle:
 *   - ESM/CJS interop construction
 *   - Custom filter registration
 *   - Template rendering
 */
@Injectable({ providedIn: 'root' })
export class LiquidEngineService {
  private readonly engine: Liquid;

  constructor() {
    // ESM/CJS interop: bundlers may expose Liquid as { Liquid } or directly.
    const LiquidClass = (Liquid as unknown as { Liquid?: typeof Liquid }).Liquid ?? Liquid;
    this.engine = new LiquidClass();
    this.registerFilters();
  }

  /**
   * Parses and renders a Liquid template against the given context object.
   * Throws a typed Error on render failure (never swallows).
   */
  async render(code: string, context: Record<string, unknown>): Promise<string> {
    return this.engine.parseAndRender(code, context);
  }

  // ─── Private: filter registration ──────────────────────────────────────────

  private registerFilters(): void {
    this.registerSumArray();
    this.registerToCurrency();
    this.registerToDuration();
    this.registerUpdateAttribute();
    this.registerUpdateTypeAttribute();
  }

  private registerSumArray(): void {
    this.engine.registerFilter('sumArray', (arr: unknown, key: unknown) => {
      if (!Array.isArray(arr)) return 0;
      return arr.reduce((sum: number, item: unknown) => {
        const val = Number(
          item && key && typeof item === 'object'
            ? (item as Record<string, unknown>)[String(key)]
            : item,
        );
        return sum + (isNaN(val) ? 0 : val);
      }, 0);
    });
  }

  private registerToCurrency(): void {
    this.engine.registerFilter('toCurrency', (val: unknown, currency = 'USD') => {
      const num = Number(val);
      if (isNaN(num)) return val;
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num);
    });
  }

  private registerToDuration(): void {
    this.engine.registerFilter('toDuration', (val: unknown, unit = 'DAYS') => {
      const num = Number(val);
      if (isNaN(num)) return val;
      const unitStr = String(unit).toLowerCase();
      return `${num} ${num === 1 ? unitStr.replace(/s$/, '') : unitStr}`;
    });
  }

  private registerUpdateAttribute(): void {
    this.engine.registerFilter(
      'updateAttribute',
      (obj: unknown, attr: unknown, val: unknown) => {
        if (obj && typeof obj === 'object') {
          return { ...(obj as Record<string, unknown>), [String(attr)]: val };
        }
        return obj;
      },
    );
  }

  private registerUpdateTypeAttribute(): void {
    this.engine.registerFilter('updateTypeAttribute', (val: unknown) => val);
  }
}
