<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import { importExportService } from '@/services/import-export';
import { generateId } from '@/utils/id-generator';

const isWindows = navigator.userAgent.includes('Windows');

const confirm = useConfirm();
const collectionsStore = useCollectionsStore();
const requestsStore = useRequestsStore();

const props = defineProps({
  searchQuery: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['add-request', 'open-request', 'request-added', 'request-deleted', 'request-duplicated']);

// Store
const collections = computed(() => collectionsStore.collections);

// Tree state
const expandedKeys = ref({});
const selectedKeys = ref({});
const lastSelectedKey = ref(null);
const lastSelectedNode = ref(null);
const isRestoringSelection = ref(false); // Flag to prevent watch loop

// Dialog state
const showCreateDialog = ref(false);
const dialogMode = ref('collection');
const newItemName = ref('');
const newItemDescription = ref('');

// Rename dialog
const showRenameDialog = ref(false);
const renameItemName = ref('');
const renamingItem = ref(null);

// Context menu
const contextMenu = ref(null);
const contextMenuNode = ref(null);

// Move dialog
const showMoveDialog = ref(false);
const movingRequest = ref(null);
const moveSelectedKeys = ref({});
const moveTargetCollection = ref(null);
const moveTargetFolder = ref(null);

// 将 collections 转换为 Tree 节点格式
const treeNodes = computed(() => {
  const convertToTreeNode = (item, type = 'collection', parentKey = '') => {
    const key = parentKey ? `${parentKey}/${item.id}` : `${type}/${item.id}`;
    
    const node = {
      key,
      label: item.name,
      data: { ...item, type },
      icon: type === 'collection' ? 'pi pi-folder' : 'pi pi-folder-open',
      children: []
    };

    // 合并同层级的 requests 与 folders，按 order 交错排序。
    const requests = item.requests || [];
    const folders = item.folders || [];

    const entries = [
      ...requests.map((req, idx) => ({
        order: req.order,
        idx,
        kind: 'request',
        node: {
          key: `${key}/request/${req.id}`,
          label: req.name,
          data: { ...req, type: 'request' },
          icon: 'pi pi-file',
          children: []
        }
      })),
      ...folders.map((folder, idx) => ({
        order: folder.order,
        idx,
        kind: 'folder',
        node: convertToTreeNode(folder, 'folder', key)
      }))
    ];

    // 当且仅当所有子项都带 order 时按 order 排序；否则回退到「folders 在前、requests 在后」。
    const allOrdered = entries.length > 0 && entries.every(e => typeof e.order === 'number');
    if (allOrdered) {
      entries.sort((a, b) => a.order - b.order);
    } else {
      entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
        return a.idx - b.idx;
      });
    }

    node.children = entries.map(e => e.node);

    return node;
  };

  const allNodes = collections.value.map(c => convertToTreeNode(c));

  if (!props.searchQuery) {
    return allNodes;
  }

  const query = props.searchQuery.trim().toLowerCase();

  const matchesSearch = (node) => {
    const label = (node.label || '').toLowerCase();
    if (label.includes(query)) return true;

    if (node.data?.type !== 'request') return false;
    return (node.data.url || '').toLowerCase().includes(query);
  };

  const filterNode = (node) => {
    if (matchesSearch(node)) return node;
    if (node.children && node.children.length > 0) {
      const matched = node.children.map(filterNode).filter(Boolean);
      if (matched.length > 0) return { ...node, children: matched };
    }
    return null;
  };

  return allNodes.map(filterNode).filter(Boolean);
});

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
        shortcut: 'Ctrl+D'
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
        shortcut: 'Ctrl+D'
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
const onNodeSelect = (node) => {
  console.log('[CollectionsPanel] onNodeSelect called, node:', node.key, 'lastSelectedKey BEFORE:', lastSelectedKey.value);
  // Track the selected key for preventing deselection
  lastSelectedKey.value = node.key;
  console.log('[CollectionsPanel] onNodeSelect, lastSelectedKey AFTER:', lastSelectedKey.value);

  // 如果是 request 类型，直接打开
  if (node.data.type === 'request') {
    handleOpenRequest(node);
  }
};

// Prevent deselection - once a node is selected, user can only select another node
const onNodeUnselect = (node) => {
  console.log('[CollectionsPanel] onNodeUnselect called, node:', node.key, 'lastSelectedKey:', lastSelectedKey.value, 'isRestoring:', isRestoringSelection.value);

  // If we're in the process of restoring selection, don't restore again - this breaks the infinite loop
  if (isRestoringSelection.value) {
    console.log('[CollectionsPanel] onNodeUnselect: Skipping, isRestoringSelection is true');
    return;
  }

  // Selection was cleared by user click on same node - restore it
  if (lastSelectedKey.value) {
    console.log('[CollectionsPanel] onNodeUnselect: Restoring selection to:', lastSelectedKey.value);
    isRestoringSelection.value = true;
    // Use nextTick to ensure this happens after PrimeVue's internal state updates
    nextTick(() => {
      selectedKeys.value = { [lastSelectedKey.value]: true };
      isRestoringSelection.value = false;
    });
  }
};

const onTreeContextMenu = (event) => {
  event.preventDefault();
  event.stopPropagation();
  
  // 查找被右键点击的节点内容区域
  let target = event.target;
  while (target && !target.classList.contains('p-tree-node-content')) {
    target = target.parentElement;
    if (!target || target.classList.contains('p-tree')) break;
  }
  
  if (!target || !target.classList.contains('p-tree-node-content')) return;
  
  // 通过 DOM 索引路径精确定位树节点
  // 从 treeitem 元素收集从根到当前节点的 aria-posinset 路径
  const indexPath = [];
  let treeItem = target.closest('[role="treeitem"]');
  while (treeItem) {
    const posinset = parseInt(treeItem.getAttribute('aria-posinset'), 10);
    if (!isNaN(posinset)) {
      indexPath.unshift(posinset - 1); // aria-posinset 从 1 开始
    }
    // 向上找父级 treeitem
    const parentGroup = treeItem.parentElement?.closest('[role="group"]');
    treeItem = parentGroup ? parentGroup.closest('[role="treeitem"]') : null;
  }
  
  // 根据索引路径在 treeNodes 中定位节点
  let node = null;
  let currentNodes = treeNodes.value;
  for (const idx of indexPath) {
    if (currentNodes && idx >= 0 && idx < currentNodes.length) {
      node = currentNodes[idx];
      currentNodes = node.children || [];
    } else {
      node = null;
      break;
    }
  }
  
  if (node) {
    contextMenuNode.value = {
      key: node.key,
      label: node.label,
      data: JSON.parse(JSON.stringify(node.data)),
      icon: node.icon,
      children: node.children
    };
    contextMenu.value.show(event);
  }
};

// 节点右键菜单处理（在模板中使用）
const onNodeContextMenu = (node, event) => {
  event.preventDefault();
  event.stopPropagation();
  
  // 深拷贝节点，避免引用问题
  contextMenuNode.value = {
    key: node.key,
    label: node.label,
    data: JSON.parse(JSON.stringify(node.data)),
    icon: node.icon,
    children: node.children
  };
  
  contextMenu.value.show(event);
};

// 拖拽处理
const onNodeDrop = async (event) => {
  const { value: newNodes, dragNode } = event;
  if (!dragNode || !newNodes) return;

  const draggedType = dragNode.data?.type;
  if (!draggedType) return;

  // Helper: 从树节点递归重建 folder 的 store 格式。
  // order 取子项在 children 中的下标，把可见的交错顺序持久化。
  // 注意：folder 自身的 order 由调用方按其在父级 children 中的下标赋值（见下方两处 map），
  // 故此处不设置 order，避免写入拖拽前的过时值。
  const extractFolderData = (folderNode) => {
    const children = folderNode.children || [];
    return {
      id: folderNode.data.id,
      name: folderNode.data.name,
      description: folderNode.data.description || '',
      requests: children
        .map((c, idx) => ({ c, idx }))
        .filter(({ c }) => c.data.type === 'request')
        .map(({ c, idx }) => ({ id: c.data.id, name: c.data.name, method: c.data.method, url: c.data.url, order: idx })),
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
  let newCollectionId = null;
  let newFolderId = null;

  const scanFolder = (folderNode, collId) => {
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
    await collectionsStore.loadCollections();
    return;
  }

  // Folder 拖拽：不允许跨 collection 移动，只做同 collection 内排序
  if (draggedType === 'folder' && oldCollectionId !== newCollectionId) {
    await collectionsStore.loadCollections();
    return;
  }

  // 更新受影响的 collection
  const affectedIds = new Set([oldCollectionId, newCollectionId]);
  for (const collNode of newNodes) {
    if (!affectedIds.has(collNode.data.id)) continue;
    const children = collNode.children || [];
    const newRequests = children
      .map((c, idx) => ({ c, idx }))
      .filter(({ c }) => c.data.type === 'request')
      .map(({ c, idx }) => ({ id: c.data.id, name: c.data.name, method: c.data.method, url: c.data.url, order: idx }));
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
let ptrDrag = null;

const cloneTreeNodes = (nodes) => nodes.map(n => ({
  ...n, data: { ...n.data }, children: cloneTreeNodes(n.children || [])
}));

const computeDropResult = (tree, dragKey, targetKey, position) => {
  if (targetKey === dragKey || targetKey.startsWith(dragKey + '/')) return null;
  const newTree = cloneTreeNodes(tree);
  let dragNode = null;
  const remove = (nodes) => {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].key === dragKey) { [dragNode] = nodes.splice(i, 1); return true; }
      if (remove(nodes[i].children || [])) return true;
    }
    return false;
  };
  remove(newTree);
  if (!dragNode) return null;
  if (position === 'inside') {
    const insertInside = (nodes) => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].key === targetKey) { (nodes[i].children = nodes[i].children || []).push(dragNode); return true; }
        if (insertInside(nodes[i].children || [])) return true;
      }
      return false;
    };
    return insertInside(newTree) ? newTree : null;
  }
  const insert = (nodes) => {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].key === targetKey) { nodes.splice(position === 'before' ? i : i + 1, 0, dragNode); return true; }
      if (insert(nodes[i].children || [])) return true;
    }
    return false;
  };
  return insert(newTree) ? newTree : null;
};

const onNodePointerDown = (node, event) => {
  if (!isWindows || event.button !== 0) return;
  ptrDrag = { node, startX: event.clientX, startY: event.clientY, active: false, ghostEl: null, lineEl: null, targetKey: null, position: 'after' };
};

const onGlobalPointerMove = (event) => {
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
  event.preventDefault();
  ptrDrag.ghostEl.style.left = `${event.clientX + 14}px`;
  ptrDrag.ghostEl.style.top = `${event.clientY - 14}px`;

  ptrDrag.ghostEl.style.visibility = 'hidden';
  const els = document.elementsFromPoint(event.clientX, event.clientY);
  ptrDrag.ghostEl.style.visibility = '';

  const treeItemEl = els.find(el => el.getAttribute('role') === 'treeitem');
  if (!treeItemEl) { ptrDrag.targetKey = null; ptrDrag.lineEl.style.display = 'none'; return; }

  const indexPath = [];
  let el = treeItemEl;
  while (el) {
    const pos = parseInt(el.getAttribute('aria-posinset'), 10);
    if (!isNaN(pos)) indexPath.unshift(pos - 1);
    const parentGroup = el.parentElement?.closest('[role="group"]');
    el = parentGroup ? parentGroup.closest('[role="treeitem"]') : null;
  }
  let targetNode = null;
  let nodes = treeNodes.value;
  for (const idx of indexPath) {
    if (nodes && idx >= 0 && idx < nodes.length) { targetNode = nodes[idx]; nodes = targetNode.children || []; }
    else { targetNode = null; break; }
  }
  if (!targetNode || targetNode.key === ptrDrag.node.key) { ptrDrag.targetKey = null; ptrDrag.lineEl.style.display = 'none'; return; }

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
    Object.assign(ptrDrag.lineEl.style, { display: 'block', left: `${rect.left + 16}px`, width: `${rect.width - 16}px`, top: `${rect.bottom - 1}px` });
  } else {
    const lineY = dropPos === 'before' ? rect.top : rect.bottom;
    Object.assign(ptrDrag.lineEl.style, { display: 'block', left: `${rect.left}px`, width: `${rect.width}px`, top: `${lineY - 1}px` });
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

// 禁用方向键导航
const onTreeKeyDown = (event) => {
  // 阻止方向键的默认行为
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
  }
};

// 全局键盘快捷键处理
const handleKeyDown = (event) => {
  // 如果用户在输入框中，不要拦截键盘事件
  const target = event.target;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
    return;
  }

  // Escape: cancel active pointer drag
  if (event.key === 'Escape' && ptrDrag?.active) {
    ptrDrag.ghostEl?.remove();
    ptrDrag.lineEl?.remove();
    ptrDrag = null;
    return;
  }

  // 检查是否有选中的节点
  const selectedKey = Object.keys(selectedKeys.value)[0];
  if (!selectedKey) return;
  
  // 查找选中的节点
  const findNodeByKey = (nodes, key) => {
    for (const node of nodes) {
      if (node.key === key) return node;
      if (node.children && node.children.length > 0) {
        const found = findNodeByKey(node.children, key);
        if (found) return found;
      }
    }
    return null;
  };
  
  const selectedNode = findNodeByKey(treeNodes.value, selectedKey);
  if (!selectedNode) return;
  
  // Ctrl+D: Duplicate
  if (event.ctrlKey && event.key === 'd') {
    event.preventDefault();
    event.stopPropagation();
    
    // 设置 contextMenuNode 为选中的节点
    contextMenuNode.value = {
      key: selectedNode.key,
      label: selectedNode.label,
      data: JSON.parse(JSON.stringify(selectedNode.data)),
      icon: selectedNode.icon,
      children: selectedNode.children
    };
    
    handleDuplicate();
  }
  
  // Delete: Delete
  if (event.key === 'Delete') {
    event.preventDefault();
    event.stopPropagation();
    
    // 设置 contextMenuNode 为选中的节点
    contextMenuNode.value = {
      key: selectedNode.key,
      label: selectedNode.label,
      data: JSON.parse(JSON.stringify(selectedNode.data)),
      icon: selectedNode.icon,
      children: selectedNode.children
    };
    
    handleDelete();
  }
};

// Auto-expand all nodes when filtering so matched requests are visible
watch(() => props.searchQuery, (newQuery) => {
  if (!newQuery) return;
  const expandAll = (nodes, acc = {}) => {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        acc[node.key] = true;
        expandAll(node.children, acc);
      }
    }
    return acc;
  };
  expandedKeys.value = expandAll(treeNodes.value);
});

// Watch for selection changes - only for logging, restore is handled in onNodeUnselect
watch(selectedKeys, (newVal, oldVal) => {
  const currentKeys = Object.keys(newVal || {});
  const previousKeys = Object.keys(oldVal || {});

  console.log('[CollectionsPanel] Watch: currentKeys:', currentKeys, 'previousKeys:', previousKeys, 'lastSelectedKey:', lastSelectedKey.value, 'isRestoring:', isRestoringSelection.value);
}, { deep: true });

// 挂载和卸载键盘事件监听器
onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
  if (isWindows) {
    window.addEventListener('pointermove', onGlobalPointerMove);
    window.addEventListener('pointerup', onGlobalPointerUp);
    window.addEventListener('pointercancel', onGlobalPointerUp);
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  if (isWindows) {
    window.removeEventListener('pointermove', onGlobalPointerMove);
    window.removeEventListener('pointerup', onGlobalPointerUp);
    window.removeEventListener('pointercancel', onGlobalPointerUp);
  }
});

// Helper functions
const getCollectionAndFolder = (node) => {
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
      const folder = findFolderByPath(collection.folders || [], folderIds);
      return { collection, folder };
    }
  }
  
  return { collection, folder: null };
};

const findFolderByPath = (folders, folderIds) => {
  if (!folderIds || folderIds.length === 0) return null;
  const folder = folders.find(f => f.id === folderIds[0]);
  if (!folder) return null;
  if (folderIds.length === 1) return folder;
  return findFolderByPath(folder.folders || [], folderIds.slice(1));
};

// Action handlers
const handleOpen = () => {
  if (!contextMenuNode.value) return;
  handleOpenRequest(contextMenuNode.value);
};

const handleOpenRequest = (node) => {
  const { collection, folder } = getCollectionAndFolder(node);
  if (collection) {
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
  dialogMode.value = 'folder';
  showCreateDialog.value = true;
  newItemName.value = '';
  newItemDescription.value = '';
  
  // 注意：不要在这里清除 contextMenuNode，因为 createItem 函数还需要使用它
};

const handleDuplicate = async () => {
  if (!contextMenuNode.value) return;
  const node = contextMenuNode.value;
  
  // 深拷贝节点数据，避免引用问题
  const nodeData = JSON.parse(JSON.stringify(node.data));
  
  const { collection, folder } = getCollectionAndFolder(node);
  
  if (nodeData.type === 'request') {
    await duplicateRequest(collection, nodeData, folder);
  } else if (nodeData.type === 'folder') {
    await duplicateFolder(collection, nodeData);
  } else if (nodeData.type === 'collection') {
    await duplicateCollection(nodeData);
  }
  
  // 清除 contextMenuNode 引用
  contextMenuNode.value = null;
};

const handleRename = () => {
  if (!contextMenuNode.value) return;
  // 深拷贝 node.data，避免引用问题
  renamingItem.value = JSON.parse(JSON.stringify(contextMenuNode.value.data));
  renameItemName.value = contextMenuNode.value.data.name;
  showRenameDialog.value = true;
};

const handleDelete = () => {
  if (!contextMenuNode.value) return;
  const node = contextMenuNode.value;
  
  // 深拷贝节点数据，避免引用问题
  const nodeData = JSON.parse(JSON.stringify(node.data));
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
        await collectionsStore.removeRequestReference(collection.id, nodeData.id);
        await requestsStore.deleteRequest(nodeData.id);
        // 通知 MainContent 关闭对应的 Tab
        emit('request-deleted', nodeData.id);
      } else if (nodeData.type === 'folder') {
        // 收集 folder 中的所有 request IDs
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
  const collection = JSON.parse(JSON.stringify(contextMenuNode.value.data));
  
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

const saveImportedRequests = async (requests, collectionId, rootFolderId) => {
  for (const request of requests) {
    await requestsStore.saveRequest({
      ...request,
      collectionId,
      folderId: request.folderId || rootFolderId
    });
  }
};

const importCollectionAsFolder = async (targetNode, targetCollection, targetFolder, importedCollection, importedRequests) => {
  const createdFolder = await collectionsStore.addFolder(
    targetCollection.id,
    importedCollection.name,
    targetFolder?.id || null
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

    const importedCollections = result.collections || (result.collection ? [result.collection] : []);

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
const handleReorder = async (direction) => {
  if (!contextMenuNode.value || contextMenuNode.value.data.type !== 'request') return;
  const { collection } = getCollectionAndFolder(contextMenuNode.value);
  if (!collection) return;
  await collectionsStore.reorderRequest(collection.id, contextMenuNode.value.data.id, direction);
  contextMenuNode.value = null;
};

const handleMoveRequest = () => {
  if (!contextMenuNode.value || contextMenuNode.value.data.type !== 'request') return;
  movingRequest.value = JSON.parse(JSON.stringify(contextMenuNode.value));
  moveSelectedKeys.value = {};
  moveTargetCollection.value = null;
  moveTargetFolder.value = null;
  showMoveDialog.value = true;
};

const moveTreeData = computed(() => {
  const buildNode = (item, type = 'collection', parentKey = '') => {
    const key = parentKey ? `${parentKey}/${item.id}` : `${type}/${item.id}`;
    return {
      key, label: item.name, data: { ...item, type },
      icon: type === 'collection' ? 'pi pi-folder' : 'pi pi-folder-open',
      children: (item.folders || []).map(f => buildNode(f, 'folder', key))
    };
  };
  return collections.value.map(c => buildNode(c));
});

const onMoveNodeSelect = (node) => {
  if (node.data.type === 'collection') {
    moveTargetCollection.value = node.data;
    moveTargetFolder.value = null;
  } else if (node.data.type === 'folder') {
    const parts = node.key.split('/');
    const pc = collections.value.find(c => String(c.id) === parts[1]);
    if (pc) { moveTargetCollection.value = pc; moveTargetFolder.value = node.data; }
  }
  moveSelectedKeys.value = { [node.key]: true };
};

const confirmMoveRequest = async () => {
  if (!movingRequest.value || !moveTargetCollection.value) return;
  const { collection: src } = getCollectionAndFolder(movingRequest.value);
  if (!src) return;
  try {
    await collectionsStore.moveRequestToTarget(src.id, movingRequest.value.data.id, moveTargetCollection.value.id, moveTargetFolder.value?.id);
    const fr = await requestsStore.loadRequest(movingRequest.value.data.id);
    if (fr) {
      fr.collectionId = moveTargetCollection.value.id;
      fr.folderId = moveTargetFolder.value?.id || null;
      fr.updatedAt = new Date().toISOString();
      await requestsStore.saveRequest(fr);
    }
    showMoveDialog.value = false;
    movingRequest.value = null;
    if (window.$toast) window.$toast.add({ severity: 'success', summary: 'Moved', detail: 'Request moved successfully', life: 2000 });
  } catch (e) { console.error('Failed to move request:', e); }
};

// Duplicate functions
const duplicateRequest = async (collection, request, folder) => {
  try {
    const fullRequest = await requestsStore.loadRequest(request.id);
    if (!fullRequest) return;
    
    // 使用 JSON.parse(JSON.stringify()) 创建完全独立的深拷贝
    const clonedRequest = JSON.parse(JSON.stringify(fullRequest));
    
    // 更新克隆请求的属性
    const newRequest = {
      ...clonedRequest,
      id: generateId(),
      name: `${clonedRequest.name} (Copy)`,
      collectionId: collection.id,
      folderId: folder?.id || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // 清除所有临时属性（以 _ 开头的属性）
    Object.keys(newRequest).forEach(key => {
      if (key.startsWith('_')) {
        delete newRequest[key];
      }
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

const duplicateFolder = async (collection, folder) => {
  try {
    const folderIdMap = new Map();
    const requestIdMap = new Map();
    
    const duplicateStructure = (sourceFolder) => {
      const newFolderId = generateId();
      folderIdMap.set(sourceFolder.id, newFolderId);
      
      return {
        id: newFolderId,
        name: `${sourceFolder.name} (Copy)`,
        folders: sourceFolder.folders ? sourceFolder.folders.map(f => duplicateStructure(f)) : [],
        requests: sourceFolder.requests ? sourceFolder.requests.map(req => {
          const newRequestId = generateId();
          requestIdMap.set(req.id, newRequestId);
          return { id: newRequestId, name: req.name, method: req.method, url: req.url };
        }) : []
      };
    };
    
    const newFolder = duplicateStructure(folder);
    
    // 找到 folder 的父 folder（如果有）
    const { folder: parentFolder } = getCollectionAndFolder(contextMenuNode.value);
    
    // addFolder 返回新创建的 folder 对象
    const createdFolder = await collectionsStore.addFolder(
      collection.id, 
      newFolder.name, 
      parentFolder?.id || null
    );
    
    if (createdFolder) {
      // 更新 folderIdMap，将源 folder 的 ID 映射到实际创建的 folder ID
      folderIdMap.set(folder.id, createdFolder.id);
      
      // 更新新创建的 folder，添加子 folders 和 requests
      await collectionsStore.updateFolder(collection.id, createdFolder.id, {
        folders: newFolder.folders,
        requests: newFolder.requests
      });
      
      // 复制所有 requests 的完整数据
      const requestIds = collectAllRequestIds(folder);
      const requests = await requestsStore.loadMultipleRequests(requestIds);
      
      for (const request of requests) {
        const newRequestId = requestIdMap.get(request.id);
        if (newRequestId) {
          // 使用深拷贝创建完全独立的请求副本
          const clonedRequest = JSON.parse(JSON.stringify(request));
          
          const newRequest = {
            ...clonedRequest,
            id: newRequestId,
            collectionId: collection.id,
            folderId: request.folderId ? folderIdMap.get(request.folderId) : createdFolder.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          
          // 清除所有临时属性（以 _ 开头的属性）
          Object.keys(newRequest).forEach(key => {
            if (key.startsWith('_')) {
              delete newRequest[key];
            }
          });
          
          await requestsStore.saveRequest(newRequest);
        }
      }
      
      // 重新加载 collections 以确保数据同步
      await collectionsStore.loadCollections();
      
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

const duplicateCollection = async (collection) => {
  try {
    const newCollection = await collectionsStore.createCollection(
      `${collection.name} (Copy)`,
      collection.description
    );
    
    const requestIds = collectAllRequestIds(collection);
    const requests = await requestsStore.loadMultipleRequests(requestIds);
    
    const folderIdMap = new Map();
    const requestIdMap = new Map();
    
    const duplicateFolders = (folders) => {
      return folders.map(folder => {
        const newFolderId = generateId();
        folderIdMap.set(folder.id, newFolderId);
        
        return {
          id: newFolderId,
          name: folder.name,
          folders: folder.folders ? duplicateFolders(folder.folders) : [],
          requests: folder.requests ? folder.requests.map(req => {
            const newRequestId = generateId();
            requestIdMap.set(req.id, newRequestId);
            return { id: newRequestId, name: req.name, method: req.method, url: req.url };
          }) : []
        };
      });
    };
    
    const newFolders = collection.folders ? duplicateFolders(collection.folders) : [];
    const newRequests = collection.requests ? collection.requests.map(req => {
      const newRequestId = generateId();
      requestIdMap.set(req.id, newRequestId);
      return { id: newRequestId, name: req.name, method: req.method, url: req.url };
    }) : [];
    
    await collectionsStore.updateCollection(newCollection.id, {
      folders: newFolders,
      requests: newRequests
    });
    
    for (const request of requests) {
      const newRequestId = requestIdMap.get(request.id);
      if (newRequestId) {
        // 使用深拷贝创建完全独立的请求副本
        const clonedRequest = JSON.parse(JSON.stringify(request));
        
        const newRequest = {
          ...clonedRequest,
          id: newRequestId,
          collectionId: newCollection.id,
          folderId: request.folderId ? folderIdMap.get(request.folderId) : null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        // 清除所有临时属性（以 _ 开头的属性）
        Object.keys(newRequest).forEach(key => {
          if (key.startsWith('_')) {
            delete newRequest[key];
          }
        });
        
        await requestsStore.saveRequest(newRequest);
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

// 检查请求名称是否在同一目录下重复
const isRequestNameDuplicate = (collectionId, folderId, requestName, excludeRequestId = null) => {
  const collection = collections.value.find(c => c.id === collectionId);
  if (!collection) return false;
  
  // 获取目标目录下的所有请求
  let requests = [];
  if (folderId) {
    // 在指定 folder 中查找
    const findFolder = (folders, targetId) => {
      for (const folder of folders) {
        if (folder.id === targetId) return folder;
        if (folder.folders && folder.folders.length > 0) {
          const found = findFolder(folder.folders, targetId);
          if (found) return found;
        }
      }
      return null;
    };
    const folder = findFolder(collection.folders || [], folderId);
    requests = folder?.requests || [];
  } else {
    // 在 collection 根目录下查找
    requests = collection.requests || [];
  }
  
  // 检查是否有同名请求（排除当前请求自己）
  return requests.some(req => 
    req.name.toLowerCase() === requestName.toLowerCase() && 
    req.id !== excludeRequestId
  );
};

// Rename
const renameItem = async () => {
  if (!renameItemName.value.trim() || !renamingItem.value || isRenameNameDuplicate.value) return;
  
  const item = renamingItem.value;
  const newName = renameItemName.value.trim();
  
  try {
    if (item.type === 'collection') {
      await collectionsStore.updateCollection(item.id, { name: newName });
    } else if (item.type === 'folder') {
      const collection = collections.value.find(c => 
        findFolderInCollection(c, item.id)
      );
      if (collection) {
        await collectionsStore.updateFolder(collection.id, item.id, { name: newName });
      }
    } else if (item.type === 'request') {
      // 先加载完整的 request 数据
      const fullRequest = await requestsStore.loadRequest(item.id);
      if (!fullRequest) {
        console.error('Request not found:', item.id);
        if (window.$toast) {
          window.$toast.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Request not found',
            life: 3000
          });
        }
        return;
      }
      
      // 检查名称是否重复
      if (isRequestNameDuplicate(fullRequest.collectionId, fullRequest.folderId, newName, fullRequest.id)) {
        if (window.$toast) {
          window.$toast.add({
            severity: 'warn',
            summary: 'Duplicate Name',
            detail: 'A request with this name already exists in the same location',
            life: 3000
          });
        }
        return;
      }
      
      // 更新完整的 request 对象
      const updatedRequest = {
        ...fullRequest,
        name: newName,
        updatedAt: new Date().toISOString()
      };
      await requestsStore.saveRequest(updatedRequest);
      
      // 更新 collection 中的引用
      if (fullRequest.collectionId) {
        await collectionsStore.updateRequestReference(
          fullRequest.collectionId,
          fullRequest.id,
          newName,
          fullRequest.method,
          fullRequest.url,
          fullRequest.folderId
        );
      }
    }
    
    showRenameDialog.value = false;
    renamingItem.value = null;
    renameItemName.value = '';
    
    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: 'Renamed successfully',
        life: 3000
      });
    }
  } catch (error) {
    console.error('Failed to rename:', error);
  }
};

// Helper functions
const findFolderInCollection = (collection, folderId) => {
  const search = (folders) => {
    for (const folder of folders) {
      if (folder.id === folderId) return true;
      if (folder.folders && search(folder.folders)) return true;
    }
    return false;
  };
  return collection ? search(collection.folders || []) : false;
};

// 查找同级 folders
const findSiblingFolders = (collection, folderId) => {
  const search = (folders) => {
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
};

const collectAllRequestIds = (item) => {
  const ids = [];
  if (item.requests && Array.isArray(item.requests)) {
    ids.push(...item.requests.map(r => r.id));
  }
  if (item.folders && Array.isArray(item.folders)) {
    for (const folder of item.folders) {
      ids.push(...collectAllRequestIds(folder));
    }
  }
  return ids;
};

// Create dialog
const openCreateDialog = (mode = 'collection') => {
  dialogMode.value = mode;
  showCreateDialog.value = true;
  newItemName.value = '';
  newItemDescription.value = '';
};

// 检查新建名称是否重复
const isCreateNameDuplicate = computed(() => {
  if (!newItemName.value.trim()) return false;
  const name = newItemName.value.trim().toLowerCase();
  if (dialogMode.value === 'collection') {
    return collections.value.some(c => c.name.toLowerCase() === name);
  }
  return false;
});

// 检查重命名名称是否重复
const isRenameNameDuplicate = computed(() => {
  if (!renameItemName.value.trim() || !renamingItem.value) return false;
  const name = renameItemName.value.trim().toLowerCase();
  const item = renamingItem.value;
  if (name === item.name.toLowerCase()) return false;
  if (item.type === 'collection') {
    return collections.value.some(c => c.name.toLowerCase() === name && c.id !== item.id);
  }
  if (item.type === 'folder') {
    const col = collections.value.find(c => findFolderInCollection(c, item.id));
    if (!col) return false;
    const siblings = findSiblingFolders(col, item.id);
    return siblings.some(f => f.name.toLowerCase() === name && f.id !== item.id);
  }
  if (item.type === 'request') {
    return isRequestNameDuplicate(item.collectionId, item.folderId, renameItemName.value.trim(), item.id);
  }
  return false;
});

const createItem = async () => {
  if (!newItemName.value.trim() || isCreateNameDuplicate.value) return;
  
  try {
    if (dialogMode.value === 'collection') {
      await collectionsStore.createCollection(
        newItemName.value.trim(),
        newItemDescription.value.trim()
      );
    } else if (dialogMode.value === 'folder' && contextMenuNode.value) {
      const { collection, folder } = getCollectionAndFolder(contextMenuNode.value);
      await collectionsStore.addFolder(
        collection.id,
        newItemName.value.trim(),
        folder?.id
      );
    }
    
    showCreateDialog.value = false;
    newItemName.value = '';
    newItemDescription.value = '';
  } catch (error) {
    console.error('Failed to create item:', error);
  }
};

// 选中指定的 request 节点
const selectRequestNode = (requestId, collectionId, folderId) => {
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
  
  // 展开父节点
  const expandParents = (nodeKey) => {
    const parts = nodeKey.split('/');
    const newExpandedKeys = { ...expandedKeys.value };
    
    // 展开所有父节点
    for (let i = 2; i < parts.length - 1; i += 2) {
      const parentKey = parts.slice(0, i + 1).join('/');
      newExpandedKeys[parentKey] = true;
    }
    
    expandedKeys.value = newExpandedKeys;
  };
  
  expandParents(key);
  
  // 选中节点
  selectedKeys.value = { [key]: true };
};

// 查找 folder 的路径
const findFolderPath = (folders, targetId, currentPath = []) => {
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
    <div class="mb-2 flex-shrink-0">
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

    <Dialog 
      v-model:visible="showCreateDialog"
      :header="dialogMode === 'collection' ? 'New Collection' : 'New Folder'"
      :modal="true"
      :style="{ width: '25rem' }"
    >
      <div class="flex flex-col gap-4">
        <div>
          <label class="block text-sm font-medium mb-2">Name</label>
          <InputText 
            v-model="newItemName"
            placeholder="Enter a name"
            class="w-full"
            :invalid="isCreateNameDuplicate"
            autofocus
          />
          <small v-if="isCreateNameDuplicate" class="text-red-500">
            This name already exists
          </small>
        </div>
        <div v-if="dialogMode === 'collection'">
          <label class="block text-sm font-medium mb-2">Description (optional)</label>
          <InputText 
            v-model="newItemDescription"
            placeholder="Enter a description"
            class="w-full"
          />
        </div>
      </div>
      
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="showCreateDialog = false" />
        <Button 
          label="Create"
          @click="createItem"
          :disabled="!newItemName.trim() || isCreateNameDuplicate"
        />
      </template>
    </Dialog>

    <Dialog 
      v-model:visible="showRenameDialog"
      header="Rename"
      :modal="true"
      :style="{ width: '25rem' }"
    >
      <div class="flex flex-col gap-4">
        <div>
          <label class="block text-sm font-medium mb-2">Name</label>
          <InputText 
            v-model="renameItemName"
            placeholder="Enter a new name"
            class="w-full"
            :invalid="isRenameNameDuplicate"
            autofocus
          />
          <small v-if="isRenameNameDuplicate" class="text-red-500">
            This name already exists
          </small>
        </div>
      </div>
      
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="showRenameDialog = false" />
        <Button 
          label="Rename"
          @click="renameItem"
          :disabled="!renameItemName.trim() || renameItemName.trim() === renamingItem?.name || isRenameNameDuplicate"
        />
      </template>
    </Dialog>

    <!-- Move Request Dialog -->
    <Dialog 
      v-model:visible="showMoveDialog"
      header="Move Request"
      :modal="true"
      :style="{ width: '25rem' }"
    >
      <div class="flex flex-col gap-3">
        <p class="text-sm text-surface-600 dark:text-surface-400">
          Select target location for "{{ movingRequest?.data?.name }}"
        </p>
        <div class="border border-surface-300 dark:border-surface-600 rounded p-3 max-h-64 overflow-y-auto">
          <Tree
            :value="moveTreeData"
            v-model:selectionKeys="moveSelectedKeys"
            selectionMode="single"
            @node-select="onMoveNodeSelect"
          />
        </div>
        <div v-if="moveTargetCollection" class="text-sm p-2 bg-surface-100 dark:bg-surface-800 rounded">
          <span class="font-medium">Target: </span>
          <span>{{ moveTargetCollection.name }}</span>
          <span v-if="moveTargetFolder"> / {{ moveTargetFolder.name }}</span>
        </div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="showMoveDialog = false" />
        <Button label="Move" @click="confirmMoveRequest" :disabled="!moveTargetCollection" />
      </template>
    </Dialog>
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
