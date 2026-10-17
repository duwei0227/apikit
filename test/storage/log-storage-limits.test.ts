import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { ConsoleLog, HistoryItem } from '@/types/models';
import { MAX_CONSOLE_BODY_CHARS, MAX_CONSOLE_LOGS, pruneConsoleLogs, splitConsoleLog } from '@/utils/consoleLogs';
import { consoleLogToHistoryItem, hasInlineHistoryBody, MAX_HISTORY_ITEMS, MAX_HISTORY_REQUEST_BODY_CHARS, pruneHistoryItems, splitHistoryItem } from '@/utils/history';
import { createCoalescedPersister } from '@/utils/coalescedPersister';
import { truncateStoredText } from '@/utils/storedText';
import { useConsoleLogsStore } from '@/stores/consoleLogs';
import { useHistoryStore } from '@/stores/history';
import { mockStorageService } from '../helpers/mockStorage';

const consoleLog = (id: string, timestamp: number, overrides: Partial<ConsoleLog> = {}): ConsoleLog => ({
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
  ...overrides,
});

describe('log storage limits', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('LOG-001 keeps only the newest console logs and truncates large bodies', () => {
    const now = Date.now();
    const logs = Array.from({ length: MAX_CONSOLE_LOGS + 20 }, (_, index) => consoleLog(`log-${index}`, now - index));
    logs[0] = consoleLog('big', now + 1);

    const pruned = pruneConsoleLogs(logs);
    expect(pruned).toHaveLength(MAX_CONSOLE_LOGS);
    expect(pruned[0].id).toBe('big');
    expect(pruned.at(-1)!.id).toBe(`log-${MAX_CONSOLE_LOGS - 1}`);
    // 未变化的日志保持原对象
    expect(pruned[1]).toBe(logs[1]);

    const { summary, body } = splitConsoleLog(consoleLog('big', now, {
      requestBody: 'q'.repeat(MAX_CONSOLE_BODY_CHARS + 10),
      responseBody: 'r'.repeat(MAX_CONSOLE_BODY_CHARS * 2),
    }));
    expect(summary).not.toHaveProperty('requestBody');
    expect(summary).not.toHaveProperty('responseBody');
    expect(body.responseBody.startsWith('r'.repeat(MAX_CONSOLE_BODY_CHARS))).toBe(true);
    expect(body.responseBody).toMatch(/\n… \(truncated, 512\.0 KB in total\)$/);
    expect(body.requestBody).toMatch(/truncated/);
    // 截断后的内容再次拆分时保持不变，不会重复追加说明
    expect(splitConsoleLog({ ...summary, ...body }).body).toEqual(body);
  });

  it('LOG-002 history keeps the request body for restoring but not the response body', () => {
    const item = consoleLogToHistoryItem(consoleLog('a', Date.now(), {
      requestBody: '{"a":1}',
      responseBody: 'large response',
      responseHeaders: { 'content-type': 'application/json' },
    }));
    expect(item.requestData.body).toBe('{"a":1}');
    expect(item.responseData).toEqual({ headers: { 'content-type': 'application/json' }, statusText: 'OK' });

    // 旧版本保存的 History 带响应体，拆分时去掉；请求体过大时截断
    const legacy: HistoryItem = {
      ...item,
      requestData: { ...item.requestData, body: 'b'.repeat(MAX_HISTORY_REQUEST_BODY_CHARS + 1) },
      responseData: { ...item.responseData, body: 'old response' },
    };
    expect(hasInlineHistoryBody(legacy)).toBe(true);
    const { summary, body } = splitHistoryItem(legacy);
    expect(hasInlineHistoryBody(summary)).toBe(false);
    expect(summary.requestData).toEqual({ method: 'GET', url: 'https://example.com/a', headers: {} });
    expect(body.body).toMatch(/truncated/);

    const many = Array.from({ length: MAX_HISTORY_ITEMS + 5 }, (_, index) => ({
      ...summary,
      id: `h-${index}`,
      timestamp: new Date(Date.now() - index - 10).toISOString(),
    }));
    const pruned = pruneHistoryItems(many);
    expect(pruned).toHaveLength(MAX_HISTORY_ITEMS);
    expect(pruned[0]).toBe(many[0]);
  });

  it('LOG-003 truncation leaves short or non-string values alone', () => {
    expect(truncateStoredText('short', 10)).toBe('short');
    expect(truncateStoredText(null, 10)).toBeNull();
    expect(truncateStoredText('你好世界'.repeat(10), 4)).toMatch(/^你好世界\n… \(truncated, 0\.1 KB in total\)$/);
  });

  it('LOG-004 coalesces rapid saves into one write and flushes pending data', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (_value: number[]) => {});
    const persister = createCoalescedPersister(save, 500);
    let data = [1];
    persister.schedule(() => data);
    data = [1, 2];
    persister.schedule(() => data);
    data = [1, 2, 3];
    persister.schedule(() => data);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith([1, 2, 3]);

    persister.schedule(() => [4]);
    await persister.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith([4]);

    // 没有待写入数据时 flush 不会再写
    await persister.flush();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('LOG-005 stores write a burst of logs once and rewrite oversized files on load', async () => {
    vi.useFakeTimers();
    const saveConsole = vi.spyOn(mockStorageService, 'saveConsoleLogs');
    const saveHistory = vi.spyOn(mockStorageService, 'saveHistory');
    const consoleLogs = useConsoleLogsStore();
    const history = useHistoryStore();
    const now = Date.now();

    for (let index = 0; index < 30; index++) {
      const log = consoleLog(`burst-${index}`, now + index);
      await consoleLogs.addLog(log);
      await history.addHistoryItem(consoleLogToHistoryItem(log));
    }
    expect(saveConsole).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(saveConsole).toHaveBeenCalledTimes(1);
    expect(saveHistory).toHaveBeenCalledTimes(1);
    expect(mockStorageService.consoleLogs).toHaveLength(30);

    // 每条日志的 body 单独保存，索引中只有摘要
    expect(mockStorageService.logBodies.console.size).toBe(0);
    expect(mockStorageService.consoleLogs[0]).not.toHaveProperty('responseBody');
  });
});
