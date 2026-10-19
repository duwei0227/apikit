import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import { buildCollectionTree, type CollectionTreeNode } from '@/utils/collectionTree';
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

describe('reordering folders', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  /** 树中的显示顺序：文件夹为 [名称, 子项] */
  const shape = (collectionId: string) => {
    const collection = buildCollectionTree(useCollectionsStore().collections).find(node => node.data.id === collectionId)!;
    const visit = (nodes: CollectionTreeNode[]): unknown[] => nodes.map(node => (
      node.data.type === 'folder' ? [node.label, visit(node.children)] : node.label
    ));
    return visit(collection.children);
  };

  it('COL-MOVE-002 swaps a folder with the next item shown in the tree, including requests', async () => {
    const collections = useCollectionsStore();
    const collection = await collections.createCollection('Shop');
    const orders = await collections.addFolder(collection.id, 'Orders');
    const archive = await collections.addFolder(collection.id, 'Archive', orders.id);
    await collections.addRequestReference(collection.id, 'r1', 'Login', 'GET', '/login');
    await collections.addFolder(collection.id, 'Users');
    await collections.addRequestReference(collection.id, 'r2', 'List', 'GET', '/orders', orders.id);

    expect(shape(collection.id)).toEqual([['Orders', [['Archive', []], 'List']], 'Login', ['Users', []]]);

    await collections.reorderFolder(collection.id, orders.id, 'down');
    expect(shape(collection.id)).toEqual(['Login', ['Orders', [['Archive', []], 'List']], ['Users', []]]);
    await collections.reorderFolder(collection.id, orders.id, 'down');
    expect(shape(collection.id)).toEqual(['Login', ['Users', []], ['Orders', [['Archive', []], 'List']]]);
    // 已在最下面时不变
    await collections.reorderFolder(collection.id, orders.id, 'down');
    expect(shape(collection.id)).toEqual(['Login', ['Users', []], ['Orders', [['Archive', []], 'List']]]);

    // 子文件夹在所在文件夹中移动
    await collections.reorderFolder(collection.id, archive.id, 'down');
    expect(shape(collection.id)).toEqual(['Login', ['Users', []], ['Orders', ['List', ['Archive', []]]]]);
    await collections.reorderFolder(collection.id, archive.id, 'up');
    await collections.reorderFolder(collection.id, archive.id, 'up');
    expect(shape(collection.id)).toEqual(['Login', ['Users', []], ['Orders', [['Archive', []], 'List']]]);

    expect(mockStorageService.collections.get(collection.id)?.folders.map(folder => [folder.name, folder.order])).toEqual([['Orders', 2], ['Users', 1]]);
  });

  it('COL-MOVE-003 reorders folders of an older collection whose items have no order', async () => {
    const collections = useCollectionsStore();
    const collection = await collections.createCollection('Legacy');
    const orders = await collections.addFolder(collection.id, 'Orders');
    await collections.addFolder(collection.id, 'Users');
    await collections.addRequestReference(collection.id, 'r1', 'Login', 'GET', '/login');
    const stored = collections.collections[0];
    stored.folders.forEach(folder => { delete folder.order; });
    stored.requests.forEach(request => { delete request.order; });
    // 没有 order 时文件夹在前、请求在后
    expect(shape(collection.id)).toEqual([['Orders', []], ['Users', []], 'Login']);

    await collections.reorderFolder(collection.id, orders.id, 'down');
    expect(shape(collection.id)).toEqual([['Users', []], ['Orders', []], 'Login']);
    await collections.reorderFolder(collection.id, orders.id, 'down');
    expect(shape(collection.id)).toEqual([['Users', []], 'Login', ['Orders', []]]);
  });
});
