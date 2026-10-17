import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import { makeRequest } from '../helpers/workflowFactory';
import { mockStorageService } from '../helpers/mockStorage';

describe('deleting collections and folders', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const addRequest = async (collectionId: string, folderId?: string) => {
    const request = makeRequest({ collectionId, folderId } as never);
    await useRequestsStore().saveRequest(request, true);
    await useCollectionsStore().addRequestReference(collectionId, request.id, request.name, request.method, request.url, folderId);
    return request;
  };

  it('COL-DEL-001 deletes the requests inside a deleted folder and keeps the others', async () => {
    const collections = useCollectionsStore();
    const collection = await collections.createCollection('Shop');
    const folder = await collections.addFolder(collection.id, 'Orders');
    const nested = await collections.addFolder(collection.id, 'Archive', folder.id);
    const inFolder = await addRequest(collection.id, folder.id);
    const inNested = await addRequest(collection.id, nested.id);
    const atRoot = await addRequest(collection.id);
    await useRequestsStore().setRequestDraft({ ...inFolder, url: 'https://example.com/draft' });
    mockStorageService.requestDrafts.set(inFolder.id, { ...inFolder });

    await collections.deleteFolder(collection.id, folder.id);

    expect(mockStorageService.requests.has(inFolder.id)).toBe(false);
    expect(mockStorageService.requests.has(inNested.id)).toBe(false);
    expect(mockStorageService.requestDrafts.has(inFolder.id)).toBe(false);
    expect(mockStorageService.requests.has(atRoot.id)).toBe(true);
  });

  it('COL-DEL-002 deletes every request of a deleted collection', async () => {
    const collections = useCollectionsStore();
    const collection = await collections.createCollection('Shop');
    const other = await collections.createCollection('Other');
    const folder = await collections.addFolder(collection.id, 'Orders');
    const inFolder = await addRequest(collection.id, folder.id);
    const atRoot = await addRequest(collection.id);
    const elsewhere = await addRequest(other.id);

    await collections.deleteCollection(collection.id);

    expect(mockStorageService.requests.has(inFolder.id)).toBe(false);
    expect(mockStorageService.requests.has(atRoot.id)).toBe(false);
    expect(mockStorageService.requests.has(elsewhere.id)).toBe(true);
  });
});

describe('moving requests', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('COL-MOVE-001 keeps the request in place when the target does not exist', async () => {
    const collections = useCollectionsStore();
    const collection = await collections.createCollection('Shop');
    const request = makeRequest({ collectionId: collection.id } as never);
    await collections.addRequestReference(collection.id, request.id, request.name, request.method, request.url);

    await expect(collections.moveRequestToTarget(collection.id, request.id, 'missing-collection')).rejects.toThrow('Target collection not found');
    await expect(collections.moveRequestToTarget(collection.id, request.id, collection.id, 'missing-folder')).rejects.toThrow('Target folder not found');

    expect(collections.collections[0].requests.map(ref => ref.id)).toEqual([request.id]);
    expect(mockStorageService.collections.get(collection.id)?.requests.map(ref => ref.id)).toEqual([request.id]);
  });
});
