import type { KeyValue } from '@/types/models';

export type BulkEditRow = Pick<KeyValue, 'key' | 'value' | 'enabled' | 'hasEquals'>;

export const serializeKeyValueBulkEdit = (rows: readonly BulkEditRow[]): string =>
  rows
    .filter(row => row.key !== '' || row.value !== '')
    .map(row => `${row.key}: ${row.value}`)
    .join('\n');

export const parseKeyValueBulkEdit = (
  text: string,
  previousRows: readonly BulkEditRow[] = [],
): BulkEditRow[] => {
  let rowIndex = 0;
  return text
    .split(/\r?\n/)
    .flatMap(line => {
      if (!line.trim()) return [];

      const separatorIndex = line.indexOf(':');
      const key = (separatorIndex < 0 ? line : line.slice(0, separatorIndex)).trim();

      const value = separatorIndex < 0
        ? ''
        : line.slice(separatorIndex + 1).replace(/^ /, '');
      if (!key && !value) return [];
      const previous = previousRows[rowIndex++];

      return [{
        key,
        value,
        enabled: previous?.enabled ?? true,
        ...(previous?.key === key && previous.value === value && previous.hasEquals !== undefined
          ? { hasEquals: previous.hasEquals }
          : {}),
      }];
    });
};
