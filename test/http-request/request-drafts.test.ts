import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRequestsStore } from '@/stores/requests';
import { mockStorageService } from '../helpers/mockStorage';
import type { Request } from '@/types/models';

const makeRequest = (raw: string): Request => ({
  id: 'req-1',
  name: 'My Request',
  method: 'GET',
  url: 'https://example.com',
  params: [],
  headers: [],
  body: { type: 'raw', raw, formData: [], urlencoded: [] },
  auth: { type: 'none', token: '', username: '', password: '' },
  tests: { statusCodeTests: [], jsonFieldTests: [], globalVariables: [] },
  settings: {
    followRedirects: true,
    maxRedirectCount: 10,
    verifySsl: true,
    autoEncodeUrl: true,
    acceptEncoding: true,
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as Request);

describe('requests store draft lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('RQ-DRAFT-001 keeps the saved baseline separate from staged edits across a restart', async () => {
    const store = useRequestsStore();

    // Save the committed version.
    await store.saveRequest(makeRequest('SAVED'));
    expect(mockStorageService.requests.get('req-1')?.body.raw).toBe('SAVED');
    expect(store.hasRequestDraft('req-1')).toBe(false);

    // Stage an unsaved edit (body only) -> goes to a draft, NOT the saved file.
    await store.setRequestDraft(makeRequest('EDITED'));
    expect(store.hasRequestDraft('req-1')).toBe(true);
    expect(mockStorageService.requestDrafts.get('req-1')?.body.raw).toBe('EDITED');
    // The saved version must remain untouched (this is the core of the bug).
    expect(mockStorageService.requests.get('req-1')?.body.raw).toBe('SAVED');

    // Simulate a restart / version update: fresh store, reload drafts from disk.
    setActivePinia(createPinia());
    const restarted = useRequestsStore();
    await restarted.loadRequestDrafts();

    // Working copy restores the unsaved edit...
    const working = await restarted.loadRequest('req-1');
    expect(working?.body.raw).toBe('EDITED');
    // ...while the comparison baseline is still the SAVED version (previously
    // this incorrectly returned EDITED, so the edit was silently "persisted").
    const baseline = await restarted.loadSavedRequest('req-1');
    expect(baseline?.body.raw).toBe('SAVED');
    expect(restarted.hasRequestDraft('req-1')).toBe(true);
  });

  it('RQ-DRAFT-002 commits the draft and clears it on explicit save', async () => {
    const store = useRequestsStore();
    await store.saveRequest(makeRequest('SAVED'));
    await store.setRequestDraft(makeRequest('EDITED'));

    await store.saveRequest(makeRequest('EDITED'));

    expect(store.hasRequestDraft('req-1')).toBe(false);
    expect(mockStorageService.requestDrafts.has('req-1')).toBe(false);
    expect(mockStorageService.requests.get('req-1')?.body.raw).toBe('EDITED');
  });

  it('RQ-DRAFT-003 discards the draft and reverts the working copy to saved', async () => {
    const store = useRequestsStore();
    await store.saveRequest(makeRequest('SAVED'));
    await store.setRequestDraft(makeRequest('EDITED'));

    const reverted = await store.discardRequestDraft('req-1');
    expect(reverted?.body.raw).toBe('SAVED');
    expect(store.hasRequestDraft('req-1')).toBe(false);
    expect(mockStorageService.requestDrafts.has('req-1')).toBe(false);

    const working = await store.loadRequest('req-1');
    expect(working?.body.raw).toBe('SAVED');
  });

  it('RQ-DRAFT-004 deleting a request also removes its draft', async () => {
    const store = useRequestsStore();
    await store.saveRequest(makeRequest('SAVED'));
    await store.setRequestDraft(makeRequest('EDITED'));

    await store.deleteRequest('req-1');

    expect(mockStorageService.requests.has('req-1')).toBe(false);
    expect(mockStorageService.requestDrafts.has('req-1')).toBe(false);
  });

  it('RQ-LOAD-005 deduplicates IDs while loading requests in parallel', async () => {
    const first = makeRequest('FIRST');
    const second = { ...makeRequest('SECOND'), id: 'req-2' };
    mockStorageService.requests.set(first.id, first);
    mockStorageService.requests.set(second.id, second);
    const loadSpy = vi.spyOn(mockStorageService, 'loadRequest');
    const store = useRequestsStore();

    const loaded = await store.loadMultipleRequests(['req-1', 'req-1', 'req-2']);

    expect(loaded.map(request => request.id)).toEqual(['req-1', 'req-2']);
    expect(loadSpy).toHaveBeenCalledTimes(2);
    loadSpy.mockRestore();
  });

  it('RQ-LOAD-006 shares an in-flight load for the same request', async () => {
    const saved = makeRequest('SAVED');
    mockStorageService.requests.set(saved.id, saved);
    const originalLoad = mockStorageService.loadRequest.bind(mockStorageService);
    const loadSpy = vi.spyOn(mockStorageService, 'loadRequest').mockImplementation(async id => {
      await Promise.resolve();
      return originalLoad(id);
    });
    const store = useRequestsStore();

    const [first, second] = await Promise.all([
      store.loadRequest(saved.id),
      store.loadRequest(saved.id),
    ]);

    expect(first).toEqual(second);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    loadSpy.mockRestore();
  });

  it('RQ-LOAD-007 shares the saved file read between working and baseline loads', async () => {
    const saved = makeRequest('SAVED');
    mockStorageService.requests.set(saved.id, saved);
    const originalLoad = mockStorageService.loadRequest.bind(mockStorageService);
    const loadSpy = vi.spyOn(mockStorageService, 'loadRequest').mockImplementation(async id => {
      await Promise.resolve();
      return originalLoad(id);
    });
    const store = useRequestsStore();

    const [working, baseline] = await Promise.all([
      store.loadRequest(saved.id),
      store.loadSavedRequest(saved.id),
    ]);

    expect(working).toEqual(baseline);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    loadSpy.mockRestore();
  });
});
