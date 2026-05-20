import { describe, it, expect, vi } from 'vitest';
import { Debouncer } from './SyncController.ts';

describe('Debouncer', () => {
  it('coalesces bursts into one call', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = new Debouncer(fn, 500);
    d.trigger();
    d.trigger();
    d.trigger();
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
