import { onMounted, onUnmounted, type Ref } from 'vue';
import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import { computeDropResult, findNodeByIndexPath, treeItemIndexPath, type CollectionTreeNode, type DropPosition } from '@/utils/collectionTree';
import type { Folder } from '@/types/models';

/** 子节点中的请求引用，order 为它在子节点中的下标（与文件夹交错的显示顺序） */
const requestRefsOf = (children: CollectionTreeNode[]) => children.flatMap((c, idx) => (
  c.data.type === 'request'
    ? [{ id: c.data.id, name: c.data.name, method: c.data.method, url: c.data.url, order: idx }]
    : []
));

interface PointerDragState {
  node: CollectionTreeNode;
  startX: number;
  startY: number;
  active: boolean;
  ghostEl: HTMLElement | null;
  lineEl: HTMLElement | null;
  targetKey: string | null;
  position: DropPosition;
}

/**
 * 集合树的拖放：Tree 组件的 node-drop 事件，以及 Windows 上用指针事件模拟的拖动
 * （WebView2 不能可靠地支持 HTML5 拖放）。usePointerDrag 为 true 时启用指针拖动。
 */
export function useTreeDragDrop(treeNodes: Ref<CollectionTreeNode[]>, usePointerDrag: boolean) {
  const collectionsStore = useCollectionsStore();
  const requestsStore = useRequestsStore();

  // 放置无效时让树按 store 中的数据重新生成，撤销 Tree 组件里的移动。
  // 不能从磁盘重新加载：集合的保存会延迟 500ms，刚做的修改还没写入文件，重新加载会把它丢掉
  const resetTree = () => {
    collectionsStore.collections = [...collectionsStore.collections];
  };

  // 拖拽处理
  const onNodeDrop = async (event: { value: CollectionTreeNode[]; dragNode: CollectionTreeNode }) => {
    const { value: newNodes, dragNode } = event;
    if (!dragNode || !newNodes) return;

    const draggedType = dragNode.data?.type;
    if (!draggedType) return;

    // Helper: 从树节点递归重建 folder 的 store 格式。
    // order 取子项在 children 中的下标，把可见的交错顺序持久化。
    // 注意：folder 自身的 order 由调用方按其在父级 children 中的下标赋值（见下方两处 map），
    // 故此处不设置 order，避免写入拖拽前的过时值。
    const extractFolderData = (folderNode: CollectionTreeNode): Folder => {
      const children = folderNode.children || [];
      return {
        id: folderNode.data.id,
        name: folderNode.data.name,
        description: (folderNode.data.type !== 'request' && folderNode.data.description) || '',
        requests: requestRefsOf(children),
        folders: children
          .map((c, idx) => ({ c, idx }))
          .filter(({ c }) => c.data.type === 'folder')
          .map(({ c, idx }) => ({ ...extractFolderData(c), order: idx }))
      };
    };

    // Collection 拖拽：只做排序
    if (draggedType === 'collection') {
      const newOrder = newNodes.map(n => n.data.id);
      await collectionsStore.reorderCollections(newOrder);
      return;
    }

    // 找到被拖节点在新树中所属的 collection 和 folder
    const oldCollectionId = dragNode.key.split('/')[1];
    let newCollectionId: string | null = null;
    let newFolderId: string | null = null;

    const scanFolder = (folderNode: CollectionTreeNode, collId: string): boolean => {
      for (const child of (folderNode.children || [])) {
        if (child.data.type === draggedType && child.data.id === dragNode.data.id) {
          newCollectionId = collId;
          newFolderId = folderNode.data.id;
          return true;
        }
        if (child.data.type === 'folder' && scanFolder(child, collId)) return true;
      }
      return false;
    };

    for (const collNode of newNodes) {
      for (const child of (collNode.children || [])) {
        if (child.data.type === draggedType && child.data.id === dragNode.data.id) {
          newCollectionId = collNode.data.id;
          newFolderId = null;
          break;
        }
        if (child.data.type === 'folder' && scanFolder(child, collNode.data.id)) break;
      }
      if (newCollectionId) break;
    }

    if (!newCollectionId) {
      resetTree();
      return;
    }

    // Folder 拖拽：不允许跨 collection 移动，只做同 collection 内排序
    if (draggedType === 'folder' && oldCollectionId !== newCollectionId) {
      resetTree();
      return;
    }

    // 更新受影响的 collection
    const affectedIds = new Set([oldCollectionId, newCollectionId]);
    for (const collNode of newNodes) {
      if (!affectedIds.has(collNode.data.id)) continue;
      const children = collNode.children || [];
      const newRequests = requestRefsOf(children);
      const newFolders = children
        .map((c, idx) => ({ c, idx }))
        .filter(({ c }) => c.data.type === 'folder')
        .map(({ c, idx }) => ({ ...extractFolderData(c), order: idx }));
      await collectionsStore.updateCollection(collNode.data.id, { requests: newRequests, folders: newFolders });
    }

    // Request 跨位置移动时，更新 request 文件中的 collectionId / folderId
    if (draggedType === 'request') {
      // 从 key 解析原始 folderId：key 格式为 collection/cid[/fid...]/request/rid
      const keyParts = dragNode.key.split('/');
      const requestIdx = keyParts.indexOf('request');
      const oldFolderId = requestIdx > 2 ? keyParts[requestIdx - 1] : null;

      if (oldCollectionId !== newCollectionId || oldFolderId !== newFolderId) {
        const fullRequest = await requestsStore.loadRequest(dragNode.data.id);
        if (fullRequest) {
          await requestsStore.saveRequest({
            ...fullRequest,
            collectionId: newCollectionId,
            folderId: newFolderId,
            updatedAt: new Date().toISOString()
          });
        }
      }
    }
  };

  // Pointer-event drag (replaces HTML5 DnD — WebView2 on Windows does not support HTML5 DnD reliably)
  let ptrDrag: PointerDragState | null = null;

  const onNodePointerDown = (node: CollectionTreeNode, event: PointerEvent) => {
    if (!usePointerDrag || event.button !== 0) return;
    ptrDrag = { node, startX: event.clientX, startY: event.clientY, active: false, ghostEl: null, lineEl: null, targetKey: null, position: 'after' };
  };

  const onGlobalPointerMove = (event: PointerEvent) => {
    if (!ptrDrag) return;
    if (!ptrDrag.active && Math.hypot(event.clientX - ptrDrag.startX, event.clientY - ptrDrag.startY) > 5) {
      ptrDrag.active = true;
      ptrDrag.ghostEl = document.createElement('div');
      Object.assign(ptrDrag.ghostEl.style, {
        position: 'fixed', zIndex: '9999', pointerEvents: 'none',
        background: 'var(--p-surface-100, #f1f5f9)', border: '1px solid var(--p-surface-300, #cbd5e1)',
        borderRadius: '4px', padding: '3px 10px', fontSize: '12px',
        whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', opacity: '0.9'
      });
      ptrDrag.ghostEl.textContent = ptrDrag.node.label;
      document.body.appendChild(ptrDrag.ghostEl);
      ptrDrag.lineEl = document.createElement('div');
      Object.assign(ptrDrag.lineEl.style, {
        position: 'fixed', height: '2px', zIndex: '9998', pointerEvents: 'none',
        background: 'var(--p-primary-500, #3b82f6)', display: 'none'
      });
      document.body.appendChild(ptrDrag.lineEl);
    }
    if (!ptrDrag.active) return;
    // 拖动开始后影子元素和指示线一定已创建
    const ghostEl = ptrDrag.ghostEl as HTMLElement;
    const lineEl = ptrDrag.lineEl as HTMLElement;
    event.preventDefault();
    ghostEl.style.left = `${event.clientX + 14}px`;
    ghostEl.style.top = `${event.clientY - 14}px`;

    ghostEl.style.visibility = 'hidden';
    const els = document.elementsFromPoint(event.clientX, event.clientY);
    ghostEl.style.visibility = '';

    const treeItemEl = els.find(el => el.getAttribute('role') === 'treeitem');
    if (!treeItemEl) { ptrDrag.targetKey = null; lineEl.style.display = 'none'; return; }

    const targetNode = findNodeByIndexPath(treeNodes.value, treeItemIndexPath(treeItemEl));
    if (!targetNode || targetNode.key === ptrDrag.node.key) { ptrDrag.targetKey = null; lineEl.style.display = 'none'; return; }

    const contentEl = treeItemEl.querySelector('.p-tree-node-content') || treeItemEl;
    const rect = contentEl.getBoundingClientRect();
    // Hovering over a collection/folder with a non-collection drag → drop inside
    const dragType = ptrDrag.node.data.type;
    const targetType = targetNode.data.type;
    const dropPos = (dragType !== 'collection' && (targetType === 'collection' || targetType === 'folder'))
      ? 'inside'
      : event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    ptrDrag.targetKey = targetNode.key;
    ptrDrag.position = dropPos;
    if (dropPos === 'inside') {
      // Indented line at the bottom of the target row signals "will become a child"
      Object.assign(lineEl.style, { display: 'block', left: `${rect.left + 16}px`, width: `${rect.width - 16}px`, top: `${rect.bottom - 1}px` });
    } else {
      const lineY = dropPos === 'before' ? rect.top : rect.bottom;
      Object.assign(lineEl.style, { display: 'block', left: `${rect.left}px`, width: `${rect.width}px`, top: `${lineY - 1}px` });
    }
  };

  const onGlobalPointerUp = async () => {
    if (!ptrDrag) return;
    const { active, node, targetKey, position, ghostEl, lineEl } = ptrDrag;
    ptrDrag = null;
    ghostEl?.remove();
    lineEl?.remove();
    if (!active || !targetKey) return;
    const newTree = computeDropResult(treeNodes.value, node.key, targetKey, position);
    if (newTree) await onNodeDrop({ value: newTree, dragNode: node });
  };

  /** 取消正在进行的指针拖动；有拖动被取消时返回 true */
  const cancelPointerDrag = () => {
    if (!ptrDrag?.active) return false;
    ptrDrag.ghostEl?.remove();
    ptrDrag.lineEl?.remove();
    ptrDrag = null;
    return true;
  };

  onMounted(() => {
    if (!usePointerDrag) return;
    window.addEventListener('pointermove', onGlobalPointerMove);
    window.addEventListener('pointerup', onGlobalPointerUp);
    window.addEventListener('pointercancel', onGlobalPointerUp);
  });

  onUnmounted(() => {
    if (!usePointerDrag) return;
    window.removeEventListener('pointermove', onGlobalPointerMove);
    window.removeEventListener('pointerup', onGlobalPointerUp);
    window.removeEventListener('pointercancel', onGlobalPointerUp);
  });

  return { onNodeDrop, onNodePointerDown, cancelPointerDrag };
}
