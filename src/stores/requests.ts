import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { storageService } from '@/services/storage';
import type { Request } from '@/types/models';

const cloneRequest = (request: Request): Request => JSON.parse(JSON.stringify(request));

export const useRequestsStore = defineStore('requests', () => {
  // State - using Map for efficient lookups
  // `requests` holds the working copy shown in the editor (draft if one exists,
  // otherwise the saved version).
  const requests = ref<Map<string, Request>>(new Map());
  const isLoading = ref(false);

  // Staged, unsaved edits persisted to `requests/_drafts/`. Mirrors the workflow
  // draft mechanism so that the saved version (`requests/{id}.json`) is only
  // overwritten on an explicit save. The presence of a draft means "unsaved".
  const requestDrafts = ref<Map<string, Request>>(new Map());
  const savedRequests = new Map<string, Request>();
  const pendingRequestLoads = new Map<string, Promise<Request | null>>();
  const pendingSavedRequestLoads = new Map<string, Promise<Request | null>>();
  let activeLoadCount = 0;

  // Response cache - 不持久化，仅在内存中保留（用于 tab 切换时保持 response 状态）
  const responseCache = ref<Map<string, any>>(new Map());

  // Getters
  const getRequestById = computed(() => {
    return (id: string) => requests.value.get(id);
  });

  const getRequestsByCollectionId = computed(() => {
    return (collectionId: string) => {
      return Array.from(requests.value.values()).filter(
        r => r.collectionId === collectionId
      );
    };
  });

  // Actions

  const trackLoad = async <T>(operation: () => Promise<T>): Promise<T> => {
    activeLoadCount++;
    isLoading.value = true;
    try {
      return await operation();
    } finally {
      activeLoadCount = Math.max(0, activeLoadCount - 1);
      isLoading.value = activeLoadCount > 0;
    }
  };

  // Load all persisted request drafts into memory. Call once during app init,
  // before open request tabs are restored.
  async function loadRequestDrafts(): Promise<void> {
    try {
      const drafts = await storageService.loadRequestDrafts();
      requestDrafts.value = new Map(Object.entries(drafts));
    } catch (e) {
      console.error('Failed to load request drafts:', e);
      requestDrafts.value = new Map();
    }
  }

  function getRequestDraft(id: string): Request | null {
    return requestDrafts.value.get(id) || null;
  }

  function hasRequestDraft(id: string): boolean {
    return requestDrafts.value.has(id);
  }

  // Load the saved (committed) version straight from `requests/{id}.json`,
  // bypassing both the in-memory working cache and any draft. Used as the
  // baseline for unsaved-change detection.
  async function loadSavedRequest(id: string): Promise<Request | null> {
    const cached = savedRequests.get(id);
    if (cached) return cached;

    const existingLoad = pendingSavedRequestLoads.get(id);
    if (existingLoad) return existingLoad;

    // A normal load without a draft reads the same saved request file. Reuse it
    // instead of issuing a second filesystem command for the comparison baseline.
    const workingLoad = pendingRequestLoads.get(id);
    if (workingLoad && !requestDrafts.value.has(id)) {
      return workingLoad.then(request => {
        if (request) savedRequests.set(id, cloneRequest(request));
        return savedRequests.get(id) || null;
      });
    }

    const load = trackLoad(async () => {
      try {
        const request = await storageService.loadRequest(id);
        if (request) savedRequests.set(id, cloneRequest(request));
        return savedRequests.get(id) || null;
      } catch (e) {
        console.error(`Failed to load saved request ${id}:`, e);
        return null;
      }
    }).finally(() => pendingSavedRequestLoads.delete(id));
    pendingSavedRequestLoads.set(id, load);
    return load;
  }

  async function loadRequest(id: string): Promise<Request | null> {
    // Check cache first
    if (requests.value.has(id)) {
      return requests.value.get(id)!;
    }

    // Prefer a staged draft over the saved version so the editor restores the
    // user's unsaved edits after a restart.
    const draft = requestDrafts.value.get(id);
    if (draft) {
      requests.value.set(id, draft);
      return draft;
    }

    const existingLoad = pendingRequestLoads.get(id);
    if (existingLoad) return existingLoad;

    const load = trackLoad(async () => {
      try {
        const request = await storageService.loadRequest(id);
        if (request) {
          requests.value.set(id, request);
          savedRequests.set(id, cloneRequest(request));
        }
        return request;
      } catch (e) {
        console.error(`Failed to load request ${id}:`, e);
        return null;
      }
    }).finally(() => pendingRequestLoads.delete(id));
    pendingRequestLoads.set(id, load);
    return load;
  }

  async function reloadRequestFromStorage(id: string): Promise<Request | null> {
    // Force reload from storage, bypassing the in-memory cache. Still prefers a
    // staged draft so consumers (e.g. workflow execution) see the working copy.
    const draft = requestDrafts.value.get(id);
    if (draft) {
      requests.value.set(id, draft);
      return draft;
    }

    const existingLoad = pendingRequestLoads.get(id);
    if (existingLoad) return existingLoad;

    const load = trackLoad(async () => {
      try {
        const request = await storageService.loadRequest(id);
        if (request) {
          requests.value.set(id, request);
          savedRequests.set(id, cloneRequest(request));
        }
        return request;
      } catch (e) {
        console.error(`Failed to reload request ${id}:`, e);
        return null;
      }
    }).finally(() => pendingRequestLoads.delete(id));
    pendingRequestLoads.set(id, load);
    return load;
  }

  async function loadMultipleRequests(ids: string[]): Promise<Request[]> {
    const uniqueIds = [...new Set(ids)];
    const loadedRequests = await Promise.all(uniqueIds.map(id => loadRequest(id)));
    return loadedRequests.filter((request): request is Request => Boolean(request));
  }

  async function saveRequest(request: Request, immediate: boolean = false): Promise<void> {
    try {
      request.updatedAt = new Date().toISOString();
      await storageService.saveRequest(request, immediate);
      requests.value.set(request.id, request);
      savedRequests.set(request.id, cloneRequest(request));
      // An explicit save commits the working copy: the staged draft is no
      // longer needed.
      clearRequestDraft(request.id);
    } catch (e) {
      console.error(`Failed to save request ${request.id}:`, e);
      throw e;
    }
  }

  // Persist a staged edit as a draft without touching the saved version. This is
  // the auto-save target while the user is editing.
  async function setRequestDraft(request: Request): Promise<void> {
    request.updatedAt = new Date().toISOString();
    const next = new Map(requestDrafts.value);
    next.set(request.id, request);
    requestDrafts.value = next;
    requests.value.set(request.id, request);
    try {
      await storageService.saveRequestDraft(request);
    } catch (e) {
      console.error(`Failed to save request draft ${request.id}:`, e);
    }
  }

  function clearRequestDraft(id: string): void {
    if (requestDrafts.value.has(id)) {
      const next = new Map(requestDrafts.value);
      next.delete(id);
      requestDrafts.value = next;
    }
    storageService.deleteRequestDraft(id).catch(e => {
      console.error(`Failed to delete request draft ${id}:`, e);
    });
  }

  // Discard staged edits: drop the draft and reload the saved version into the
  // working cache. Returns the saved request (or null if it has no saved file).
  async function discardRequestDraft(id: string): Promise<Request | null> {
    clearRequestDraft(id);
    const saved = await storageService.loadRequest(id);
    if (saved) {
      requests.value.set(id, saved);
      savedRequests.set(id, cloneRequest(saved));
    } else {
      requests.value.delete(id);
      savedRequests.delete(id);
    }
    return saved;
  }

  async function deleteRequest(id: string): Promise<void> {
    try {
      await storageService.deleteRequest(id);
      requests.value.delete(id);
      savedRequests.delete(id);
      if (requestDrafts.value.has(id)) {
        const next = new Map(requestDrafts.value);
        next.delete(id);
        requestDrafts.value = next;
      }
    } catch (e) {
      console.error(`Failed to delete request ${id}:`, e);
      throw e;
    }
  }

  function clearCache(): void {
    requests.value.clear();
    savedRequests.clear();
  }

  function removeCachedRequest(id: string): void {
    requests.value.delete(id);
    savedRequests.delete(id);
    responseCache.value.delete(id);
  }

  function setResponseCache(requestId: string, data: any): void {
    responseCache.value.set(requestId, data);
  }

  function getResponseCache(requestId: string): any | null {
    return responseCache.value.get(requestId) || null;
  }

  return {
    // State
    requests,
    requestDrafts,
    isLoading,
    responseCache,

    // Getters
    getRequestById,
    getRequestsByCollectionId,

    // Actions
    loadRequest,
    loadSavedRequest,
    loadMultipleRequests,
    reloadRequestFromStorage,
    saveRequest,
    deleteRequest,
    clearCache,
    removeCachedRequest,
    setResponseCache,
    getResponseCache,
    // Draft lifecycle
    loadRequestDrafts,
    getRequestDraft,
    hasRequestDraft,
    setRequestDraft,
    clearRequestDraft,
    discardRequestDraft
  };
});
