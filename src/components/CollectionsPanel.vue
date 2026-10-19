<script setup lang="ts">
import { cloneJson } from '@/utils/clone';
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import { importExportService } from '@/services/import-export';
import { generateId } from '@/utils/id-generator';
import { useTreeDragDrop } from '@/composables/useTreeDragDrop';
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
  type CollectionTreeNode,
  type CollectionTreeNodeData,
} from '@/utils/collectionTree';
import { collectExpandableKeys, findNodeByIndexPath, treeItemIndexPath } from '@/utils/treeDrop';
import type { Collection, Folder, HttpMethod, Request, RequestReference } from '@/types/models';
import { formatShortcut, matchesShortcut } from '@/utils/shortcuts';
import MoveRequestDialog from '@/components/MoveRequestDialog.vue';
import NewCollectionItemDialog from '@/components/NewCollectionItemDialog.vue';
import RenameItemDialog from '@/components/RenameItemDialog.vue';

const isWindows = navigator.userAgent.includes('Windows');

const confirm = useConfirm();
const collectionsStore = useCollectionsStore();
const requestsStore = useRequestsStore();

const props = withDefaults(defineProps<{ searchQuery?: string }>(), { searchQuery: '' });

const emit = defineEmits<{
  'add-request': [payload: { collection: Collection | null; folder: Folder | null; name: string }];
  'open-request': [payload: {
    request: { id: string; name: string; method: HttpMethod; url: string };
    collection: Collection;
    folder: Folder | null;
  }];
  'request-added': [requestId: string];
  'request-deleted': [requestId: string];
  'request-duplicated': [requestId: string];
}>();

type CollectionNodeData = Extract<CollectionTreeNodeData, { type: 'collection' }>;
type FolderNodeData = Extract<CollectionTreeNodeData, { type: 'folder' }>;
type RequestNodeData = Extract<CollectionTreeNodeData, { type: 'request' }>;

// Store
const collections = computed(() => collectionsStore.collections);

// Tree state
const expandedKeys = ref<Record<string, boolean>>({});
const selectedKeys = ref<Record<string, boolean>>({});
const lastSelectedKey = ref<string | null>(null);
const isRestoringSelection = ref(false); // Flag to prevent watch loop

// Dialogs
const newItemDialog = ref<InstanceType<typeof NewCollectionItemDialog> | null>(null);
const renameDialog = ref<InstanceType<typeof RenameItemDialog> | null>(null);
const moveDialog = ref<InstanceType<typeof MoveRequestDialog> | null>(null);

// Context menu
const contextMenu = ref<{ show: (event: Event) => void } | null>(null);
// 右键菜单或快捷键操作的节点（数据为深拷贝，避免操作中被树的更新影响）
const contextMenuNode = ref<CollectionTreeNode | null>(null);

const snapshotNode = (node: CollectionTreeNode): CollectionTreeNode => ({
  key: node.key,
  label: node.label,
  data: cloneJson(node.data),
  icon: node.icon,
  children: node.children
});

// 将 collections 转换为 Tree 节点格式
const treeNodes = computed(() => buildCollectionTree(collections.value, props.searchQuery));

const { onNodeDrop, onNodePointerDown, cancelPointerDrag } = useTreeDragDrop(treeNodes, isWindows);

// Context menu items
const menuItems = computed(() => {
  if (!contextMenuNode.value) return [];
  
  const node = contextMenuNode.value;
  const type = node.data.type;
  const items = [];
  
  if (type === 'request') {
    items.push(
      { label: 'Open', icon: 'pi pi-external-link', command: () => handleOpen() },
      { separator: true },
      { label: 'Move Up', icon: 'pi pi-arrow-up', command: () => handleReorder('up') },
      { label: 'Move Down', icon: 'pi pi-arrow-down', command: () => handleReorder('down') },
      { label: 'Move to...', icon: 'pi pi-folder-open', command: () => handleMoveRequest() },
      { separator: true },
      { 
        label: 'Duplicate', 
        icon: 'pi pi-copy', 
        command: () => handleDuplicate(),
        shortcut: formatShortcut('Mod+D')
      },
      { label: 'Rename', icon: 'pi pi-pencil', command: () => handleRename() },
      { separator: true },
      { 
        label: 'Delete', 
        icon: 'pi pi-trash', 
        class: 'text-red-600', 
        command: () => handleDelete(),
        shortcut: 'Delete'
      }
    );
  } else {
    items.push(
      { label: 'Add Request', icon: 'pi pi-plus', command: () => handleAddRequest() },
      { label: 'Add Folder', icon: 'pi pi-folder-plus', command: () => handleAddFolder() },
      { separator: true },
      { 
        label: 'Duplicate', 
        icon: 'pi pi-copy', 
        command: () => handleDuplicate(),
        shortcut: formatShortcut('Mod+D')
      },
      { label: 'Rename', icon: 'pi pi-pencil', command: () => handleRename() }
    );
    
    items.push(
      { separator: true },
      { label: 'Import', icon: 'pi pi-upload', command: () => handleImport() },
      { label: 'Export', icon: 'pi pi-download', command: () => handleExport() },
      { 
        label: 'Delete', 
        icon: 'pi pi-trash', 
        class: 'text-red-600', 
        command: () => handleDelete(),
        shortcut: 'Delete'
      }
    );
  }
  
  return items;
});

// Event handlers
const onNodeSelect = (node: CollectionTreeNode) => {
  // Track the selected key for preventing deselection
  lastSelectedKey.value = node.key;

  // 如果是 request 类型，直接打开
  if (node.data.type === 'request') {
    handleOpenRequest(node);
  }
};

// Prevent deselection - once a node is selected, user can only select another node
const onNodeUnselect = () => {

  // If we're in the process of restoring selection, don't restore again - this breaks the infinite loop
  if (isRestoringSelection.value) {
    return;
  }

  // Selection was cleared by user click on same node - restore it
  if (lastSelectedKey.value) {
    isRestoringSelection.value = true;
    // Use nextTick to ensure this happens after PrimeVue's internal state updates
    const key = lastSelectedKey.value;
    nextTick(() => {
      selectedKeys.value = { [key]: true };
      isRestoringSelection.value = false;
    });
  }
};

const onTreeContextMenu = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  
  // 查找被右键点击的节点内容区域
  let target = event.target as HTMLElement | null;
  while (target && !target.classList.contains('p-tree-node-content')) {
    target = target.parentElement;
    if (!target || target.classList.contains('p-tree')) break;
  }
  
  if (!target || !target.classList.contains('p-tree-node-content')) return;
  
  // 通过 DOM 索引路径精确定位树节点
  const node = findNodeByIndexPath(treeNodes.value, treeItemIndexPath(target.closest('[role="treeitem"]')));
  
  if (node) {
    contextMenuNode.value = snapshotNode(node);
    contextMenu.value?.show(event);
  }
};

// 节点右键菜单处理（在模板中使用）
const onNodeContextMenu = (node: CollectionTreeNode, event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  
  contextMenuNode.value = snapshotNode(node);
  contextMenu.value?.show(event);
};

// 禁用方向键导航
const onTreeKeyDown = (event: KeyboardEvent) => {
  // 阻止方向键的默认行为
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
  }
};

// 全局键盘快捷键处理
const handleKeyDown = (event: KeyboardEvent) => {
  // 如果用户在输入框中，不要拦截键盘事件
  const target = event.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
    return;
  }

  // Escape: cancel active pointer drag
  if (event.key === 'Escape' && cancelPointerDrag()) {
    return;
  }

  // 检查是否有选中的节点
  const selectedKey = Object.keys(selectedKeys.value)[0];
  if (!selectedKey) return;
  
  // 查找选中的节点
  const selectedNode = findNodeByKey(treeNodes.value, selectedKey);
  if (!selectedNode) return;
  
  // Ctrl+D / Cmd+D: Duplicate
  if (matchesShortcut(event, { key: 'd', mod: true })) {
    event.preventDefault();
    event.stopPropagation();
    
    // 设置 contextMenuNode 为选中的节点
    contextMenuNode.value = snapshotNode(selectedNode);
    
    handleDuplicate();
  }
  
  // Delete: Delete
  if (matchesShortcut(event, { key: 'Delete' })) {
    event.preventDefault();
    event.stopPropagation();
    
    // 设置 contextMenuNode 为选中的节点
    contextMenuNode.value = snapshotNode(selectedNode);
    
    handleDelete();
  }
};

// Auto-expand all nodes when filtering so matched requests are visible
watch(() => props.searchQuery, (newQuery) => {
  if (!newQuery) return;
  expandedKeys.value = collectExpandableKeys(treeNodes.value);
});

// 挂载和卸载键盘事件监听器
onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

// Helper functions
const getCollectionAndFolder = (node: CollectionTreeNode): { collection: Collection | null; folder: Folder | null } => {
  const keyParts = node.key.split('/');
  const collectionId = keyParts[1];
  const collection = collections.value.find(c => c.id === collectionId);
  
  if (!collection) return { collection: null, folder: null };
  
  if (node.data.type === 'folder') {
    return { collection, folder: node.data };
  }
  
  if (node.data.type === 'request') {
    const requestIndex = keyParts.findIndex(p => p === 'request');
    if (requestIndex > 2) {
      const folderIds = keyParts.slice(2, requestIndex);
      const folder = findFolderByPath(collection.folders || [], folderIds) as Folder | null;
      return { collection, folder };
    }
  }
  
  return { collection, folder: null };
};

// Action handlers
const handleOpen = () => {
  if (!contextMenuNode.value) return;
  handleOpenRequest(contextMenuNode.value);
};

const handleOpenRequest = (node: CollectionTreeNode) => {
  const { collection, folder } = getCollectionAndFolder(node);
  if (collection && node.data.type === 'request') {
    // 只传递必要的 request 信息，不包含任何临时属性
    emit('open-request', {
      request: {
        id: node.data.id,
        name: node.data.name,
        method: node.data.method,
        url: node.data.url
      },
      collection,
      folder
    });
  }
};

const handleAddRequest = () => {
  if (!contextMenuNode.value) return;
  const { collection, folder } = getCollectionAndFolder(contextMenuNode.value);
  
  // 发出事件，让 MainContent 创建请求
  emit('add-request', {
    collection,
    folder,
    name: `New Request`
  });
  
  // 清除 contextMenuNode 引用
  contextMenuNode.value = null;
};

const handleAddFolder = () => {
  if (!contextMenuNode.value) return;
  const { collection, folder } = getCollectionAndFolder(contextMenuNode.value);
  if (collection) newItemDialog.value?.open('folder', { collection, folder });
};

const handleDuplicate = async () => {
  if (!contextMenuNode.value) return;
  const node = contextMenuNode.value;
  
  // 深拷贝节点数据，避免引用问题
  const nodeData = cloneJson(node.data);
  
  const { collection, folder } = getCollectionAndFolder(node);
  
  if (nodeData.type === 'request') {
    if (collection) await duplicateRequest(collection, nodeData, folder);
  } else if (nodeData.type === 'folder') {
    if (collection) await duplicateFolder(collection, nodeData, node.key);
  } else if (nodeData.type === 'collection') {
    await duplicateCollection(nodeData);
  }
  
  // 清除 contextMenuNode 引用
  contextMenuNode.value = null;
};

const handleRename = () => {
  if (!contextMenuNode.value) return;
  // 深拷贝 node.data，避免引用问题
  const item = cloneJson(contextMenuNode.value.data);
  if (item.type === 'request') {
    // 树节点里的请求引用不带位置信息，补上所在集合和文件夹，用于检查同一目录下是否重名
    const { collection, folder } = getCollectionAndFolder(contextMenuNode.value);
    renameDialog.value?.open({ type: 'request', id: item.id, name: item.name, collectionId: collection?.id, folderId: folder?.id || null });
  } else {
    renameDialog.value?.open({ type: item.type, id: item.id, name: item.name });
  }
};

const handleDelete = () => {
  if (!contextMenuNode.value) return;
  const node = contextMenuNode.value;
  
  // 深拷贝节点数据，避免引用问题
  const nodeData = cloneJson(node.data);
  const nodeKey = node.key;
  
  const { collection } = getCollectionAndFolder(node);
  
  confirm.require({
    message: `Are you sure you want to delete "${nodeData.name}"?`,
    header: 'Confirm Deletion',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: async () => {
      if (nodeData.type === 'request') {
        if (!collection) return;
        await collectionsStore.removeRequestReference(collection.id, nodeData.id);
        await requestsStore.deleteRequest(nodeData.id);
        // 通知 MainContent 关闭对应的 Tab
        emit('request-deleted', nodeData.id);
      } else if (nodeData.type === 'folder') {
        // 收集 folder 中的所有 request IDs
        if (!collection) return;
        const requestIds = collectAllRequestIds(nodeData);
        await collectionsStore.deleteFolder(collection.id, nodeData.id);
        // 通知 MainContent 关闭所有相关的 Tabs
        requestIds.forEach(id => emit('request-deleted', id));
      } else if (nodeData.type === 'collection') {
        // 收集 collection 中的所有 request IDs
        const requestIds = collectAllRequestIds(nodeData);
        await collectionsStore.deleteCollection(nodeData.id);
        // 通知 MainContent 关闭所有相关的 Tabs
        requestIds.forEach(id => emit('request-deleted', id));
      }
      
      // 清除 contextMenuNode 引用
      contextMenuNode.value = null;
    }
  });
};

const handleExport = async () => {
  if (!contextMenuNode.value) return;
  
  // 深拷贝 collection 数据，避免引用问题
  const nodeData = contextMenuNode.value.data;
  if (nodeData.type === 'request') return;
  // 导出文件夹时按集合导出（导入后成为新的集合）
  const { type: _type, ...item } = cloneJson(nodeData);
  const now = new Date().toISOString();
  const collection: Collection = 'createdAt' in item ? item : { ...item, createdAt: now, updatedAt: now };
  
  try {
    const requestIds = collectAllRequestIds(collection);
    const requests = await requestsStore.loadMultipleRequests(requestIds);
    const exported = await importExportService.exportCollection(collection, requests);
    
    if (exported && window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: 'Collection exported',
        life: 3000
      });
    }
  } catch (error) {
    console.error('Failed to export:', error);
  }
  
  // 清除 contextMenuNode 引用
  contextMenuNode.value = null;
};

const saveImportedRequests = async (requests: Request[], collectionId: string, rootFolderId: string) => {
  for (const request of requests) {
    await requestsStore.saveRequest({
      ...request,
      collectionId,
      folderId: request.folderId || rootFolderId
    });
  }
};

const importCollectionAsFolder = async (
  targetNode: CollectionTreeNode,
  targetCollection: Collection,
  targetFolder: Folder | null,
  importedCollection: Collection,
  importedRequests: Request[],
) => {
  const createdFolder = await collectionsStore.addFolder(
    targetCollection.id,
    importedCollection.name,
    targetFolder?.id
  );

  if (!createdFolder) return;

  await collectionsStore.updateFolder(targetCollection.id, createdFolder.id, {
    folders: importedCollection.folders || [],
    requests: importedCollection.requests || []
  });

  await saveImportedRequests(importedRequests, targetCollection.id, createdFolder.id);

  const createdFolderKey = targetFolder
    ? `${targetNode.key}/${createdFolder.id}`
    : `collection/${targetCollection.id}/${createdFolder.id}`;

  expandedKeys.value = {
    ...expandedKeys.value,
    [`collection/${targetCollection.id}`]: true,
    [createdFolderKey]: true
  };
};

const handleImport = async () => {
  if (!contextMenuNode.value) return;

  const targetNode = contextMenuNode.value;
  const { collection: targetCollection, folder: targetFolder } = getCollectionAndFolder(targetNode);
  if (!targetCollection) return;

  try {
    const result = await importExportService.importCollection();
    if (!result) return;

    const importedCollections = result.collections;

    for (const importedCollection of importedCollections) {
      const importedRequests = result.requests.filter(
        request => request.collectionId === importedCollection.id
      );

      await importCollectionAsFolder(
        targetNode,
        targetCollection,
        targetFolder,
        importedCollection,
        importedRequests
      );
    }

    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: importedCollections.length === 1
          ? 'Collection imported'
          : `${importedCollections.length} collections imported`,
        life: 3000
      });
    }
  } catch (error) {
    console.error('Failed to import collection:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Import Failed',
        detail: 'Failed to import collection',
        life: 5000
      });
    }
  } finally {
    contextMenuNode.value = null;
  }
};

// Reorder and Move handlers
const handleReorder = async (direction: 'up' | 'down') => {
  const node = contextMenuNode.value;
  if (!node || node.data.type !== 'request') return;
  const { collection } = getCollectionAndFolder(node);
  if (!collection) return;
  await collectionsStore.reorderRequest(collection.id, node.data.id, direction);
  contextMenuNode.value = null;
};

const handleMoveRequest = () => {
  if (!contextMenuNode.value || contextMenuNode.value.data.type !== 'request') return;
  moveDialog.value?.open(contextMenuNode.value);
};

// Duplicate functions
const duplicateRequest = async (collection: Collection, request: RequestNodeData, folder: Folder | null) => {
  try {
    const fullRequest = await requestsStore.loadRequest(request.id);
    if (!fullRequest) return;
    
    // 深拷贝出完全独立的副本，并清除所有临时属性（以 _ 开头的属性）
    const newRequest = copyRequestData(fullRequest, {
      id: generateId(),
      name: `${fullRequest.name} (Copy)`,
      collectionId: collection.id,
      folderId: folder?.id || null
    });
    
    await requestsStore.saveRequest(newRequest);
    await collectionsStore.addRequestReference(
      collection.id,
      newRequest.id,
      newRequest.name,
      newRequest.method,
      newRequest.url,
      folder?.id,
      { insertAfterRequestId: request.id }
    );
    
    // 等待 Vue 更新 DOM 和 computed 属性
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // 自动选中新创建的 request
    selectRequestNode(newRequest.id, collection.id, folder?.id);
    
    // 通知 MainContent 打开新创建的 request
    emit('request-duplicated', newRequest.id);
    
    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: 'Request duplicated',
        life: 3000
      });
    }
  } catch (error) {
    console.error('Failed to duplicate request:', error);
  }
};

const duplicateFolder = async (collection: Collection, folder: FolderNodeData, folderKey: string) => {
  try {
    const maps = createCopyIdMaps();
    const newFolder = copyFolderStructure(folder, maps, ' (Copy)');
    
    // 副本放在原文件夹旁边：key 为 collection/<cid>/<上级文件夹 id...>/<fid>
    const parentFolderIds = folderKey.split('/').slice(2, -1);
    const parentFolder = findFolderByPath(collection.folders || [], parentFolderIds);
    
    // addFolder 返回新创建的 folder 对象
    const createdFolder = await collectionsStore.addFolder(
      collection.id, 
      newFolder.name, 
      parentFolder?.id
    );
    
    if (createdFolder) {
      // 更新 folderIdMap，将源 folder 的 ID 映射到实际创建的 folder ID
      maps.folderIdMap.set(folder.id, createdFolder.id);
      
      // 更新新创建的 folder，添加子 folders 和 requests
      await collectionsStore.updateFolder(collection.id, createdFolder.id, {
        folders: newFolder.folders,
        requests: newFolder.requests
      });
      
      // 复制所有 requests 的完整数据
      const requestIds = collectAllRequestIds(folder);
      const requests = await requestsStore.loadMultipleRequests(requestIds);
      
      for (const request of requests) {
        const newRequestId = maps.requestIdMap.get(request.id);
        if (newRequestId) {
          // 深拷贝出完全独立的请求副本，并清除所有临时属性
          await requestsStore.saveRequest(copyRequestData(request, {
            id: newRequestId,
            collectionId: collection.id,
            folderId: request.folderId ? maps.folderIdMap.get(request.folderId) : createdFolder.id
          }));
        }
      }
      if (window.$toast) {
        window.$toast.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Folder duplicated',
          life: 3000
        });
      }
    }
  } catch (error) {
    console.error('Failed to duplicate folder:', error);
  }
};

const duplicateCollection = async (collection: CollectionNodeData) => {
  try {
    const newCollection = await collectionsStore.createCollection(
      `${collection.name} (Copy)`,
      collection.description
    );
    
    const requestIds = collectAllRequestIds(collection);
    const requests = await requestsStore.loadMultipleRequests(requestIds);
    
    const maps = createCopyIdMaps();
    const newFolders = collection.folders ? collection.folders.map(folder => copyFolderStructure(folder, maps)) : [];
    const newRequests = collection.requests ? copyRequestRefs(collection.requests, maps) : [];
    
    await collectionsStore.updateCollection(newCollection.id, {
      folders: newFolders,
      requests: newRequests
    });
    
    for (const request of requests) {
      const newRequestId = maps.requestIdMap.get(request.id);
      if (newRequestId) {
        // 深拷贝出完全独立的请求副本，并清除所有临时属性
        await requestsStore.saveRequest(copyRequestData(request, {
          id: newRequestId,
          collectionId: newCollection.id,
          folderId: request.folderId ? maps.folderIdMap.get(request.folderId) : null
        }));
      }
    }
    
    expandedKeys.value = {
      ...expandedKeys.value,
      [`collection/${newCollection.id}`]: true
    };
    
    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: 'Collection duplicated',
        life: 3000
      });
    }
  } catch (error) {
    console.error('Failed to duplicate collection:', error);
  }
};

// Create dialog
const openCreateDialog = (mode: 'collection' | 'folder' = 'collection') => {
  newItemDialog.value?.open(mode);
};

// 选中指定的 request 节点
const selectRequestNode = (requestId: string, collectionId: string, folderId?: string | null) => {
  // 构建节点的 key
  let key = `collection/${collectionId}`;
  
  if (folderId) {
    // 需要找到 folder 的完整路径
    const collection = collections.value.find(c => c.id === collectionId);
    if (collection) {
      const folderPath = findFolderPath(collection.folders || [], folderId);
      if (folderPath) {
        key = `${key}/${folderPath.join('/')}`;
      }
    }
  }
  
  key = `${key}/request/${requestId}`;
  
  // 展开集合和所有上级文件夹：key 为 collection/<cid>/<fid>.../request/<rid>，
  // 每个上级的 key 是到它为止的前缀
  const expandParents = (nodeKey: string) => {
    const parts = nodeKey.split('/');
    const requestIndex = parts.lastIndexOf('request');
    const newExpandedKeys = { ...expandedKeys.value };
    for (let end = 2; end <= requestIndex; end++) {
      newExpandedKeys[parts.slice(0, end).join('/')] = true;
    }
    expandedKeys.value = newExpandedKeys;
  };
  
  expandParents(key);
  
  // 选中节点
  selectedKeys.value = { [key]: true };
};

// 清除选中状态
const clearSelection = () => {
  selectedKeys.value = {};
};

// Expose methods
defineExpose({
  collections,
  selectRequestNode,
  clearSelection,
  openCreateDialog
});
</script>

<template>
  <div class="h-full min-h-0 flex flex-col overflow-hidden p-2 bg-surface-0 dark:bg-surface-950">
    <div class="mb-2 shrink-0">
      <Button
        @click="openCreateDialog('collection')"
        label="New Collection"
        icon="pi pi-plus"
        size="small"
        class="w-full"
      />
    </div>
    
    <div 
      v-if="treeNodes.length === 0" 
      class="text-surface-500 dark:text-surface-400 text-xs text-center py-4"
    >
      {{ searchQuery ? 'No matching collections found' : 'No collections yet' }}
    </div>
    
    <div 
      v-else
      class="flex-1 min-h-0 overflow-hidden"
      @contextmenu="onTreeContextMenu"
      @keydown="onTreeKeyDown"
    >
      <Tree
        :value="treeNodes"
        v-model:expandedKeys="expandedKeys"
        v-model:selectionKeys="selectedKeys"
        selectionMode="single"
        :draggableNodes="!isWindows"
        :droppableNodes="!isWindows"
        scrollHeight="flex"
        class="w-full h-full min-w-0"
        @node-select="onNodeSelect"
        @node-unselect="onNodeUnselect"
        @node-drop="onNodeDrop"
      >
        <template #default="slotProps">
          <div
            class="flex items-center gap-2 flex-1 min-w-0 select-none"
            @contextmenu="onNodeContextMenu(slotProps.node, $event)"
            @pointerdown="onNodePointerDown(slotProps.node, $event)"
          >
            <span 
              v-if="slotProps.node.data.type === 'request'" 
              class="method-badge"
              :class="{
                'text-green-600': slotProps.node.data.method === 'GET',
                'text-blue-600': slotProps.node.data.method === 'POST',
                'text-yellow-600': slotProps.node.data.method === 'PUT',
                'text-red-600': slotProps.node.data.method === 'DELETE',
                'text-purple-600': slotProps.node.data.method === 'PATCH'
              }"
            >
              {{ (slotProps.node.data.method || 'get').toLowerCase() }}
            </span>
            <span
              class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm"
              :title="slotProps.node.data.type === 'request' ? slotProps.node.label : undefined"
            >
              {{ slotProps.node.label }}
            </span>
          </div>
        </template>
      </Tree>
    </div>

    <ContextMenu ref="contextMenu" :model="menuItems">
      <template #item="{ item, props }">
        <a v-ripple class="flex items-center" v-bind="props.action">
          <span :class="item.icon" />
          <span class="ml-2">{{ item.label }}</span>
          <span v-if="item.shortcut" class="ml-auto pl-4 text-xs opacity-60 font-mono">
            {{ item.shortcut }}
          </span>
        </a>
      </template>
    </ContextMenu>

    <NewCollectionItemDialog ref="newItemDialog" />
    <RenameItemDialog ref="renameDialog" />
    <MoveRequestDialog ref="moveDialog" />
  </div>
</template>

<style scoped>
:deep(.p-tree) {
  border: none;
  padding: 0;
  background: transparent;
}

.method-badge {
  font-weight: 600;
  font-size: 10px;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

/* ContextMenu 快捷键样式 */
:deep(.p-contextmenu .p-menuitem-link) {
  display: flex;
  align-items: center;
  width: 100%;
}

:deep(.p-contextmenu .p-menuitem-link .ml-auto) {
  margin-left: auto;
}
</style>
