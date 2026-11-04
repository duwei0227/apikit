import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '@/utils/concurrency';

describe('mapWithConcurrency', () => {
  it('CONCURRENCY-001 keeps the input order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const result = await mapWithConcurrency([5, 1, 4, 2, 3], 2, async (value) => {
      running += 1;
      peak = Math.max(peak, running);
      // 每个任务让出不同的次数，完成顺序与输入顺序不同
      for (let i = 0; i < value; i += 1) await Promise.resolve();
      running -= 1;
      return value * 10;
    });
    expect(result).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });

  it('CONCURRENCY-002 handles empty lists and limits below one', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency(['a', 'b'], 0, async (value, index) => `${value}${index}`)).toEqual(['a0', 'b1']);
  });
});
