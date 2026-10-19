import type { Ref } from 'vue';
import { usePointerTreeDrag } from '@/composables/usePointerTreeDrag';
import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import type { CollectionTreeNode } from '@/utils/collectionTree';
import type { Folder } from '@/types/models';

/** 子节点中的请求引用，order 为它在子节点中的下标（与文件夹交错的显示顺序） */
const requestRefsOf = (children: CollectionTreeNode[]) => children.flatMap((c, idx) => (
  c.data.type === 'request'
    ? [{ id: c.data.id, name: c.data.name, method: c.data.method, url: c.data.url, order: idx }]
    : []
));

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

  // Windows 上用指针事件模拟拖动：拖到集合或文件夹上时放进去（集合只能排序）
  const { onNodePointerDown, cancelPointerDrag } = usePointerTreeDrag(treeNodes, usePointerDrag, {
    dropPosition: (dragNode, targetNode, offsetRatio) => {
      const targetType = targetNode.data.type;
      if (dragNode.data.type !== 'collection' && (targetType === 'collection' || targetType === 'folder')) return 'inside';
      return offsetRatio < 0.5 ? 'before' : 'after';
    },
    onDrop: (newTree, dragNode) => onNodeDrop({ value: newTree, dragNode }),
  });

  return { onNodeDrop, onNodePointerDown, cancelPointerDrag };
}
