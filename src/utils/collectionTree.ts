// 集合树：Tree 节点的构建、查找和复制用的纯函数，不依赖 store 和界面（拖放见 treeDrop.ts）

import { cloneJson } from '@/utils/clone';
import { generateId } from '@/utils/id-generator';
import type { Collection, Folder, RequestReference } from '@/types/models';

/** 树节点的数据：集合、文件夹或请求引用，type 区分种类 */
export type CollectionTreeNodeData =
  | (Collection & { type: 'collection' })
  | (Folder & { type: 'folder' })
  | (RequestReference & { type: 'request' });

export interface CollectionTreeNode {
  key: string;
  label: string;
  data: CollectionTreeNodeData;
  icon?: string;
  children: CollectionTreeNode[];
}

/** 集合或文件夹；请求只有引用（id、name、method、url） */
interface TreeContainer {
  id: string;
  name: string;
  description?: string;
  order?: number;
  requests?: RequestReference[];
  folders?: TreeContainer[];
}

/** 请求的名称或 URL 包含搜索词（不区分大小写）；搜索词为空时都匹配 */
export function requestMatchesSearch(request: { name?: string; url?: string }, searchQuery: string): boolean {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return true;
  return (request.name || '').toLowerCase().includes(query) || (request.url || '').toLowerCase().includes(query);
}

export interface RequestSearchResult {
  request: RequestReference;
  collectionId: string;
  collectionName: string;
  /** 所在文件夹，直接在集合下时为 undefined */
  folderId?: string;
  /** 从集合到所在文件夹的名称 */
  path: string[];
}

/** 按 id 查找请求引用（含名称、方法和 URL）；找不到时为 null */
export function findRequestReference(containers: TreeContainer[], requestId: string): RequestReference | null {
  for (const container of containers) {
    const found = (container.requests || []).find(request => request.id === requestId)
      || findRequestReference(container.folders || [], requestId);
    if (found) return found;
  }
  return null;
}

/** 名称或 URL 包含搜索词的请求，按集合树的显示顺序 */
export function searchRequestReferences(collections: TreeContainer[], searchQuery: string): RequestSearchResult[] {
  const results: RequestSearchResult[] = [];
  const visit = (node: CollectionTreeNode, collection: TreeContainer, path: string[], folderId?: string) => {
    for (const child of node.children) {
      if (child.data.type === 'request') {
        if (requestMatchesSearch(child.data, searchQuery)) {
          const { type: _type, ...request } = child.data;
          results.push({ request, collectionId: collection.id, collectionName: collection.name, folderId, path });
        }
      } else {
        visit(child, collection, [...path, child.label], child.data.id);
      }
    }
  };
  buildCollectionTree(collections).forEach((node, index) => visit(node, collections[index], [collections[index].name]));
  return results;
}

/** 集合转为 Tree 节点，key 形如 collection/<cid>/<fid>/request/<rid>；有搜索词时只保留匹配的节点和它们的上级 */
export function buildCollectionTree(collections: TreeContainer[], searchQuery = ''): CollectionTreeNode[] {
  const convertToTreeNode = (item: TreeContainer, type: 'collection' | 'folder' = 'collection', parentKey = ''): CollectionTreeNode => {
    const key = parentKey ? `${parentKey}/${item.id}` : `${type}/${item.id}`;

    const node: CollectionTreeNode = {
      key,
      label: item.name,
      data: { ...item, type } as CollectionTreeNodeData,
      icon: type === 'collection' ? 'pi pi-folder' : 'pi pi-folder-open',
      children: []
    };

    // 合并同层级的 requests 与 folders，按 order 交错排序。
    const requests = item.requests || [];
    const folders = item.folders || [];

    const entries: Array<{ order?: number; idx: number; kind: 'request' | 'folder'; node: CollectionTreeNode }> = [
      ...requests.map((req, idx) => ({
        order: req.order,
        idx,
        kind: 'request' as const,
        node: {
          key: `${key}/request/${req.id}`,
          label: req.name,
          data: { ...req, type: 'request' as const },
          icon: 'pi pi-file',
          children: []
        }
      })),
      ...folders.map((folder, idx) => ({
        order: folder.order,
        idx,
        kind: 'folder' as const,
        node: convertToTreeNode(folder, 'folder', key)
      }))
    ];

    // 当且仅当所有子项都带 order 时按 order 排序；否则回退到「folders 在前、requests 在后」。
    const allOrdered = entries.length > 0 && entries.every(e => typeof e.order === 'number');
    if (allOrdered) {
      entries.sort((a, b) => a.order! - b.order!);
    } else {
      entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
        return a.idx - b.idx;
      });
    }

    node.children = entries.map(e => e.node);

    return node;
  };

  const allNodes = collections.map(c => convertToTreeNode(c));

  if (!searchQuery) {
    return allNodes;
  }

  const matchesSearch = (node: CollectionTreeNode) => {
    if (node.data?.type === 'request') return requestMatchesSearch(node.data, searchQuery);
    return (node.label || '').toLowerCase().includes(searchQuery.trim().toLowerCase());
  };

  const filterNode = (node: CollectionTreeNode): CollectionTreeNode | null => {
    if (matchesSearch(node)) return node;
    if (node.children && node.children.length > 0) {
      const matched = node.children.map(filterNode).filter((child): child is CollectionTreeNode => Boolean(child));
      if (matched.length > 0) return { ...node, children: matched };
    }
    return null;
  };

  return allNodes.map(filterNode).filter((node): node is CollectionTreeNode => Boolean(node));
}

export function findNodeByKey(nodes: CollectionTreeNode[], key: string): CollectionTreeNode | null {
  for (const node of nodes) {
    if (node.key === key) return node;
    if (node.children && node.children.length > 0) {
      const found = findNodeByKey(node.children, key);
      if (found) return found;
    }
  }
  return null;
}

export function findFolderById<T extends TreeContainer>(folders: T[], targetId: string): T | null {
  for (const folder of folders) {
    if (folder.id === targetId) return folder;
    if (folder.folders && folder.folders.length > 0) {
      const found = findFolderById(folder.folders as T[], targetId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 同一位置（集合根目录或某个文件夹）中是否已有同名请求（不区分大小写），
 * excludeRequestId 为正在重命名或保存的请求自己。
 */
export function isRequestNameTaken(
  collections: TreeContainer[],
  collectionId: string,
  folderId: string | null | undefined,
  requestName: string,
  excludeRequestId: string | null = null,
): boolean {
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return false;
  const requests: Array<{ id: string; name: string }> = folderId
    ? findFolderById(collection.folders || [], folderId)?.requests || []
    : collection.requests || [];
  const name = requestName.toLowerCase();
  return requests.some(req => req.name.toLowerCase() === name && req.id !== excludeRequestId);
}

/** 按文件夹 id 路径逐层查找 */
export function findFolderByPath(folders: TreeContainer[], folderIds: string[]): TreeContainer | null {
  if (!folderIds || folderIds.length === 0) return null;
  const folder = folders.find(f => f.id === folderIds[0]);
  if (!folder) return null;
  if (folderIds.length === 1) return folder;
  return findFolderByPath(folder.folders || [], folderIds.slice(1));
}

/** 文件夹从根开始的 id 路径 */
export function findFolderPath(folders: TreeContainer[], targetId: string, currentPath: string[] = []): string[] | null {
  for (const folder of folders) {
    const path = [...currentPath, folder.id];
    if (folder.id === targetId) {
      return path;
    }
    if (folder.folders && folder.folders.length > 0) {
      const found = findFolderPath(folder.folders, targetId, path);
      if (found) return found;
    }
  }
  return null;
}

export function findFolderInCollection(collection: TreeContainer | null | undefined, folderId: string): boolean {
  const search = (folders: TreeContainer[]): boolean => {
    for (const folder of folders) {
      if (folder.id === folderId) return true;
      if (folder.folders && search(folder.folders)) return true;
    }
    return false;
  };
  return collection ? search(collection.folders || []) : false;
}

/** 与指定文件夹同级的文件夹（含它自己） */
export function findSiblingFolders(collection: TreeContainer, folderId: string): TreeContainer[] {
  const search = (folders: TreeContainer[]): TreeContainer[] | null => {
    for (const folder of folders) {
      if (folder.id === folderId) return folders;
      if (folder.folders && folder.folders.length > 0) {
        const found = search(folder.folders);
        if (found) return found;
      }
    }
    return null;
  };
  return search(collection.folders || []) || [];
}

export function collectAllRequestIds(item: TreeContainer): string[] {
  const ids: string[] = [];
  if (item.requests && Array.isArray(item.requests)) {
    ids.push(...item.requests.map(r => r.id));
  }
  if (item.folders && Array.isArray(item.folders)) {
    for (const folder of item.folders) {
      ids.push(...collectAllRequestIds(folder));
    }
  }
  return ids;
}

/** 复制时旧 id 到新 id 的映射，用来给复制出的请求找到所属文件夹 */
export interface CopyIdMaps {
  folderIdMap: Map<string, string>;
  requestIdMap: Map<string, string>;
}

export const createCopyIdMaps = (): CopyIdMaps => ({ folderIdMap: new Map(), requestIdMap: new Map() });

/** 复制请求引用，生成新的请求 id */
export function copyRequestRefs(requests: RequestReference[], maps: CopyIdMaps): RequestReference[] {
  return requests.map(req => {
    const newRequestId = generateId();
    maps.requestIdMap.set(req.id, newRequestId);
    return {
      id: newRequestId,
      name: req.name,
      method: req.method,
      url: req.url,
      // 保留与同级文件夹交错的显示顺序
      ...(req.order === undefined ? {} : { order: req.order }),
    };
  });
}

/** 复制文件夹结构（含子文件夹和请求引用），nameSuffix 加在每个复制出的文件夹名后面 */
export function copyFolderStructure(folder: Folder, maps: CopyIdMaps, nameSuffix = ''): Folder {
  const newFolderId = generateId();
  maps.folderIdMap.set(folder.id, newFolderId);

  return {
    id: newFolderId,
    name: `${folder.name}${nameSuffix}`,
    ...(folder.description === undefined ? {} : { description: folder.description }),
    ...(folder.order === undefined ? {} : { order: folder.order }),
    folders: folder.folders ? folder.folders.map(f => copyFolderStructure(f, maps, nameSuffix)) : [],
    requests: folder.requests ? copyRequestRefs(folder.requests, maps) : []
  };
}

/** 复制请求的完整数据：深拷贝后套用新的字段，去掉以 _ 开头的临时属性 */
export function copyRequestData<T extends object>(request: T, overrides: Partial<T>): T {
  const now = new Date().toISOString();
  const newRequest: Record<string, unknown> = {
    ...cloneJson(request),
    ...overrides,
    createdAt: now,
    updatedAt: now
  };
  Object.keys(newRequest).forEach(key => {
    if (key.startsWith('_')) {
      delete newRequest[key];
    }
  });
  return newRequest as T;
}
