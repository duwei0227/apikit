import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { storageService } from '@/services/storage';
import type { Collection, Folder, RequestReference } from '@/types/models';
import { generateId } from '@/utils/id-generator';

interface AddRequestReferenceOptions {
  insertAfterRequestId?: string;
}

export const useCollectionsStore = defineStore('collections', () => {
  // State
  const collections = ref<Collection[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const getCollectionById = computed(() => {
    return (id: string) => collections.value.find(c => c.id === id);
  });

  const getCollectionByName = computed(() => {
    return (name: string) => collections.value.find(c => c.name === name);
  });

  // Actions
  async function loadCollections() {
    isLoading.value = true;
    error.value = null;
    try {
      const loaded = await storageService.loadCollections();
      const order = await storageService.loadCollectionOrder();
      if (order.length > 0) {
        const orderMap = new Map(order.map((id, i) => [id, i]));
        loaded.sort((a, b) => {
          const ia = orderMap.has(a.id) ? orderMap.get(a.id)! : Infinity;
          const ib = orderMap.has(b.id) ? orderMap.get(b.id)! : Infinity;
          return ia - ib;
        });
      }
      collections.value = loaded;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load collections';
      console.error('Failed to load collections:', e);
    } finally {
      isLoading.value = false;
    }
  }

  async function reorderCollections(newOrderIds: string[]) {
    const map = new Map(collections.value.map(c => [c.id, c]));
    const reordered = newOrderIds.map(id => map.get(id)).filter(Boolean) as Collection[];
    // Include any collections not in the order list at the end
    for (const c of collections.value) {
      if (!newOrderIds.includes(c.id)) reordered.push(c);
    }
    collections.value = reordered;
    await storageService.saveCollectionOrder(newOrderIds);
  }

  async function createCollection(name: string, description?: string) {
    try {
      const collection: Collection = {
        id: generateId(),
        name,
        description: description || '',
        folders: [],
        requests: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await storageService.saveCollection(collection);
      collections.value.push(collection);
      // Keep _order.json in sync so the insertion position survives a restart.
      await storageService.saveCollectionOrder(collections.value.map(c => c.id));
      return collection;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create collection';
      console.error('Failed to create collection:', e);
      throw e;
    }
  }

  async function updateCollection(id: string, updates: Partial<Collection>) {
    try {
      const collection = collections.value.find(c => c.id === id);
      if (!collection) {
        throw new Error(`Collection ${id} not found`);
      }

      Object.assign(collection, updates, {
        updatedAt: new Date().toISOString()
      });

      await storageService.saveCollection(collection);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update collection';
      console.error('Failed to update collection:', e);
      throw e;
    }
  }

  async function deleteCollection(id: string) {
    try {
      await storageService.deleteCollection(id);
      const index = collections.value.findIndex(c => c.id === id);
      if (index !== -1) {
        collections.value.splice(index, 1);
      }
      // Keep _order.json in sync after deletion so remaining order survives a restart.
      await storageService.saveCollectionOrder(collections.value.map(c => c.id));
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete collection';
      console.error('Failed to delete collection:', e);
      throw e;
    }
  }

  async function addFolder(collectionId: string, folderName: string, parentFolderId?: string) {
    try {
      const collection = collections.value.find(c => c.id === collectionId);
      if (!collection) {
        throw new Error(`Collection ${collectionId} not found`);
      }

      const newFolder: Folder = {
        id: generateId(),
        name: folderName,
        folders: [],
        requests: []
      };

      if (parentFolderId) {
        const parentFolder = findFolder(collection.folders, parentFolderId);
        if (!parentFolder) {
          throw new Error(`Parent folder ${parentFolderId} not found`);
        }
        // 排到同层级末尾
        newFolder.order = nextOrder(parentFolder);
        parentFolder.folders.push(newFolder);
      } else {
        newFolder.order = nextOrder(collection);
        collection.folders.push(newFolder);
      }

      collection.updatedAt = new Date().toISOString();
      await storageService.saveCollection(collection);
      return newFolder;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to add folder';
      console.error('Failed to add folder:', e);
      throw e;
    }
  }

  async function updateFolder(collectionId: string, folderId: string, updates: Partial<Folder>) {
    try {
      const collection = collections.value.find(c => c.id === collectionId);
      if (!collection) {
        throw new Error(`Collection ${collectionId} not found`);
      }

      const folder = findFolder(collection.folders, folderId);
      if (!folder) {
        throw new Error(`Folder ${folderId} not found`);
      }

      Object.assign(folder, updates);
      collection.updatedAt = new Date().toISOString();
      await storageService.saveCollection(collection);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update folder';
      console.error('Failed to update folder:', e);
      throw e;
    }
  }

  async function deleteFolder(collectionId: string, folderId: string) {
    try {
      const collection = collections.value.find(c => c.id === collectionId);
      if (!collection) {
        throw new Error(`Collection ${collectionId} not found`);
      }

      const deleted = removeFolderRecursive(collection.folders, folderId);
      if (!deleted) {
        throw new Error(`Folder ${folderId} not found`);
      }

      collection.updatedAt = new Date().toISOString();
      await storageService.saveCollection(collection);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete folder';
      console.error('Failed to delete folder:', e);
      throw e;
    }
  }

  async function addRequestReference(
    collectionId: string,
    requestId: string,
    requestName: string,
    requestMethod: string,
    requestUrl: string,
    folderId?: string,
    options: AddRequestReferenceOptions = {}
  ) {
    try {
      const collection = collections.value.find(c => c.id === collectionId);
      if (!collection) {
        throw new Error(`Collection ${collectionId} not found`);
      }

      const requestRef: RequestReference = {
        id: requestId,
        name: requestName,
        method: requestMethod as any,
        url: requestUrl
      };

      const target = folderId ? findFolder(collection.folders, folderId) : collection;
      if (!target) {
        throw new Error(`Folder ${folderId} not found`);
      }

      insertRequestReference(target, requestRef, options.insertAfterRequestId);

      collection.updatedAt = new Date().toISOString();
      await storageService.saveCollection(collection);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to add request reference';
      console.error('Failed to add request reference:', e);
      throw e;
    }
  }

  async function removeRequestReference(collectionId: string, requestId: string) {
    try {
      const collection = collections.value.find(c => c.id === collectionId);
      if (!collection) {
        throw new Error(`Collection ${collectionId} not found`);
      }

      const removed = removeRequestRefRecursive(collection, requestId);
      if (!removed) {
        throw new Error(`Request reference ${requestId} not found`);
      }

      collection.updatedAt = new Date().toISOString();
      await storageService.saveCollection(collection);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to remove request reference';
      console.error('Failed to remove request reference:', e);
      throw e;
    }
  }

  async function updateRequestReference(
    collectionId: string,
    requestId: string,
    requestName: string,
    requestMethod: string,
    requestUrl: string,
    folderId?: string
  ) {
    try {
      const collection = collections.value.find(c => c.id === collectionId);
      if (!collection) {
        throw new Error(`Collection ${collectionId} not found`);
      }

      // Find and update the request reference
      const updateRef = (target: Collection | Folder): boolean => {
        const requestRef = target.requests.find(r => r.id === requestId);
        if (requestRef) {
          requestRef.name = requestName;
          requestRef.method = requestMethod as any;
          requestRef.url = requestUrl;
          return true;
        }

        if ('folders' in target) {
          for (const folder of target.folders) {
            if (updateRef(folder)) {
              return true;
            }
          }
        }
        return false;
      };

      const updated = updateRef(collection);
      if (!updated) {
        // Reference missing due to data inconsistency — insert it instead of failing
        const requestRef: RequestReference = {
          id: requestId,
          name: requestName,
          method: requestMethod as any,
          url: requestUrl
        };
        const target = folderId ? (findFolder(collection.folders, folderId) || collection) : collection;
        // 排到目标层级末尾，避免在已排序集合中留下缺省 order 的混合状态。
        requestRef.order = nextOrder(target);
        target.requests.push(requestRef);
      }

      collection.updatedAt = new Date().toISOString();
      await storageService.saveCollection(collection);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update request reference';
      console.error('Failed to update request reference:', e);
      throw e;
    }
  }


  async function reorderRequest(collectionId: string, requestId: string, direction: 'up' | 'down') {
    try {
      const collection = collections.value.find(c => c.id === collectionId);
      if (!collection) throw new Error(`Collection ${collectionId} not found`);
      const container = findRequestContainer(collection, requestId);
      if (!container) return;
      const index = container.requests.findIndex(r => r.id === requestId);
      if (index === -1) return;
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= container.requests.length) return;
      const temp = container.requests[index];
      container.requests[index] = container.requests[newIndex];
      container.requests[newIndex] = temp;
      // 若带 order，则同时交换 order 值，否则按 order 排序的渲染看不到数组交换的效果。
      const aOrder = container.requests[index].order;
      const bOrder = container.requests[newIndex].order;
      if (typeof aOrder === 'number' && typeof bOrder === 'number') {
        container.requests[index].order = bOrder;
        container.requests[newIndex].order = aOrder;
      }
      collection.updatedAt = new Date().toISOString();
      await storageService.saveCollection(collection);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to reorder request';
      throw e;
    }
  }

  async function moveRequestToTarget(sourceCollectionId: string, requestId: string, targetCollectionId: string, targetFolderId?: string) {
    try {
      const srcCol = collections.value.find(c => c.id === sourceCollectionId);
      if (!srcCol) throw new Error(`Source collection not found`);
      const ref = findRequestRefDeep(srcCol, requestId);
      if (!ref) throw new Error(`Request ref not found`);
      const refCopy: RequestReference = { ...ref };
      removeRequestRefRecursive(srcCol, requestId);
      srcCol.updatedAt = new Date().toISOString();
      await storageService.saveCollection(srcCol);
      const tgtCol = collections.value.find(c => c.id === targetCollectionId);
      if (!tgtCol) throw new Error(`Target collection not found`);
      if (targetFolderId) {
        const folder = findFolder(tgtCol.folders, targetFolderId);
        if (!folder) throw new Error(`Target folder not found`);
        // 排到目标层级末尾
        refCopy.order = nextOrder(folder);
        folder.requests.push(refCopy);
      } else {
        refCopy.order = nextOrder(tgtCol);
        tgtCol.requests.push(refCopy);
      }
      tgtCol.updatedAt = new Date().toISOString();
      await storageService.saveCollection(tgtCol);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to move request';
      throw e;
    }
  }

  function findRequestRefDeep(target: Collection | Folder, requestId: string): RequestReference | null {
    const r = target.requests.find(r => r.id === requestId);
    if (r) return r;
    const folders = 'folders' in target ? target.folders : [];
    for (const f of folders) { const found = findRequestRefDeep(f, requestId); if (found) return found; }
    return null;
  }

  function findRequestContainer(target: Collection | Folder, requestId: string): (Collection | Folder) | null {
    if (target.requests.some(r => r.id === requestId)) return target;
    const folders = 'folders' in target ? target.folders : [];
    for (const f of folders) { const found = findRequestContainer(f, requestId); if (found) return found; }
    return null;
  }

  /**
   * 计算把新子项追加到某层级末尾时应使用的 order。
   * 取同层 folders/requests 现有 order 的最大值 + 1；删除会留下空隙，
   * 故不能用子项数量（否则可能与既有 order 冲突或落在中间）。
   * 当该层尚无任何 order（旧集合）时回退到子项总数。
   */
  function nextOrder(container: Collection | Folder): number {
    const orders = [...container.folders, ...container.requests]
      .map(child => child.order)
      .filter((o): o is number => typeof o === 'number');
    return orders.length > 0
      ? Math.max(...orders) + 1
      : container.folders.length + container.requests.length;
  }

  function insertRequestReference(
    container: Collection | Folder,
    requestRef: RequestReference,
    insertAfterRequestId?: string
  ) {
    if (!insertAfterRequestId) {
      requestRef.order = nextOrder(container);
      container.requests.push(requestRef);
      return;
    }

    const entries = orderedChildEntries(container);
    const sourceIndex = entries.findIndex(
      entry => entry.kind === 'request' && entry.item.id === insertAfterRequestId
    );

    if (sourceIndex === -1) {
      requestRef.order = nextOrder(container);
      container.requests.push(requestRef);
      return;
    }

    container.requests.push(requestRef);
    entries.splice(sourceIndex + 1, 0, { kind: 'request', item: requestRef });
    entries.forEach((entry, index) => {
      entry.item.order = index;
    });
  }

  function orderedChildEntries(container: Collection | Folder) {
    const entries = [
      ...container.requests.map((request, index) => ({
        kind: 'request' as const,
        item: request,
        index,
        order: request.order
      })),
      ...container.folders.map((folder, index) => ({
        kind: 'folder' as const,
        item: folder,
        index,
        order: folder.order
      }))
    ];

    const allOrdered = entries.length > 0 && entries.every(entry => typeof entry.order === 'number');
    if (allOrdered) {
      return entries.sort((a, b) => a.order - b.order);
    }

    return entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.index - b.index;
    });
  }

  // Helper functions
  function findFolder(folders: Folder[], folderId: string): Folder | null {
    for (const folder of folders) {
      if (folder.id === folderId) {
        return folder;
      }
      const found = findFolder(folder.folders, folderId);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function removeFolderRecursive(folders: Folder[], folderId: string): boolean {
    const index = folders.findIndex(f => f.id === folderId);
    if (index !== -1) {
      folders.splice(index, 1);
      return true;
    }

    for (const folder of folders) {
      if (removeFolderRecursive(folder.folders, folderId)) {
        return true;
      }
    }
    return false;
  }

  function removeRequestRefRecursive(
    target: Collection | Folder,
    requestId: string
  ): boolean {
    const index = target.requests.findIndex(r => r.id === requestId);
    if (index !== -1) {
      target.requests.splice(index, 1);
      return true;
    }

    if ('folders' in target) {
      for (const folder of target.folders) {
        if (removeRequestRefRecursive(folder, requestId)) {
          return true;
        }
      }
    }
    return false;
  }

  return {
    // State
    collections,
    isLoading,
    error,
    
    // Getters
    getCollectionById,
    getCollectionByName,
    
    // Actions
    loadCollections,
    createCollection,
    updateCollection,
    deleteCollection,
    addFolder,
    updateFolder,
    deleteFolder,
    addRequestReference,
    updateRequestReference,
    removeRequestReference,
    reorderRequest,
    reorderCollections,
    moveRequestToTarget
  };
});
