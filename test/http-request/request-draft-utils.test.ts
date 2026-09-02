import { describe, expect, it } from 'vitest';
import type { Request } from '@/types/models';
import {
  prepareRequestForEditing,
  prepareRequestForPersistence,
  requestDraftFingerprint,
} from '@/utils/requestDraft';

const makeRequest = (): Request => ({
  id: 'request-1',
  name: 'Request',
  method: 'POST',
  url: 'https://example.com',
  params: [{ key: 'page', value: '1', enabled: true }],
  headers: [],
  body: {
    type: 'json',
    raw: '{"ok":true}',
    formData: [],
    urlencoded: [],
  },
  auth: { type: 'none', token: '', username: '', password: '' },
  tests: { statusCodeTests: [], jsonFieldTests: [], globalVariables: [] },
  settings: { verifySsl: true },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('request draft normalization', () => {
  it('prepares an independent editing copy with exactly one trailing empty row', () => {
    const source = makeRequest() as Request & { _temporary?: boolean };
    source._temporary = true;

    const editing = prepareRequestForEditing(source);

    expect(editing).not.toBe(source);
    expect(editing.params).toHaveLength(2);
    expect(editing.params.at(-1)).toEqual({ key: '', value: '', enabled: true });
    expect(editing.headers).toEqual([{ key: '', value: '', enabled: true }]);
    expect(editing.body.formData).toEqual([{ key: '', value: '', type: 'text', enabled: true }]);
    expect(editing.body.urlencoded).toEqual([{ key: '', value: '', enabled: true }]);
    expect((editing as any)._temporary).toBeUndefined();
    expect(source.params).toHaveLength(1);

    editing.params.push({ key: '', value: '', enabled: false });
    const preparedAgain = prepareRequestForEditing(editing);
    expect(preparedAgain.params).toHaveLength(2);
  });

  it('removes editing rows without modifying the editor request', () => {
    const editing = prepareRequestForEditing(makeRequest());

    const persisted = prepareRequestForPersistence(editing);

    expect(persisted.params).toEqual([{ key: 'page', value: '1', enabled: true }]);
    expect(persisted.headers).toEqual([]);
    expect(persisted.body.formData).toEqual([]);
    expect(persisted.body.urlencoded).toEqual([]);
    expect(editing.params).toHaveLength(2);
  });

  it('ignores timestamps and empty rows but detects executable request changes', () => {
    const baseline = prepareRequestForEditing(makeRequest());
    const equivalent = prepareRequestForEditing({
      ...makeRequest(),
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    equivalent.headers.push({ key: '', value: '', enabled: false });

    expect(requestDraftFingerprint(equivalent)).toBe(requestDraftFingerprint(baseline));

    const changed = prepareRequestForEditing(makeRequest());
    changed.settings = { verifySsl: false };
    expect(requestDraftFingerprint(changed)).not.toBe(requestDraftFingerprint(baseline));
  });
});
