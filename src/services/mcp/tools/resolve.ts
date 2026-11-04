// 按名称或路径定位集合、文件夹、请求和 Workflow：完全同名只有一个时直接使用，
// 匹配到多个时请用户选择（在 AI 工具里询问，没法询问时返回候选，由 AI 去问）。

import { useCollectionsStore } from '@/stores/collections';
import { useWorkflowsStore } from '@/stores/workflows';
import type { Collection, Folder, WorkflowDefinition } from '@/types/models';
import { searchRequestReferences, type RequestSearchResult } from '@/utils/collectionTree';
import { listWorkflowPlacements } from '@/utils/workflowTree';
import { type FuzzyTarget, nearestMatches, resolveByName } from '@/utils/fuzzyMatch';
import { findFolder, locateRequest, requireCollection, requireWorkflow } from './lookups';
import { fail, isRecord, optionalString } from './shared';
import { McpAmbiguityError, type McpToolContext } from './types';

/** 一次最多列出的候选 */
export const MAX_CANDIDATES = 10;
const MAX_NEAREST = 5;

/** 按名称模糊匹配到的项，结果里告诉 AI 实际用的是哪一个 */
export interface ResolvedName {
  field: string;
  input: string;
  matched: string;
}

export interface Resolver {
  context: McpToolContext;
  tool: string;
  resolved: ResolvedName[];
}

export const createResolver = (context: McpToolContext, tool: string): Resolver => ({ context, tool, resolved: [] });

/** 结果里附带的模糊匹配说明；没有时不带这个字段 */
export const resolvedNotes = (resolver: Resolver) => (resolver.resolved.length > 0 ? { resolved: resolver.resolved } : {});

interface Candidate<T> {
  item: T;
  id: string;
  label: string;
}

/** 显示文字相同时加上序号，保证每项可区分 */
function uniqueLabels(labels: string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map(label => {
    const count = (seen.get(label) || 0) + 1;
    seen.set(label, count);
    return count === 1 ? label : `${label} (${count})`;
  });
}

const CREATE = Symbol('create');

async function choose<T>(
  resolver: Resolver,
  field: string,
  what: string,
  input: string,
  candidates: Array<Candidate<T>>,
  createLabel?: string,
): Promise<T | typeof CREATE> {
  const shown = candidates.slice(0, MAX_CANDIDATES);
  const options = uniqueLabels([...shown.map(candidate => candidate.label), ...(createLabel ? [createLabel] : [])]);
  const message = createLabel && shown.length === 1
    ? `A ${what} similar to "${input}" exists.`
    : `Several ${what}s match "${input}".`;
  const answer = resolver.context.choose
    ? await resolver.context.choose({ tool: resolver.tool, message, options })
    : null;
  if (answer === 'cancel') fail('The user cancelled the selection. Nothing was changed.');
  if (answer === null) {
    throw new McpAmbiguityError({
      field,
      input,
      candidates: shown.map(candidate => ({ id: candidate.id, name: candidate.label })),
      ...(candidates.length > shown.length ? { total: candidates.length } : {}),
      ...(createLabel ? { canCreate: true } : {}),
    });
  }
  if (createLabel && answer === shown.length) return CREATE;
  return shown[answer].item;
}

function notFound<T>(what: string, input: string, items: T[], toTarget: (item: T) => FuzzyTarget, describe: (item: T) => string): never {
  const nearest = nearestMatches(items, input, toTarget, MAX_NEAREST);
  const hint = nearest.length > 0 ? ` Closest: ${nearest.map(describe).join('; ')}.` : '';
  fail(`No ${what} matches "${input}".${hint}`);
}

/** 按名称定位一项：唯一匹配直接返回，多项时请用户选择 */
async function resolveNamed<T>(
  resolver: Resolver,
  field: string,
  input: string,
  items: T[],
  toTarget: (item: T) => FuzzyTarget,
  toCandidate: (item: T) => Candidate<T>,
  what: string,
): Promise<T> {
  const result = resolveByName(items, input, toTarget);
  if (result.kind === 'none') notFound(what, input, items, toTarget, item => `${toCandidate(item).label} (${toCandidate(item).id})`);
  if (result.kind === 'unique') {
    if (!result.exact) resolver.resolved.push({ field, input, matched: toCandidate(result.item).label });
    return result.item;
  }
  const chosen = await choose(resolver, field, what, input, result.candidates.map(toCandidate));
  return chosen as T;
}

const collectionCandidate = (collection: Collection): Candidate<Collection> => ({ item: collection, id: collection.id, label: collection.name });

/** collectionId 或 collection（名称，可只写一部分） */
export async function resolveCollection(resolver: Resolver, args: Record<string, unknown>): Promise<Collection> {
  const collectionId = optionalString(args.collectionId, 'collectionId');
  if (collectionId) return requireCollection(collectionId);
  const name = optionalString(args.collection, 'collection')?.trim();
  if (!name) fail('Pass collectionId or collection (its name)');
  return resolveNamed(resolver, 'collection', name, useCollectionsStore().collections, item => ({ name: item.name }), collectionCandidate, 'collection');
}

/** folderPath 的一级：名称，或 { id } 指定已有文件夹，或 { name, create: true } 新建 */
type FolderSegment = { name: string; create?: boolean } | { id: string };

function parseFolderPath(value: unknown): FolderSegment[] {
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list)) fail('folderPath must be an array of folder names');
  return list.map((entry, index) => {
    if (typeof entry === 'string' && entry.trim()) return { name: entry.trim() };
    if (isRecord(entry) && typeof entry.id === 'string' && entry.id) return { id: entry.id };
    if (isRecord(entry) && typeof entry.name === 'string' && entry.name.trim()) {
      return { name: entry.name.trim(), create: entry.create === true };
    }
    fail(`folderPath[${index}] must be a folder name, { id } or { name, create: true }`);
  });
}

export interface FolderTarget {
  collection: Collection;
  /** 已存在的最深一级文件夹；直接在集合下时为 undefined */
  folder?: Folder;
  /** 名称路径，例如 BPP / 服务优化 */
  path: string[];
  /** 还不存在、需要新建的文件夹名称 */
  missing: string[];
}

/**
 * 解析目标位置：folderId，或 folderPath（逐级按名称匹配）。
 * allowCreate 为 true 时，不存在的一级记入 missing；有相近但不完全同名的文件夹时请用户在使用它和新建之间选择。
 */
export async function resolveFolderTarget(
  resolver: Resolver,
  collection: Collection,
  args: Record<string, unknown>,
  allowCreate: boolean,
): Promise<FolderTarget> {
  const folderId = optionalString(args.folderId, 'folderId');
  if (folderId && args.folderPath !== undefined) fail('Pass either folderId or folderPath, not both');
  if (folderId) {
    const folder = findFolder(collection.folders, folderId) || fail(`Folder not found: ${folderId}`);
    return { collection, folder, path: folderNamePath(collection, folderId), missing: [] };
  }
  if (args.folderPath === undefined) return { collection, path: [collection.name], missing: [] };

  const segments = parseFolderPath(args.folderPath);
  const path = [collection.name];
  let current: Collection | Folder = collection;
  let folder: Folder | undefined;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const field = `folderPath[${index}]`;
    const children: Folder[] = current.folders || [];
    if ('id' in segment) {
      const found = children.find(child => child.id === segment.id)
        || fail(`${field}: folder ${segment.id} is not directly inside ${path.join(' / ')}`);
      folder = found;
      current = found;
      path.push(found.name);
      continue;
    }
    const remaining = () => segments.slice(index).map((item, offset) => {
      if ('id' in item) fail(`folderPath[${index + offset}]: a folder given by id must be inside existing folders`);
      return item.name;
    });
    if (segment.create) {
      if (!allowCreate) fail(`${field}: this tool does not create folders`);
      return { collection, folder, path, missing: remaining() };
    }

    const label = (child: Folder) => [...path, child.name].join(' / ');
    const toCandidate = (child: Folder): Candidate<Folder> => ({ item: child, id: child.id, label: label(child) });
    const match = resolveByName(children, segment.name, child => ({ name: child.name }));
    let chosen: Folder | typeof CREATE;
    if (match.kind === 'none') {
      if (!allowCreate) {
        notFound('folder', segment.name, children, child => ({ name: child.name }), child => `${label(child)} (${child.id})`);
      }
      return { collection, folder, path, missing: remaining() };
    } else if (match.kind === 'unique' && match.exact) {
      chosen = match.item;
    } else if (match.kind === 'unique' && !allowCreate) {
      resolver.resolved.push({ field, input: segment.name, matched: label(match.item) });
      chosen = match.item;
    } else {
      const candidates = (match.kind === 'unique' ? [match.item] : match.candidates).map(toCandidate);
      // 已有完全同名的文件夹时不提供新建，避免建出重名目录
      const offerCreate = allowCreate && !(match.kind === 'ambiguous' && match.exact);
      chosen = await choose(resolver, field, 'folder', segment.name, candidates, offerCreate ? `Create new folder "${segment.name}" in ${path.join(' / ')}` : undefined);
    }
    if (chosen === CREATE) return { collection, folder, path, missing: remaining() };
    folder = chosen;
    current = chosen;
    path.push(chosen.name);
  }
  return { collection, folder, path, missing: [] };
}

/** 新建 missing 中的文件夹，返回最终的文件夹 id 和新建的文件夹 */
export async function createMissingFolders(target: FolderTarget) {
  const created: Array<{ id: string; name: string }> = [];
  let parentId = target.folder?.id;
  for (const name of target.missing) {
    const folder = await useCollectionsStore().addFolder(target.collection.id, name, parentId);
    created.push({ id: folder.id, name: folder.name });
    parentId = folder.id;
  }
  return { folderId: parentId, createdFolders: created, path: [...target.path, ...target.missing].join(' / ') };
}

export function folderNamePath(collection: Collection, folderId: string): string[] {
  const names: string[] = [];
  const visit = (folders: Folder[]): boolean => folders.some(folder => {
    names.push(folder.name);
    if (folder.id === folderId || visit(folder.folders || [])) return true;
    names.pop();
    return false;
  });
  visit(collection.folders);
  return [collection.name, ...names];
}

const requestTarget = (match: RequestSearchResult): FuzzyTarget => ({
  name: match.request.name,
  path: match.path.join(' / '),
  extra: [match.request.url],
});

export const requestLabel = (match: RequestSearchResult) => `${match.request.method} ${match.request.name} · ${match.path.join(' / ')}`;

/** 请求 id，或请求名称（可带路径关键词，例如 "BPP 登录"） */
export async function resolveRequest(resolver: Resolver, field: string, value: unknown, scope?: RequestSearchResult[]): Promise<RequestSearchResult> {
  if (isRecord(value) && typeof value.requestId === 'string') return locateRequest(value.requestId);
  if (typeof value !== 'string' || !value.trim()) fail(`${field} must be a request id or name`);
  const input = value.trim();
  const all = scope || searchRequestReferences(useCollectionsStore().collections, '');
  const byId = all.find(match => match.request.id === input);
  if (byId) return byId;
  return resolveNamed(resolver, field, input, all, requestTarget, match => ({ item: match, id: match.request.id, label: requestLabel(match) }), 'request');
}

/** 集合或文件夹里的全部请求（含子文件夹），按显示顺序 */
export function requestsInside(collection: Collection, folderId?: string): RequestSearchResult[] {
  const all = searchRequestReferences([collection], '');
  if (!folderId) return all;
  const folder = findFolder(collection.folders, folderId);
  if (!folder) return [];
  const ids = new Set<string>();
  const collect = (item: Folder) => {
    item.requests.forEach(ref => ids.add(ref.id));
    (item.folders || []).forEach(collect);
  };
  collect(folder);
  return all.filter(match => ids.has(match.request.id));
}

/** workflowId，或 workflow（名称，可只写一部分） */
export async function resolveWorkflow(resolver: Resolver, args: Record<string, unknown>): Promise<WorkflowDefinition> {
  const workflowId = optionalString(args.workflowId, 'workflowId');
  if (workflowId) return requireWorkflow(workflowId);
  const name = optionalString(args.workflow, 'workflow')?.trim();
  if (!name) fail('Pass workflowId or workflow (its name)');
  // 与侧边栏的顺序一致
  const store = useWorkflowsStore();
  const byId = new Map(store.workflows.map(workflow => [workflow.id, workflow]));
  const ordered = listWorkflowPlacements(store.layout).flatMap(({ id }) => byId.get(id) ?? []);
  return resolveNamed(
    resolver, 'workflow', name, ordered,
    workflow => ({ name: workflow.name }),
    workflow => ({ item: workflow, id: workflow.id, label: workflow.name }),
    'workflow',
  );
}
