// Workflow 树：侧边栏文件夹结构（WorkflowLayout）的读取、修改和 Tree 节点构建，不依赖 store 和界面

import { cloneJson } from '@/utils/clone';
import type { WorkflowFolder, WorkflowLayout, WorkflowLayoutItem } from '@/types/models';

export type WorkflowTreeNodeData =
  | { type: 'folder'; id: string; name: string }
  | { type: 'workflow'; id: string; name: string };

export interface WorkflowTreeNode {
  key: string;
  label: string;
  data: WorkflowTreeNodeData;
  icon?: string;
  /** false 时 Tree 组件不允许把其他节点拖进来 */
  droppable?: boolean;
  children: WorkflowTreeNode[];
}

export interface WorkflowPlacement {
  id: string;
  /** 从根目录到所在文件夹的名称，在根目录时为空 */
  folderPath: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * 把读到的文件夹结构整理成有效的 WorkflowLayout：去掉不存在或重复的 Workflow、无效的条目，
 * 不在结构中的 Workflow 按 workflowIds 的顺序放到根目录末尾。
 */
export function normalizeWorkflowLayout(raw: unknown, workflowIds: string[]): WorkflowLayout {
  const known = new Set(workflowIds);
  const placed = new Set<string>();
  const folderIds = new Set<string>();

  const readItems = (value: unknown): WorkflowLayoutItem[] => {
    if (!Array.isArray(value)) return [];
    const items: WorkflowLayoutItem[] = [];
    for (const entry of value) {
      if (!isRecord(entry) || typeof entry.id !== 'string') continue;
      if (entry.type === 'workflow') {
        if (!known.has(entry.id) || placed.has(entry.id)) continue;
        placed.add(entry.id);
        items.push({ type: 'workflow', id: entry.id });
      } else if (entry.type === 'folder' && typeof entry.name === 'string' && !folderIds.has(entry.id)) {
        folderIds.add(entry.id);
        items.push({ type: 'folder', id: entry.id, name: entry.name, children: readItems(entry.children) });
      }
    }
    return items;
  };

  const items = readItems(isRecord(raw) ? raw.items : undefined);
  for (const id of workflowIds) {
    if (placed.has(id)) continue;
    placed.add(id);
    items.push({ type: 'workflow', id });
  }
  return { items };
}

const itemSegment = (item: WorkflowLayoutItem) => `${item.type}:${item.id}`;

/**
 * 文件夹结构转为 Tree 节点，key 形如 folder:<fid>/workflow:<wid>；
 * 有搜索词时只保留名称匹配的节点和它们的上级（匹配的文件夹保留全部内容）。
 */
export function buildWorkflowTree(
  layout: WorkflowLayout,
  workflows: Array<{ id: string; name: string }>,
  searchQuery = '',
): WorkflowTreeNode[] {
  const names = new Map(workflows.map(workflow => [workflow.id, workflow.name]));

  const convert = (item: WorkflowLayoutItem, parentKey: string): WorkflowTreeNode | null => {
    const key = parentKey ? `${parentKey}/${itemSegment(item)}` : itemSegment(item);
    if (item.type === 'workflow') {
      const name = names.get(item.id);
      if (name === undefined) return null;
      return { key, label: name, data: { type: 'workflow', id: item.id, name }, icon: 'pi pi-sitemap', droppable: false, children: [] };
    }
    return {
      key,
      label: item.name,
      data: { type: 'folder', id: item.id, name: item.name },
      icon: 'pi pi-folder',
      children: convertAll(item.children, key),
    };
  };

  const convertAll = (items: WorkflowLayoutItem[], parentKey: string) => items
    .map(item => convert(item, parentKey))
    .filter((node): node is WorkflowTreeNode => Boolean(node));

  const allNodes = convertAll(layout.items, '');
  const query = searchQuery.trim().toLowerCase();
  if (!query) return allNodes;

  const filterNode = (node: WorkflowTreeNode): WorkflowTreeNode | null => {
    if (node.label.toLowerCase().includes(query)) return node;
    const children = node.children.map(filterNode).filter((child): child is WorkflowTreeNode => Boolean(child));
    return children.length > 0 ? { ...node, children } : null;
  };
  return allNodes.map(filterNode).filter((node): node is WorkflowTreeNode => Boolean(node));
}

/** 拖放后的 Tree 节点转回文件夹结构 */
export function layoutFromTree(nodes: WorkflowTreeNode[]): WorkflowLayout {
  const toItems = (list: WorkflowTreeNode[]): WorkflowLayoutItem[] => list.map(node => (
    node.data.type === 'workflow'
      ? { type: 'workflow', id: node.data.id }
      : { type: 'folder', id: node.data.id, name: node.data.name, children: toItems(node.children || []) }
  ));
  return { items: toItems(nodes) };
}

export function findWorkflowFolder(items: WorkflowLayoutItem[], folderId: string): WorkflowFolder | null {
  for (const item of items) {
    if (item.type !== 'folder') continue;
    if (item.id === folderId) return item;
    const found = findWorkflowFolder(item.children, folderId);
    if (found) return found;
  }
  return null;
}

/** 文件夹（含子文件夹）中的全部 Workflow id */
export function collectFolderWorkflowIds(folder: WorkflowFolder): string[] {
  return folder.children.flatMap(item => (item.type === 'workflow' ? [item.id] : collectFolderWorkflowIds(item)));
}

/** 指定位置（folderId 为 null 时是根目录）的子项；文件夹不存在时为 null */
const childrenOf = (layout: WorkflowLayout, folderId: string | null) => (
  folderId ? findWorkflowFolder(layout.items, folderId)?.children ?? null : layout.items
);

/** 从结构中移除满足条件的条目（含嵌套），返回被移除的条目 */
const removeItems = (items: WorkflowLayoutItem[], shouldRemove: (item: WorkflowLayoutItem) => boolean): WorkflowLayoutItem[] => {
  const removed: WorkflowLayoutItem[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (shouldRemove(item)) {
      removed.unshift(...items.splice(i, 1));
    } else if (item.type === 'folder') {
      removed.unshift(...removeItems(item.children, shouldRemove));
    }
  }
  return removed;
};

/** 把 Workflow 放到文件夹末尾（folderId 为 null 或文件夹不存在时放到根目录）；已在结构中时移动过去 */
export function addWorkflowToLayout(layout: WorkflowLayout, workflowId: string, folderId: string | null = null): WorkflowLayout {
  const next = cloneJson(layout);
  removeItems(next.items, item => item.type === 'workflow' && item.id === workflowId);
  (childrenOf(next, folderId) ?? next.items).push({ type: 'workflow', id: workflowId });
  return next;
}

/** 把 Workflow 放在 referenceId 的后面（同一文件夹中）；找不到 referenceId 时放到根目录末尾 */
export function insertWorkflowAfter(layout: WorkflowLayout, workflowId: string, referenceId: string): WorkflowLayout {
  const next = cloneJson(layout);
  removeItems(next.items, item => item.type === 'workflow' && item.id === workflowId);
  const insert = (items: WorkflowLayoutItem[]): boolean => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type === 'workflow' && item.id === referenceId) {
        items.splice(i + 1, 0, { type: 'workflow', id: workflowId });
        return true;
      }
      if (item.type === 'folder' && insert(item.children)) return true;
    }
    return false;
  };
  if (!insert(next.items)) next.items.push({ type: 'workflow', id: workflowId });
  return next;
}

export function removeWorkflowFromLayout(layout: WorkflowLayout, workflowId: string): WorkflowLayout {
  const next = cloneJson(layout);
  removeItems(next.items, item => item.type === 'workflow' && item.id === workflowId);
  return next;
}

/** 在 parentId 文件夹（null 为根目录）末尾新建文件夹；父文件夹不存在时放到根目录 */
export function addFolderToLayout(
  layout: WorkflowLayout,
  folder: { id: string; name: string },
  parentId: string | null = null,
): WorkflowLayout {
  const next = cloneJson(layout);
  (childrenOf(next, parentId) ?? next.items).push({ type: 'folder', id: folder.id, name: folder.name, children: [] });
  return next;
}

export function renameFolderInLayout(layout: WorkflowLayout, folderId: string, name: string): WorkflowLayout {
  const next = cloneJson(layout);
  const folder = findWorkflowFolder(next.items, folderId);
  if (folder) folder.name = name;
  return next;
}

/** 删除文件夹，返回新结构和其中（含子文件夹）的 Workflow id */
export function removeFolderFromLayout(layout: WorkflowLayout, folderId: string): { layout: WorkflowLayout; workflowIds: string[] } {
  const next = cloneJson(layout);
  const removed = removeItems(next.items, item => item.type === 'folder' && item.id === folderId);
  const workflowIds = removed.flatMap(item => (item.type === 'folder' ? collectFolderWorkflowIds(item) : []));
  return { layout: next, workflowIds };
}

/** 同一位置中是否已有同名文件夹（不区分大小写），excludeFolderId 为正在重命名的文件夹自己 */
export function isWorkflowFolderNameTaken(
  layout: WorkflowLayout,
  parentId: string | null,
  name: string,
  excludeFolderId: string | null = null,
): boolean {
  return (childrenOf(layout, parentId) || []).some(item => (
    item.type === 'folder' && item.id !== excludeFolderId && sameName(item.name, name)
  ));
}

/** 文件夹所在的上级文件夹 id（在根目录时为 null）；找不到文件夹时为 undefined */
export function findParentFolderId(layout: WorkflowLayout, folderId: string): string | null | undefined {
  const search = (items: WorkflowLayoutItem[], parentId: string | null): string | null | undefined => {
    for (const item of items) {
      if (item.type !== 'folder') continue;
      if (item.id === folderId) return parentId;
      const found = search(item.children, item.id);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return search(layout.items, null);
}

/** 按树的显示顺序列出全部 Workflow 及其所在文件夹的名称路径 */
export function listWorkflowPlacements(layout: WorkflowLayout): WorkflowPlacement[] {
  const result: WorkflowPlacement[] = [];
  const visit = (items: WorkflowLayoutItem[], folderPath: string[]) => {
    for (const item of items) {
      if (item.type === 'workflow') result.push({ id: item.id, folderPath });
      else visit(item.children, [...folderPath, item.name]);
    }
  };
  visit(layout.items, []);
  return result;
}

/**
 * 按名称路径找到文件夹，缺少的逐级新建（名称不区分大小写匹配同级文件夹）。
 * 路径为空时 folderId 为 null（根目录）。
 */
export function ensureWorkflowFolderPath(
  layout: WorkflowLayout,
  folderPath: string[],
  createId: () => string,
): { layout: WorkflowLayout; folderId: string | null } {
  const next = cloneJson(layout);
  let siblings = next.items;
  let folderId: string | null = null;
  for (const name of folderPath) {
    let folder = siblings.find((item): item is WorkflowFolder => item.type === 'folder' && sameName(item.name, name));
    if (!folder) {
      folder = { type: 'folder', id: createId(), name, children: [] };
      siblings.push(folder);
    }
    folderId = folder.id;
    siblings = folder.children;
  }
  return { layout: next, folderId };
}

/** 读取导入文件中 Workflow 的 folderPath：只接受非空字符串组成的数组 */
export function readWorkflowFolderPath(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((name): name is string => typeof name === 'string')
    .map(name => name.trim())
    .filter(Boolean);
}
