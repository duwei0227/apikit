import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from '@/utils/debounce';

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs the last call after the wait and can cancel a pending call', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced(1);
    debounced(2);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2);

    debounced(3);
    debounced.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
