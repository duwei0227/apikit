import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { ConsoleLog } from '@/types/models';
import {
  getConsoleLogRetentionStart,
  pruneConsoleLogs,
} from '@/utils/consoleLogs';
import { useConsoleLogsStore } from '@/stores/consoleLogs';
import { mockStorageService } from '../helpers/mockStorage';

const consoleLog = (id: string, timestamp: number): ConsoleLog => ({
  id,
  startTime: timestamp - 10,
  method: 'GET',
  url: `https://example.com/${id}`,
  requestHeaders: {},
  requestBody: null,
  endTime: timestamp,
  status: 200,
  statusText: 'OK',
  duration: '10ms',
  responseHeaders: {},
  responseBody: '',
});

describe('console log retention', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('keeps logs from the current day and previous 13 calendar days', () => {
    const now = new Date(2026, 6, 23, 12);
    const firstRetainedDay = new Date(2026, 6, 10, 0).getTime();
    const expired = new Date(2026, 6, 9, 23, 59, 59).getTime();

    expect(pruneConsoleLogs([
      consoleLog('expired', expired),
      consoleLog('retained', firstRetainedDay),
    ], now).map(log => log.id)).toEqual(['retained']);
  });

  it('uses local calendar-day boundaries and sorts newest first', () => {
    const now = new Date(2026, 6, 23, 18, 30);
    const retentionStart = new Date(getConsoleLogRetentionStart(now));
    const older = new Date(2026, 6, 22, 10).getTime();
    const newer = new Date(2026, 6, 23, 10).getTime();

    expect(retentionStart.getFullYear()).toBe(2026);
    expect(retentionStart.getMonth()).toBe(6);
    expect(retentionStart.getDate()).toBe(10);
    expect(retentionStart.getHours()).toBe(0);
    expect(pruneConsoleLogs([
      consoleLog('older', older),
      consoleLog('newer', newer),
    ], now).map(log => log.id)).toEqual(['newer', 'older']);
  });

  it('prunes persisted logs on load and persists additions and clear', async () => {
    const now = Date.now();
    mockStorageService.consoleLogs = [
      consoleLog('expired', new Date(2000, 0, 1).getTime()),
      consoleLog('retained', now),
    ];
    const store = useConsoleLogsStore();

    await store.loadLogs();
    await store.flush();
    expect(store.logs.map(log => log.id)).toEqual(['retained']);
    expect(mockStorageService.consoleLogs.map(log => log.id)).toEqual(['retained']);

    // 新增的日志合并写入，flush 后落盘
    await store.addLog(consoleLog('new', now + 1));
    await store.flush();
    expect(mockStorageService.consoleLogs.map(log => log.id)).toEqual(['new', 'retained']);

    await store.clearLogs();
    expect(store.logs).toEqual([]);
    expect(mockStorageService.consoleLogs).toEqual([]);
  });

  it('serializes rapid persistence operations in invocation order', async () => {
    const store = useConsoleLogsStore();
    const now = Date.now();

    const firstSave = store.addLog(consoleLog('first', now));
    const secondSave = store.addLog(consoleLog('second', now + 1));
    const clear = store.clearLogs();
    await Promise.all([firstSave, secondSave, clear]);

    expect(store.logs).toEqual([]);
    expect(mockStorageService.consoleLogs).toEqual([]);
  });
});
