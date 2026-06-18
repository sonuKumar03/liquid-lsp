import { LIQUID_FILTERS } from '../../shared/constants.js';
import { resolveTypeForPath } from '../../hovers/hovers.js';
import type { LiquidType } from '../../shared/schema.js';
import type { CompletionProvider } from './provider.js';
import { resolveSchemaAwareDoc, resolveSchemaAwareDetail } from '../../hovers/filter-documentation.js';

export const FilterCompletionProvider: CompletionProvider = {
  matches(lineText) {
    const lastPipe = lineText.lastIndexOf('|');
    const lastTagOpen = lineText.lastIndexOf('{%');
    const lastOutputOpen = lineText.lastIndexOf('{{');
    return (
      lastPipe !== -1 &&
      (lastPipe > lastTagOpen || lastPipe > lastOutputOpen)
    );
  },

  getCompletionItems(context) {
    const { lineText, localSchema } = context;
    const lastPipe = lineText.lastIndexOf('|');

    const exprBeforePipe = lineText.substring(0, lastPipe);
    const openBound = Math.max(
      exprBeforePipe.lastIndexOf('{%'),
      exprBeforePipe.lastIndexOf('{{'),
    );
    let rawExpr = exprBeforePipe;
    if (openBound !== -1) {
      rawExpr = exprBeforePipe.substring(openBound + 2);
    }
    const cleanExpr = rawExpr.trim();
    const parts = cleanExpr.split('|');
    const baseVarExpr = parts[0] ? parts[0].trim() : '';

    let start = baseVarExpr.length;
    while (
      start > 0 &&
      /[a-zA-Z0-9_.[\]'"-]/.test(baseVarExpr[start - 1] || '')
    ) {
      start--;
    }
    const varPath = baseVarExpr.substring(start).trim();

    let resolvedType: LiquidType = 'unknown';
    if (varPath) {
      resolvedType = resolveTypeForPath(varPath, localSchema);
      if (resolvedType === 'unknown') {
        if (/^["'].*["']$/.test(varPath)) {
          resolvedType = 'string';
        } else if (/^\d+(\.\d+)?$/.test(varPath)) {
          resolvedType = 'number';
        }
      }
    }

    const stringFilters = [
      'append',
      'capitalize',
      'downcase',
      'escape',
      'prepend',
      'replace',
      'slice',
      'split',
      'strip',
      'truncate',
      'upcase',
      'default',
    ];
    const numberFilters = [
      'abs',
      'ceil',
      'divided_by',
      'floor',
      'minus',
      'modulo',
      'plus',
      'round',
      'times',
      'toDuration',
      'toCurrency',
      'default',
    ];
    const dateFilters = ['date', 'default'];
    const currencyFilters = ['toCurrency', 'default'];

    let filterNames: string[] | null = null;

    if (resolvedType === 'date') {
      filterNames = dateFilters;
    } else if (
      resolvedType === 'string' ||
      (typeof resolvedType === 'object' && resolvedType.kind === 'dropdown')
    ) {
      filterNames = stringFilters;
    } else if (resolvedType === 'number') {
      filterNames = numberFilters;
    } else if (resolvedType === 'currency') {
      filterNames = currencyFilters;
    }

    const selectedFilters = filterNames !== null
      ? LIQUID_FILTERS.filter((item) => filterNames!.includes(item.label))
      : LIQUID_FILTERS;

    return selectedFilters.map((item) => {
      const newItem = { ...item };
      const detail = resolveSchemaAwareDetail(newItem.label, localSchema);
      if (detail) {
        newItem.detail = detail;
      }
      const doc = resolveSchemaAwareDoc(newItem.label, localSchema);
      newItem.documentation = {
        kind: 'markdown',
        value: doc,
      };
      return newItem;
    });
  },
};
