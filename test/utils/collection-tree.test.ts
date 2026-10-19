import { describe, expect, it } from 'vitest';
import {
  buildCollectionTree,
  collectAllRequestIds,
  copyFolderStructure,
  copyRequestData,
  copyRequestRefs,
  createCopyIdMaps,
  findFolderByPath,
  findFolderPath,
  findNodeByKey,
  findSiblingFolders,
  isRequestNameTaken,
  resolveSaveLocation,
  searchRequestReferences,
} from '@/utils/collectionTree';
import { collectExpandableKeys, computeDropResult, findNodeByIndexPath } from '@/utils/treeDrop';

const ref = (id: string, extra: Record<string, any> = {}) => ({ id, name: `Request ${id}`, method: 'GET' as const, url: `https://example.com/${id}`, ...extra });

const collection = {
  id: 'c1',
  name: 'Shop',
  requests: [ref('r1'), ref('r2')],
  folders: [
    {
      id: 'f1',
      name: 'Orders',
      requests: [ref('r3', { url: 'https://example.com/orders/search' })],
      folders: [{ id: 'f2', name: 'Archive', requests: [ref('r4')], folders: [] }],
    },
  ],
};

describe('collection tree', () => {
  it('TREE-001 builds keys and puts folders first when items have no order', () => {
    const [root] = buildCollectionTree([collection]);
    expect(root.key).toBe('collection/c1');
    expect(root.children.map(node => node.key)).toEqual([
      'collection/c1/f1',
      'collection/c1/request/r1',
      'collection/c1/request/r2',
    ]);
    expect(findNodeByKey([root], 'collection/c1/f1/f2/request/r4')?.label).toBe('Request r4');
  });

  it('TREE-002 interleaves folders and requests by order when every item has one', () => {
    const ordered = {
      ...collection,
      requests: [ref('r1', { order: 0 }), ref('r2', { order: 2 })],
      folders: [{ ...collection.folders[0], order: 1 }],
    };
    const [root] = buildCollectionTree([ordered]);
    expect(root.children.map(node => node.data.id)).toEqual(['r1', 'f1', 'r2']);
  });

  it('TREE-003 filters by name or URL and keeps the parents of matches', () => {
    const [root] = buildCollectionTree([collection], 'orders/search');
    expect(root.children.map(node => node.key)).toEqual(['collection/c1/f1']);
    expect(root.children[0].children.map(node => node.data.id)).toEqual(['r3']);
    expect(buildCollectionTree([collection], 'nothing matches')).toEqual([]);
    expect(Object.keys(collectExpandableKeys([root]))).toEqual(['collection/c1', 'collection/c1/f1']);
  });

  it('TREE-004 finds folders, paths, siblings and nested request ids', () => {
    expect(findFolderByPath(collection.folders, ['f1', 'f2'])?.name).toBe('Archive');
    expect(findFolderPath(collection.folders, 'f2')).toEqual(['f1', 'f2']);
    expect(findSiblingFolders(collection, 'f2').map(folder => folder.id)).toEqual(['f2']);
    expect(collectAllRequestIds(collection)).toEqual(['r1', 'r2', 'r3', 'r4']);
    const tree = buildCollectionTree([collection]);
    expect(findNodeByIndexPath(tree, [0, 0, 0])?.key).toBe('collection/c1/f1/f2');
    expect(findNodeByIndexPath(tree, [0, 9])).toBeNull();
  });

  it('TREE-005 computes drops before, after and inside a node without changing the original tree', () => {
    const tree = buildCollectionTree([collection]);
    const after = computeDropResult(tree, 'collection/c1/request/r1', 'collection/c1/request/r2', 'after');
    expect(after![0].children.map(node => node.data.id)).toEqual(['f1', 'r2', 'r1']);
    const inside = computeDropResult(tree, 'collection/c1/request/r2', 'collection/c1/f1', 'inside');
    expect(inside![0].children[0].children.map(node => node.data.id)).toEqual(['f2', 'r3', 'r2']);
    expect(tree[0].children.map(node => node.data.id)).toEqual(['f1', 'r1', 'r2']);
    // 不能放到自己或自己的子节点上
    expect(computeDropResult(tree, 'collection/c1/f1', 'collection/c1/f1/f2', 'inside')).toBeNull();
  });

  it('TREE-006 copies folder structures with new ids and records the id mapping', () => {
    const maps = createCopyIdMaps();
    const copy = copyFolderStructure(collection.folders[0], maps, ' (Copy)');
    expect(copy.name).toBe('Orders (Copy)');
    expect(copy.folders![0].name).toBe('Archive (Copy)');
    expect(copy.id).not.toBe('f1');
    expect(maps.folderIdMap.get('f2')).toBe(copy.folders![0].id);
    expect(maps.requestIdMap.get('r4')).toBe(copy.folders![0].requests![0].id);
    expect(copy.requests![0]).toEqual({ id: maps.requestIdMap.get('r3'), name: 'Request r3', method: 'GET', url: 'https://example.com/orders/search' });

    // 复制时保留显示顺序和说明：拖动排序后复制的文件夹与原来的顺序一致
    const refs = copyRequestRefs([ref('r1', { order: 3 }), ref('r2')], maps);
    expect(refs[0].order).toBe(3);
    expect(refs[1]).not.toHaveProperty('order');
    const ordered = copyFolderStructure({
      id: 'f9', name: 'Mixed', description: 'notes', order: 2,
      requests: [ref('r8', { order: 0 })],
      folders: [{ id: 'f10', name: 'Sub', order: 1, requests: [], folders: [] }],
    }, maps);
    expect(ordered).toMatchObject({ description: 'notes', order: 2, requests: [{ order: 0 }], folders: [{ order: 1 }] });
  });

  it('TREE-007 copies request data deeply and drops temporary fields', () => {
    const request = { id: 'r1', name: 'A', headers: [{ key: 'X', value: '1' }], _draft: true, createdAt: 'old' };
    const copy = copyRequestData(request, { id: 'r9', name: 'A (Copy)' });
    expect(copy).toMatchObject({ id: 'r9', name: 'A (Copy)' });
    expect(copy).not.toHaveProperty('_draft');
    expect(copy.createdAt).not.toBe('old');
    copy.headers[0].value = '2';
    expect(request.headers[0].value).toBe('1');
  });

  it('TREE-008 checks request names within the same location only, ignoring case', () => {
    expect(isRequestNameTaken([collection], 'c1', null, 'request R1')).toBe(true);
    // 正在重命名的请求自己不算重名
    expect(isRequestNameTaken([collection], 'c1', null, 'Request r1', 'r1')).toBe(false);
    // 不同位置的同名请求不算重名
    expect(isRequestNameTaken([collection], 'c1', null, 'Request r3')).toBe(false);
    expect(isRequestNameTaken([collection], 'c1', 'f1', 'Request r3')).toBe(true);
    expect(isRequestNameTaken([collection], 'c1', 'f2', 'Request r4')).toBe(true);
    expect(isRequestNameTaken([collection], 'missing', null, 'Request r1')).toBe(false);
  });

  it('searches requests by name or URL in display order with their folder path', () => {
    const other = { id: 'c2', name: 'Admin', requests: [ref('r5', { name: 'Orders report' })], folders: [] };
    const results = searchRequestReferences([collection, other], ' ORDERS ');
    expect(results.map(result => [result.request.id, result.path.join('/'), result.folderId])).toEqual([
      ['r3', 'Shop/Orders', 'f1'],
      ['r5', 'Admin', undefined],
    ]);
    expect(results[0].request).toEqual(ref('r3', { url: 'https://example.com/orders/search' }));
    expect(results[0]).toMatchObject({ collectionId: 'c1', collectionName: 'Shop' });

    // 文件夹名匹配不会带出其中的请求；空搜索词返回全部
    expect(searchRequestReferences([collection], 'archive')).toEqual([]);
    expect(searchRequestReferences([collection], '').map(result => result.request.id)).toEqual(['r4', 'r3', 'r1', 'r2']);
  });
});

describe('resolveSaveLocation', () => {
  const folder = (id: string, folders: any[] = []) => ({ id, name: `Folder ${id}`, folders, requests: [] });
  const collection = (id: string, folders: any[] = []) => ({ id, name: `Collection ${id}`, folders, requests: [], createdAt: '', updatedAt: '' });
  const shop = collection('c1', [folder('f1', [folder('f2')])]);
  const archive = collection('c2');

  it('上次保存的位置仍存在时选中它（含嵌套文件夹）', () => {
    const location = resolveSaveLocation([shop, archive], { collectionId: 'c1', folderId: 'f2' });
    expect(location?.collection.id).toBe('c1');
    expect(location?.folder?.id).toBe('f2');
    expect(resolveSaveLocation([shop, archive], { collectionId: 'c2', folderId: null })).toEqual({ collection: archive, folder: null });
  });

  it('文件夹已删除时退回到集合根目录，集合已删除时按集合数量决定', () => {
    expect(resolveSaveLocation([shop, archive], { collectionId: 'c1', folderId: 'gone' })).toEqual({ collection: shop, folder: null });
    expect(resolveSaveLocation([shop, archive], { collectionId: 'gone', folderId: null })).toBeNull();
    expect(resolveSaveLocation([archive], { collectionId: 'gone', folderId: null })).toEqual({ collection: archive, folder: null });
  });

  it('没有上次的位置时，只有一个集合则选中它', () => {
    expect(resolveSaveLocation([shop], null)).toEqual({ collection: shop, folder: null });
    expect(resolveSaveLocation([shop, archive], undefined)).toBeNull();
    expect(resolveSaveLocation([], null)).toBeNull();
  });
});
