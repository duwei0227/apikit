import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { getRowKey, reconcileRows } from '@/utils/stableRows';

describe('stable rows', () => {
  it('keeps a row key when the row moves and when accessed through a reactive proxy', () => {
    const rows = reactive([{ key: 'a' }, { key: 'b' }, { key: 'c' }]);
    const keyOfB = getRowKey(rows[1]);
    const keyOfC = getRowKey(rows[2]);

    rows.splice(0, 1);

    expect(getRowKey(rows[0])).toBe(keyOfB);
    expect(getRowKey(rows[1])).toBe(keyOfC);
    expect(keyOfB).not.toBe(keyOfC);
  });

  it('reconciles rows in place, preserving identity of existing rows', () => {
    const current = reactive([
      { key: 'a', value: '1', enabled: true, hasEquals: true },
      { key: 'b', value: '2', enabled: true },
      { key: 'old', value: '', enabled: true },
    ]);
    const keys = current.map(getRowKey);

    reconcileRows(current, [
      { key: 'a', value: '10', enabled: true },
      { key: 'b', value: '2', enabled: false },
    ]);

    expect(current).toEqual([
      { key: 'a', value: '10', enabled: true },
      { key: 'b', value: '2', enabled: false },
    ]);
    expect(current.map(getRowKey)).toEqual(keys.slice(0, 2));

    reconcileRows(current, [
      { key: 'a', value: '10', enabled: true },
      { key: 'b', value: '2', enabled: false },
      { key: 'c', value: '3', enabled: true },
    ]);
    expect(current).toHaveLength(3);
    expect(current.slice(0, 2).map(getRowKey)).toEqual(keys.slice(0, 2));
  });
});
