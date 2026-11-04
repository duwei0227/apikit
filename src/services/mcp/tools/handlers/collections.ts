// 集合和文件夹

import { useCollectionsStore } from '@/stores/collections';
import type { Collection, Folder, RequestReference } from '@/types/models';
import { useRequestsStore } from '@/stores/requests';
import { notifyItemDeleted } from '@/composables/useDeletedItems';
import { collectAllRequestIds, findFolderPath } from '@/utils/collectionTree';
import { findFolder, findWorkflowsReferencing, locateRequest, requireCollection } from '../lookups';
import { confirmOrThrow, fail, optionalPositiveInteger, optionalString, parseView, requireString } from '../shared';
import { fuzzyFilter, fuzzyScore } from '@/utils/fuzzyMatch';
import { DEFAULT_SEARCH_LIMIT, HTTP_METHODS, MAX_SEARCH_LIMIT, type McpToolHandler } from '../types';
import { searchRequestReferences } from '@/utils/collectionTree';

/** 同层级的文件夹与请求按 order 合并排序；缺少 order 时文件夹在前 */
type ContainerItem =
  | { type: 'folder'; id: string; name: string; items: ContainerItem[] }
  | { type: 'request'; id: string; name: string; method: string; url: string };

interface SummaryNode {
  id: string;
  name: string;
  /** 包含子文件夹中的请求 */
  requestCount: number;
  folders?: SummaryNode[];
  /** 超出 depth 未列出的子文件夹数 */
  folderCount?: number;
  /** 有 query 时列出名称、URL 或路径命中的请求 */
  requests?: Array<{ id: string; name: string; method: string }>;
}

interface TreeFilter {
  query: string;
  depth?: number;
}

const countRequests = (container: Collection | Folder): number => container.requests.length
  + (container.folders || []).reduce((total, folder) => total + countRequests(folder), 0);

const orderedFolders = (container: Collection | Folder) => (container.folders || [])
  .map((folder, index) => ({ folder, sortKey: folder.order ?? index }))
  .sort((a, b) => a.sortKey - b.sortKey)
  .map(entry => entry.folder);

const containerMatches = (container: Collection | Folder, path: string[], query: string) => (
  !query || fuzzyScore({ name: container.name, path: path.join(' / ') }, query) !== null
);

const requestMatches = (ref: RequestReference, path: string[], query: string) => (
  fuzzyScore({ name: ref.name, path: path.join(' / '), extra: [ref.url] }, query) !== null
);

/** 精简的目录树：有 query 时只保留命中的节点和它们的上级；命中的集合或文件夹保留整个子树 */
function summarizeContainer(container: Collection | Folder, path: string[], level: number, filter: TreeFilter, includeAll: boolean): SummaryNode | null {
  const matched = includeAll || containerMatches(container, path, filter.query);
  const folders = orderedFolders(container)
    .map(folder => summarizeContainer(folder, [...path, folder.name], level + 1, filter, matched))
    .filter((node): node is SummaryNode => node !== null);
  const requests = filter.query && !matched ? container.requests.filter(ref => requestMatches(ref, path, filter.query)) : [];
  if (!matched && folders.length === 0 && requests.length === 0) return null;

  const node: SummaryNode = { id: container.id, name: container.name, requestCount: countRequests(container) };
  // 有 query 时命中项总是列出，depth 只在浏览整棵树时限制层级
  const withinDepth = Boolean(filter.query) || filter.depth === undefined || level < filter.depth;
  if (withinDepth && folders.length > 0) node.folders = folders;
  if (!withinDepth && folders.length > 0) node.folderCount = folders.length;
  if (requests.length > 0) node.requests = requests.map(ref => ({ id: ref.id, name: ref.name, method: ref.method }));
  return node;
}

/** 完整内容：文件夹与请求按显示顺序；有 query 时过滤方式与精简树相同 */
function describeContainer(container: Collection | Folder, path: string[], filter: TreeFilter, includeAll: boolean): ContainerItem[] {
  const entries: Array<{ sortKey: number; item: ContainerItem }> = [];
  (container.folders || []).forEach((folder, index) => {
    const folderPath = [...path, folder.name];
    const matched = includeAll || (Boolean(filter.query) && containerMatches(folder, folderPath, filter.query));
    const items = describeContainer(folder, folderPath, filter, matched);
    if (filter.query && !matched && items.length === 0) return;
    entries.push({ sortKey: folder.order ?? (-1e9 + index), item: { type: 'folder', id: folder.id, name: folder.name, items } });
  });
  container.requests.forEach((ref, index) => {
    if (filter.query && !includeAll && !requestMatches(ref, path, filter.query)) return;
    entries.push({ sortKey: ref.order ?? (1e9 + index), item: { type: 'request', id: ref.id, name: ref.name, method: ref.method, url: ref.url } });
  });
  return entries.sort((a, b) => a.sortKey - b.sortKey).map(entry => entry.item);
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** 删除确认框中的说明：引用这些请求的 Workflow 会失去对应步骤的请求 */
function deletionNote(what: string, affectedWorkflows: Array<{ name: string }>) {
  const usedBy = affectedWorkflows.length > 0
    ? ` Workflows that use these requests: ${affectedWorkflows.map(workflow => workflow.name).join(', ')}.`
    : '';
  return `${what} This cannot be undone.${usedBy}`;
}

/** 删除请求后关闭打开的页签 */
function closeDeletedRequests(requestIds: string[]) {
  requestIds.forEach(requestId => notifyItemDeleted('request', requestId));
}

function describeLocation(located: ReturnType<typeof locateRequest>) {
  return {
    requestId: located.request.id,
    name: located.request.name,
    collectionId: located.collectionId,
    folderId: located.folderId,
    path: located.path.join(' / '),
  };
}

export const collectionHandlers: Record<string, McpToolHandler> = {
  async list_collections(args) {
    const view = parseView(args.view, 'summary');
    const filter: TreeFilter = {
      query: optionalString(args.query, 'query')?.trim() ?? '',
      depth: optionalPositiveInteger(args.depth, 'depth'),
    };
    const collectionId = optionalString(args.collectionId, 'collectionId');
    const collections = collectionId ? [requireCollection(collectionId)] : useCollectionsStore().collections;
    if (view === 'summary') {
      return {
        collections: collections
          .map(collection => summarizeContainer(collection, [collection.name], 0, filter, false))
          .filter((node): node is SummaryNode => node !== null),
      };
    }
    return {
      collections: collections.flatMap(collection => {
        const matched = !filter.query || containerMatches(collection, [collection.name], filter.query);
        const items = describeContainer(collection, [collection.name], filter, matched && Boolean(filter.query));
        if (filter.query && !matched && items.length === 0) return [];
        return [{ id: collection.id, name: collection.name, description: collection.description || undefined, items }];
      }),
    };
  },

  async search_requests(args) {
    const query = optionalString(args.query, 'query')?.trim() ?? '';
    const method = optionalString(args.method, 'method')?.trim().toUpperCase();
    const collectionId = optionalString(args.collectionId, 'collectionId');
    const view = parseView(args.view, 'summary');
    if (!query && !method && !collectionId) fail('Pass query, method and/or collectionId');
    if (method && !HTTP_METHODS.includes(method as typeof HTTP_METHODS[number])) {
      fail(`method must be one of ${HTTP_METHODS.join(', ')}`);
    }
    const limit = args.limit === undefined ? DEFAULT_SEARCH_LIMIT : Number(args.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) fail(`limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}`);

    const collections = collectionId ? [requireCollection(collectionId)] : useCollectionsStore().collections;
    const all = searchRequestReferences(collections, '')
      .filter(match => !method || match.request.method.toUpperCase() === method);
    const matches = query
      ? fuzzyFilter(all, query, match => ({ name: match.request.name, path: match.path.join(' / '), extra: [match.request.url] })).map(entry => entry.item)
      : all;
    return {
      total: matches.length,
      requests: matches.slice(0, limit).map(match => (view === 'summary'
        ? { requestId: match.request.id, name: match.request.name, method: match.request.method, path: match.path.join(' / ') }
        : {
          requestId: match.request.id,
          name: match.request.name,
          method: match.request.method,
          url: match.request.url,
          collectionId: match.collectionId,
          folderId: match.folderId,
          path: match.path.join(' / '),
        })),
    };
  },

  async update_collection(args) {
    const collection = requireCollection(requireString(args, 'collectionId'));
    if (args.name === undefined && args.description === undefined) fail('Pass name and/or description');
    const updates: { name?: string; description?: string } = {};
    if (args.name !== undefined) updates.name = requireString(args, 'name');
    if (args.description !== undefined) updates.description = optionalString(args.description, 'description') ?? '';
    await useCollectionsStore().updateCollection(collection.id, updates);
    const saved = requireCollection(collection.id);
    return { id: saved.id, name: saved.name, description: saved.description || undefined };
  },

  async update_folder(args) {
    const collection = requireCollection(requireString(args, 'collectionId'));
    const folderId = requireString(args, 'folderId');
    if (!findFolder(collection.folders, folderId)) fail(`Folder not found: ${folderId}`);
    const name = requireString(args, 'name');
    await useCollectionsStore().updateFolder(collection.id, folderId, { name });
    return { id: folderId, name, collectionId: collection.id };
  },

  async delete_request(args, context) {
    const located = locateRequest(requireString(args, 'requestId'));
    const { request } = located;
    const affectedWorkflows = findWorkflowsReferencing([request.id]);
    await confirmOrThrow(context, {
      tool: 'delete_request',
      title: 'AI wants to delete a request',
      detail: `${request.method} ${request.name} · ${located.path.join(' / ')}`,
      note: deletionNote('The request and its unsaved edits are deleted.', affectedWorkflows),
      destructive: true,
    });
    await useCollectionsStore().removeRequestReference(located.collectionId, request.id);
    await useRequestsStore().deleteRequest(request.id);
    closeDeletedRequests([request.id]);
    return { deleted: { requestId: request.id, name: request.name }, affectedWorkflows };
  },

  async delete_folder(args, context) {
    const collection = requireCollection(requireString(args, 'collectionId'));
    const folderId = requireString(args, 'folderId');
    const folder = findFolder(collection.folders, folderId) || fail(`Folder not found: ${folderId}`);
    const requestIds = collectAllRequestIds(folder);
    const affectedWorkflows = findWorkflowsReferencing(requestIds);
    const folderNames = (findFolderPath(collection.folders, folderId) || []).map(id => findFolder(collection.folders, id)?.name || id);
    const path = [collection.name, ...folderNames].join(' / ');
    await confirmOrThrow(context, {
      tool: 'delete_folder',
      title: 'AI wants to delete a folder',
      detail: `${path} · ${plural(requestIds.length, 'request')}`,
      note: deletionNote('The folder, its subfolders and all requests in them are deleted.', affectedWorkflows),
      destructive: true,
    });
    await useCollectionsStore().deleteFolder(collection.id, folderId);
    closeDeletedRequests(requestIds);
    return { deleted: { folderId, name: folder.name }, deletedRequestCount: requestIds.length, affectedWorkflows };
  },

  async delete_collection(args, context) {
    const collection = requireCollection(requireString(args, 'collectionId'));
    const requestIds = collectAllRequestIds(collection);
    const affectedWorkflows = findWorkflowsReferencing(requestIds);
    await confirmOrThrow(context, {
      tool: 'delete_collection',
      title: 'AI wants to delete a collection',
      detail: `${collection.name} · ${plural(requestIds.length, 'request')}`,
      note: deletionNote('The collection with all its folders and requests is deleted.', affectedWorkflows),
      destructive: true,
    });
    await useCollectionsStore().deleteCollection(collection.id);
    closeDeletedRequests(requestIds);
    return { deleted: { collectionId: collection.id, name: collection.name }, deletedRequestCount: requestIds.length, affectedWorkflows };
  },

  async move_request(args) {
    const located = locateRequest(requireString(args, 'requestId'));
    const target = requireCollection(requireString(args, 'collectionId'));
    const folderId = optionalString(args.folderId, 'folderId');
    if (folderId && !findFolder(target.folders, folderId)) fail(`Folder not found: ${folderId}`);
    if (located.collectionId !== target.id || (located.folderId || undefined) !== (folderId || undefined)) {
      await useCollectionsStore().moveRequest(located.collectionId, located.request.id, target.id, folderId);
    }
    return { ...describeLocation(locateRequest(located.request.id)) };
  },

  async create_collection(args) {
    const name = requireString(args, 'name');
    const collection = await useCollectionsStore().createCollection(name, optionalString(args.description, 'description'));
    return { id: collection.id, name: collection.name };
  },

  async create_folder(args) {
    const collection = requireCollection(requireString(args, 'collectionId'));
    const name = requireString(args, 'name');
    const parentFolderId = optionalString(args.parentFolderId, 'parentFolderId');
    if (parentFolderId && !findFolder(collection.folders, parentFolderId)) fail(`Folder not found: ${parentFolderId}`);
    const folder = await useCollectionsStore().addFolder(collection.id, name, parentFolderId);
    return { id: folder.id, name: folder.name, collectionId: collection.id };
  },
};
