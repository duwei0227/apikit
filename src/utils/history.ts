import type { ConsoleLog, HistoryItem, HistoryItemBody } from '@/types/models';
import { truncateStoredText } from './storedText';

export const HISTORY_RETENTION_DAYS = 14;
export const MAX_HISTORY_ITEMS = 100;
/** 请求体用于从 History 恢复请求，保留得比 Console 多 */
export const MAX_HISTORY_REQUEST_BODY_CHARS = 1024 * 1024;

/** 旧版本把请求体（更早的版本还有响应体）和摘要保存在同一个索引文件中 */
export const hasInlineHistoryBody = (item: HistoryItem): boolean => (
  'body' in (item.requestData || {}) || 'body' in (item.responseData || {})
);

/**
 * 拆成索引中的摘要和单独保存的请求体（过大时截断）。
 * History 只用请求部分恢复请求；响应体已在 Console 中保存，这里不保存。
 */
export const splitHistoryItem = (item: HistoryItem): { summary: HistoryItem; body: HistoryItemBody } => {
  const { body = null, ...requestData } = item.requestData || {};
  const { body: _responseBody, ...responseData } = item.responseData || {};
  return {
    summary: { ...item, requestData, responseData },
    body: { body: truncateStoredText(body, MAX_HISTORY_REQUEST_BODY_CHARS) },
  };
};

/** 把一次请求的 Console 记录转成 History 条目 */
export const consoleLogToHistoryItem = (log: Partial<ConsoleLog>): HistoryItem => {
  const endTime = log.endTime || Date.now();
  return {
    id: String(log.id || endTime),
    method: log.method || 'GET',
    url: log.url || '',
    status: log.status ?? 0,
    duration: log.duration || '',
    timestamp: new Date(endTime).toISOString(),
    requestData: {
      method: log.method || 'GET',
      url: log.url || '',
      headers: log.requestHeaders || {},
      body: log.requestBody ?? null,
    },
    responseData: {
      headers: log.responseHeaders || {},
      statusText: log.statusText || '',
    },
  };
};

const getTimestamp = (item: HistoryItem): number => {
  const timestamp = Date.parse(item.timestamp);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

export const getHistoryRetentionStart = (now: Date = new Date()): number => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (HISTORY_RETENTION_DAYS - 1));
  return start.getTime();
};

/** 去掉过期的记录，按时间倒序保留最新的 MAX_HISTORY_ITEMS 条 */
export const pruneHistoryItems = (
  items: HistoryItem[],
  now: Date = new Date(),
): HistoryItem[] => {
  const retentionStart = getHistoryRetentionStart(now);

  return items
    .filter(item => getTimestamp(item) >= retentionStart)
    .sort((left, right) => getTimestamp(right) - getTimestamp(left))
    .slice(0, MAX_HISTORY_ITEMS);
};

export const getLocalDateKey = (timestamp: string): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
