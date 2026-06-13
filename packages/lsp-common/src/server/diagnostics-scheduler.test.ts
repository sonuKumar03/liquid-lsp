import { describe, expect, it, vi } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticsScheduler } from './diagnostics-scheduler.js';

describe('DiagnosticsScheduler', () => {
  it('debounces validation until the quiet period elapses', () => {
    vi.useFakeTimers();
    const validateDocument = vi.fn();
    const scheduler = new DiagnosticsScheduler(validateDocument, 150);
    const doc = TextDocument.create('file:///t.liquid', 'liquid', 1, '{{ x }}');

    scheduler.schedule(doc);
    scheduler.schedule(doc);

    expect(validateDocument).not.toHaveBeenCalled();

    vi.advanceTimersByTime(149);
    expect(validateDocument).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(validateDocument).toHaveBeenCalledTimes(1);
    expect(validateDocument).toHaveBeenCalledWith(doc);

    vi.useRealTimers();
  });
});
