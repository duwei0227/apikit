import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { HistoryItem } from '@/types/models';
import {
  getHistoryRetentionStart,
  getLocalDateKey,
  pruneHistoryItems,
} from '@/utils/history';
import { useHistoryStore } from '@/stores/history';
import { mockStorageService } from '../helpers/mockStorage';

const historyItem = (id: string, timestamp: string): HistoryItem => ({
  id,
  method: 'GET',
  url: `https://example.com/${id}`,
  status: 200,
  duration: '10ms',
  timestamp,
  requestData: {},
  responseData: {},
});

describe('history retention', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockStorageService.history = [];
  });

  it('keeps records from the current day and previous 14 calendar days', () => {
    const now = new Date(2026, 6, 23, 12);
    const firstRetainedDay = new Date(2026, 6, 9, 0).toISOString();
    const expired = new Date(2026, 6, 8, 23, 59, 59).toISOString();

    expect(pruneHistoryItems([
      historyItem('expired', expired),
      historyItem('retained', firstRetainedDay),
    ], now).map(item => item.id)).toEqual(['retained']);
  });

  it('sorts retained records from newest to oldest and removes invalid timestamps', () => {
    const now = new Date(2026, 6, 23, 12);
    const items = [
      historyItem('older', new Date(2026, 6, 22, 10).toISOString()),
      historyItem('invalid', 'not-a-date'),
      historyItem('newer', new Date(2026, 6, 23, 10).toISOString()),
    ];

    expect(pruneHistoryItems(items, now).map(item => item.id)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('uses local calendar-day boundaries and keys', () => {
    const now = new Date(2026, 6, 23, 18, 30);
    const retentionStart = new Date(getHistoryRetentionStart(now));

    expect(retentionStart.getFullYear()).toBe(2026);
    expect(retentionStart.getMonth()).toBe(6);
    expect(retentionStart.getDate()).toBe(9);
    expect(retentionStart.getHours()).toBe(0);
    expect(getLocalDateKey(new Date(2026, 6, 23, 23, 30).toISOString()))
      .toBe('2026-07-23');
  });

  it('queues pruning persistence and flushes it before shutdown', async () => {
    const now = new Date();
    mockStorageService.history = [
      historyItem('expired', new Date(2000, 0, 1).toISOString()),
      historyItem('retained', now.toISOString()),
    ];
    const store = useHistoryStore();

    await store.loadHistory();
    await store.flush();

    expect(store.history.map(item => item.id)).toEqual(['retained']);
    expect(mockStorageService.history.map(item => item.id)).toEqual(['retained']);
  });

  it('serializes rapid history persistence operations', async () => {
    const store = useHistoryStore();
    const now = Date.now();
    const first = store.addHistoryItem(historyItem('first', new Date(now).toISOString()));
    const second = store.addHistoryItem(historyItem('second', new Date(now + 1).toISOString()));
    const clear = store.clearHistory();

    await Promise.all([first, second, clear]);
    await store.flush();

    expect(store.history).toEqual([]);
    expect(mockStorageService.history).toEqual([]);
  });
});
