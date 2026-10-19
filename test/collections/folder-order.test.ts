import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCollectionsStore } from '@/stores/collections';
import { buildCollectionTree, type CollectionTreeNode } from '@/utils/collectionTree';
import type { Collection, Folder } from '@/types/models';

// 新建文件夹放在同层其他文件夹之后、request 之前；同层交错时紧跟最后一个文件夹
describe('position of a new folder in a collection', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const labels = (nodes: CollectionTreeNode[]): unknown[] => nodes.map(node => (
    node.children && node.children.length > 0 ? [node.label, labels(node.children)] : node.label
  ));
  const tree = () => labels(buildCollectionTree(useCollectionsStore().collections));
  const addRequest = (collectionId: string, name: string, folderId?: string) =>
    useCollectionsStore().addRequestReference(collectionId, `req-${name}`, name, 'GET', `https://example.com/${name}`, folderId);

  it('COL-FOLDER-001 puts a new folder after the other folders and before the requests', async () => {
    const collections = useCollectionsStore();
    const collection = await collections.createCollection('Shop');
    await addRequest(collection.id, 'A');
    await collections.addFolder(collection.id, 'F1');
    await addRequest(collection.id, 'B');
    await collections.addFolder(collection.id, 'F2');

    expect(tree()).toEqual([['Shop', ['F1', 'F2', 'A', 'B']]]);
  });

  it('COL-FOLDER-002 follows the last folder when folders and requests are interleaved', async () => {
    const collections = useCollectionsStore();
    const collection = await collections.createCollection('Shop');
    await collections.addFolder(collection.id, 'F1');
    await addRequest(collection.id, 'A');
    await collections.addFolder(collection.id, 'F2');
    await addRequest(collection.id, 'B');
    // 模拟拖动后的交错顺序：F1、A、F2、B
    const shop = collections.collections[0] as Collection;
    const order: Record<string, number> = { F1: 0, A: 1, F2: 2, B: 3 };
    [...shop.folders, ...shop.requests].forEach(item => { item.order = order[item.name]; });
    expect(tree()).toEqual([['Shop', ['F1', 'A', 'F2', 'B']]]);

    await collections.addFolder(collection.id, 'New');
    expect(tree()).toEqual([['Shop', ['F1', 'A', 'F2', 'New', 'B']]]);
  });

  it('COL-FOLDER-003 applies the same rule inside a folder and in collections without order', async () => {
    const collections = useCollectionsStore();
    const collection = await collections.createCollection('Shop');
    const parent = await collections.addFolder(collection.id, 'Orders');
    await addRequest(collection.id, 'A', parent.id);
    await collections.addFolder(collection.id, 'Sub', parent.id);
    expect(tree()).toEqual([['Shop', [['Orders', ['Sub', 'A']]]]]);

    // 旧集合的子项没有 order：显示为 folders 在前，新文件夹排在它们之后
    const shop = collections.collections[0] as Collection;
    const orders: Folder = shop.folders[0];
    [...orders.folders, ...orders.requests].forEach(item => { delete item.order; });
    await collections.addFolder(collection.id, 'Sub2', parent.id);
    expect(tree()).toEqual([['Shop', [['Orders', ['Sub', 'Sub2', 'A']]]]]);
  });
});
