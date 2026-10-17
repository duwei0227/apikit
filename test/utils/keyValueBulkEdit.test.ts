import { describe, expect, it } from 'vitest';
import { parseKeyValueBulkEdit, serializeKeyValueBulkEdit } from '@/utils/keyValueBulkEdit';
import type { KeyValue } from '@/types/models';

describe('key-value bulk edit', () => {
  it('serializes rows with a colon separator and ignores the empty table row', () => {
    expect(serializeKeyValueBulkEdit([
      { key: 'name', value: 'Ada Lovelace', enabled: true },
      { key: 'X-Api-Version', value: '2', enabled: false },
      { key: '', value: '', enabled: true },
    ])).toBe('name: Ada Lovelace\nX-Api-Version: 2');
  });

  it('splits each row at its first colon and preserves colons and equals in values', () => {
    expect(parseKeyValueBulkEdit('Authorization: Basic a:b=c\nempty: \nflag')).toEqual([
      { key: 'Authorization', value: 'Basic a:b=c', enabled: true },
      { key: 'empty', value: '', enabled: true },
      { key: 'flag', value: '', enabled: true },
    ]);
  });

  it('ignores blank lines and preserves values entered without a key', () => {
    expect(parseKeyValueBulkEdit('\n: ignored\npage: 2\n\n')).toEqual([
      { key: '', value: 'ignored', enabled: true },
      { key: 'page', value: '2', enabled: true },
    ]);
  });

  it('preserves row enabled state and the no-equals query distinction when unchanged', () => {
    const previous: KeyValue[] = [
      { key: 'flag', value: '', enabled: false, hasEquals: false },
      { key: 'page', value: '2', enabled: true, hasEquals: true },
    ];

    expect(parseKeyValueBulkEdit(serializeKeyValueBulkEdit(previous), previous)).toEqual(previous);
  });
});
