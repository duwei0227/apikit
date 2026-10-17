import type { ConsoleLog, ConsoleLogBody, ConsoleLogSummary, StoredConsoleLog } from '@/types/models';
import { truncateStoredText } from './storedText';

export const CONSOLE_LOG_RETENTION_DAYS = 14;
export const MAX_CONSOLE_LOGS = 100;
/** 每条日志中请求体、响应体各自保存的最大字符数 */
export const MAX_CONSOLE_BODY_CHARS = 256 * 1024;

/** 旧版本把 body 和摘要保存在同一个索引文件中 */
export const hasInlineConsoleBody = (log: StoredConsoleLog): boolean => 'requestBody' in log || 'responseBody' in log;

/** 拆成索引中的摘要和单独保存的 body（body 过大时截断） */
export const splitConsoleLog = (log: ConsoleLog | StoredConsoleLog): { summary: ConsoleLogSummary; body: ConsoleLogBody } => {
  const { requestBody = null, responseBody = '', ...summary } = log;
  return {
    summary,
    body: {
      requestBody: truncateStoredText(requestBody, MAX_CONSOLE_BODY_CHARS),
      responseBody: truncateStoredText(responseBody, MAX_CONSOLE_BODY_CHARS),
    },
  };
};

export const isEmptyConsoleLogBody = (body: ConsoleLogBody): boolean => !body.requestBody && !body.responseBody;

const getTimestamp = (log: Pick<ConsoleLog, 'startTime' | 'endTime'>): number => {
  const timestamp = Number(log.endTime || log.startTime);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const getConsoleLogRetentionStart = (now: Date = new Date()): number => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (CONSOLE_LOG_RETENTION_DAYS - 1));
  return start.getTime();
};

/** 去掉过期的日志，按时间倒序保留最新的 MAX_CONSOLE_LOGS 条 */
export const pruneConsoleLogs = <T extends Pick<ConsoleLog, 'startTime' | 'endTime'>>(
  logs: T[],
  now: Date = new Date(),
): T[] => {
  const retentionStart = getConsoleLogRetentionStart(now);

  return logs
    .filter(log => getTimestamp(log) >= retentionStart)
    .sort((left, right) => getTimestamp(right) - getTimestamp(left))
    .slice(0, MAX_CONSOLE_LOGS);
};
