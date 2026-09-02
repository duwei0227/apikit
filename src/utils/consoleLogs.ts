import type { ConsoleLog } from '@/types/models';

export const CONSOLE_LOG_RETENTION_DAYS = 15;

const getTimestamp = (log: ConsoleLog): number => {
  const timestamp = Number(log.endTime || log.startTime);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const getConsoleLogRetentionStart = (now: Date = new Date()): number => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (CONSOLE_LOG_RETENTION_DAYS - 1));
  return start.getTime();
};

export const pruneConsoleLogs = (
  logs: ConsoleLog[],
  now: Date = new Date(),
): ConsoleLog[] => {
  const retentionStart = getConsoleLogRetentionStart(now);

  return logs
    .filter(log => getTimestamp(log) >= retentionStart)
    .sort((left, right) => getTimestamp(right) - getTimestamp(left));
};
