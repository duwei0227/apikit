import type { HistoryItem } from '@/types/models';

export const HISTORY_RETENTION_DAYS = 15;

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

export const pruneHistoryItems = (
  items: HistoryItem[],
  now: Date = new Date(),
): HistoryItem[] => {
  const retentionStart = getHistoryRetentionStart(now);

  return items
    .filter(item => getTimestamp(item) >= retentionStart)
    .sort((left, right) => getTimestamp(right) - getTimestamp(left));
};

export const getLocalDateKey = (timestamp: string): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
