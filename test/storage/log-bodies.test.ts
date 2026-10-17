// Console 和 History 的 body 每条单独保存：只写这一条，展开或打开时读取，清理时删除

import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { ConsoleLog, HistoryItem } from '@/types/models';
import { MAX_CONSOLE_LOGS } from '@/utils/consoleLogs';
import { consoleLogToHistoryItem } from '@/utils/history';
import { useConsoleLogsStore } from '@/stores/consoleLogs';
import { useHistoryStore } from '@/stores/history';
import { mockStorageService } from '../helpers/mockStorage';

const consoleLog = (id: string, timestamp: number, overrides: Partial<ConsoleLog> = {}): ConsoleLog => ({
  id,
  startTime: timestamp - 10,
  method: 'POST',
  url: `https://example.com/${id}`,
  requestHeaders: { 'content-type': 'application/json' },
  requestBody: `{"id":"${id}"}`,
  endTime: timestamp,
  status: 200,
  statusText: 'OK',
  duration: '10ms',
  responseHeaders: {},
  responseBody: `response ${id}`,
  ...overrides,
});

describe('log bodies', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('BODY-001 writes only the new log body and keeps summaries in memory', async () => {
    const store = useConsoleLogsStore();
    const now = Date.now();
    await store.addLog(consoleLog('a', now));
    // 还没写完时直接返回内存中待写入的内容
    expect(await store.loadLogBody('a')).toEqual({ requestBody: '{"id":"a"}', responseBody: 'response a' });
    await store.addLog(consoleLog('b', now + 1, { requestBody: null, responseBody: '' }));
    await store.flush();

    expect(store.logs[0]).not.toHaveProperty('responseBody');
    expect(mockStorageService.consoleLogs.map(log => log.id)).toEqual(['b', 'a']);
    expect(mockStorageService.consoleLogs[1]).not.toHaveProperty('requestBody');
    // 没有 body 的日志不写文件
    expect([...mockStorageService.logBodies.console.keys()]).toEqual(['a']);
    expect(await store.loadLogBody('a')).toEqual({ requestBody: '{"id":"a"}', responseBody: 'response a' });
    expect(await store.loadLogBody('b')).toEqual({ requestBody: null, responseBody: '' });
  });

  it('BODY-002 deletes the bodies of pruned and cleared logs', async () => {
    const store = useConsoleLogsStore();
    const now = Date.now();
    for (let index = 0; index <= MAX_CONSOLE_LOGS; index++) {
      await store.addLog(consoleLog(`log-${index}`, now + index));
    }
    await store.flush();
    expect(store.logs).toHaveLength(MAX_CONSOLE_LOGS);
    expect(mockStorageService.logBodies.console.has('log-0')).toBe(false);
    expect(mockStorageService.logBodies.console.size).toBe(MAX_CONSOLE_LOGS);

    await store.clearLogs();
    expect(mockStorageService.consoleLogs).toEqual([]);
    expect(mockStorageService.logBodies.console.size).toBe(0);
  });

  it('BODY-003 moves bodies of old console logs into their own files and removes leftovers', async () => {
    const now = Date.now();
    mockStorageService.consoleLogs = [consoleLog('old', now), consoleLog('expired', new Date(2000, 0, 1).getTime())];
    mockStorageService.logBodies.console.set('leftover', { requestBody: 'x', responseBody: 'y' });
    const store = useConsoleLogsStore();
    await store.loadLogs();
    await store.flush();

    expect(store.logs.map(log => log.id)).toEqual(['old']);
    expect(mockStorageService.consoleLogs).toHaveLength(1);
    expect(mockStorageService.consoleLogs[0]).not.toHaveProperty('responseBody');
    expect([...mockStorageService.logBodies.console.keys()]).toEqual(['old']);
    expect(await store.loadLogBody('old')).toEqual({ requestBody: '{"id":"old"}', responseBody: 'response old' });

    // 再次启动时不再重写索引
    setActivePinia(createPinia());
    const index = mockStorageService.consoleLogs;
    const reloaded = useConsoleLogsStore();
    await reloaded.loadLogs();
    await reloaded.flush();
    expect(mockStorageService.consoleLogs).toBe(index);
    expect(await reloaded.loadLogBody('old')).toEqual({ requestBody: '{"id":"old"}', responseBody: 'response old' });
  });

  it('BODY-004 history stores request bodies separately and loads them when opening', async () => {
    const now = Date.now();
    const legacy: HistoryItem = {
      ...consoleLogToHistoryItem(consoleLog('legacy', now - 1)),
      responseData: { headers: {}, statusText: 'OK', body: 'old response' },
    };
    mockStorageService.history = [legacy];
    mockStorageService.logBodies.history.set('leftover', { body: 'x' });
    const store = useHistoryStore();
    await store.loadHistory();
    await store.addHistoryItem(consoleLogToHistoryItem(consoleLog('new', now)));
    await store.flush();

    expect(mockStorageService.history.map(item => item.id)).toEqual(['new', 'legacy']);
    expect(mockStorageService.history.every(item => !('body' in item.requestData) && !('body' in item.responseData))).toBe(true);
    expect([...mockStorageService.logBodies.history.keys()].sort()).toEqual(['legacy', 'new']);
    expect(await store.loadRequestBody('legacy')).toBe('{"id":"legacy"}');
    expect(await store.loadRequestBody('new')).toBe('{"id":"new"}');

    await store.deleteHistoryItem('new');
    await store.flush();
    expect([...mockStorageService.logBodies.history.keys()]).toEqual(['legacy']);
    await store.clearHistory();
    expect(mockStorageService.logBodies.history.size).toBe(0);
    expect(await store.loadRequestBody('legacy')).toBeNull();
  });
});
