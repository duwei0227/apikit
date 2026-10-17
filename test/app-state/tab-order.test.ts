import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAppStateStore } from '@/stores/appState';
import { mockStorageService } from '../helpers/mockStorage';

const keys = (store: ReturnType<typeof useAppStateStore>) =>
  store.contentTabs.map(tab => `${tab.type}:${tab.id}`);

describe('content tab order', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('appends newly opened requests and workflows in opening order', () => {
    const store = useAppStateStore();
    store.addOpenRequest('r1');
    store.updateOpenWorkflows(['w1']);
    store.addOpenRequest('r2');

    expect(keys(store)).toEqual(['request:r1', 'workflow:w1', 'request:r2']);
    expect(store.activeContentIndex).toBe(2);
  });

  it('lets workflow and request tabs be interleaved by moving', () => {
    const store = useAppStateStore();
    store.updateOpenRequests(['r1', 'r2']);
    store.updateOpenWorkflows(['w1']);

    store.moveTab(2, 0);
    expect(keys(store)).toEqual(['workflow:w1', 'request:r1', 'request:r2']);

    store.moveTab(0, 1);
    expect(keys(store)).toEqual(['request:r1', 'workflow:w1', 'request:r2']);
    expect(store.openRequests).toEqual(['r1', 'r2']);
  });

  it('drops closed tabs and keeps the remaining order', () => {
    const store = useAppStateStore();
    store.updateOpenRequests(['r1', 'r2']);
    store.updateOpenWorkflows(['w1']);
    store.moveTab(2, 0);

    store.updateOpenRequests(['r2']);
    expect(keys(store)).toEqual(['workflow:w1', 'request:r2']);
    expect(store.getContentTabIndex('request', 'r2')).toBe(1);
  });

  it('places a duplicated tab right after its source', () => {
    const store = useAppStateStore();
    store.updateOpenWorkflows(['w1']);
    store.updateOpenRequests(['r1']);
    store.updateOpenWorkflows(['w1', 'w2']);

    store.moveTabAfter({ type: 'workflow', id: 'w2' }, { type: 'workflow', id: 'w1' });
    expect(keys(store)).toEqual(['workflow:w1', 'workflow:w2', 'request:r1']);
  });

  it('restores saved order and falls back to requests-first for legacy state', async () => {
    const store = useAppStateStore();
    await mockStorageService.saveAppState({
      openRequests: ['r1'],
      activeRequestIndex: 0,
      openWorkflows: ['w1'],
      tabOrder: ['workflow:w1', 'request:r1'],
      sidebarWidth: 320,
      footerHeight: 200,
      lastSavedAt: '',
    });
    await store.loadState();
    expect(keys(store)).toEqual(['workflow:w1', 'request:r1']);

    setActivePinia(createPinia());
    const legacyStore = useAppStateStore();
    await mockStorageService.saveAppState({
      openRequests: ['r1'],
      activeRequestIndex: 0,
      openWorkflows: ['w1'],
      sidebarWidth: 320,
      footerHeight: 200,
      lastSavedAt: '',
    });
    await legacyStore.loadState();
    expect(keys(legacyStore)).toEqual(['request:r1', 'workflow:w1']);
  });
});
