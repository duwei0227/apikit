// 树的查找与拖放：只依赖节点的 key 和 children，集合树和 Workflow 树共用

/** 可拖放的树节点：key 按层级拼接（子节点的 key 以父节点的 key 加 / 开头） */
export interface DropTreeNode<N> {
  key: string;
  label: string;
  data: object;
  children: N[];
}

export type DropPosition = 'before' | 'after' | 'inside';

/** 按每层的下标（从 0 开始）找节点 */
export function findNodeByIndexPath<N extends DropTreeNode<N>>(nodes: N[], indexPath: number[]): N | null {
  let node: N | null = null;
  let currentNodes = nodes;
  for (const idx of indexPath) {
    if (currentNodes && idx >= 0 && idx < currentNodes.length) {
      node = currentNodes[idx];
      currentNodes = node.children || [];
    } else {
      return null;
    }
  }
  return node;
}

/** 从 treeitem 元素收集从根到当前节点的下标路径（aria-posinset 从 1 开始） */
export function treeItemIndexPath(treeItem: Element | null): number[] {
  const indexPath: number[] = [];
  while (treeItem) {
    const posinset = parseInt(treeItem.getAttribute('aria-posinset') || '', 10);
    if (!isNaN(posinset)) {
      indexPath.unshift(posinset - 1);
    }
    // 向上找父级 treeitem
    const parentGroup = treeItem.parentElement?.closest('[role="group"]');
    treeItem = parentGroup ? parentGroup.closest('[role="treeitem"]') : null;
  }
  return indexPath;
}

/** 收集展开所有带子节点的节点需要的 key */
export function collectExpandableKeys<N extends DropTreeNode<N>>(nodes: N[], acc: Record<string, boolean> = {}): Record<string, boolean> {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      acc[node.key] = true;
      collectExpandableKeys(node.children, acc);
    }
  }
  return acc;
}

export function cloneTreeNodes<N extends DropTreeNode<N>>(nodes: N[]): N[] {
  return nodes.map(n => ({
    ...n, data: { ...n.data }, children: cloneTreeNodes(n.children || [])
  }));
}

/** 把 dragKey 节点移到 targetKey 的前面、后面或里面，返回新树；不能放（放到自己或子节点上）时返回 null */
export function computeDropResult<N extends DropTreeNode<N>>(
  tree: N[],
  dragKey: string,
  targetKey: string,
  position: DropPosition,
): N[] | null {
  if (targetKey === dragKey || targetKey.startsWith(dragKey + '/')) return null;
  const newTree = cloneTreeNodes(tree);
  let dragNode: N | null = null;
  const remove = (nodes: N[]): boolean => {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].key === dragKey) { [dragNode] = nodes.splice(i, 1); return true; }
      if (remove(nodes[i].children || [])) return true;
    }
    return false;
  };
  remove(newTree);
  if (!dragNode) return null;
  const moved: N = dragNode;
  if (position === 'inside') {
    const insertInside = (nodes: N[]): boolean => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].key === targetKey) { (nodes[i].children = nodes[i].children || []).push(moved); return true; }
        if (insertInside(nodes[i].children || [])) return true;
      }
      return false;
    };
    return insertInside(newTree) ? newTree : null;
  }
  const insert = (nodes: N[]): boolean => {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].key === targetKey) { nodes.splice(position === 'before' ? i : i + 1, 0, moved); return true; }
      if (insert(nodes[i].children || [])) return true;
    }
    return false;
  };
  return insert(newTree) ? newTree : null;
}
