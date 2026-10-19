<script setup lang="ts">
import { dialogStyle } from '@/utils/dialogSize';
import { computed, ref, watch } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { usePointerTreeDrag } from '@/composables/usePointerTreeDrag';
import { useWorkflowsStore } from '@/stores/workflows';
import { collectExpandableKeys, findNodeByIndexPath, treeItemIndexPath } from '@/utils/treeDrop';
import {
  buildWorkflowTree,
  collectFolderWorkflowIds,
  findParentFolderId,
  findWorkflowFolder,
  isWorkflowFolderNameTaken,
  layoutFromTree,
  type WorkflowTreeNode,
} from '@/utils/workflowTree';

const props = withDefaults(defineProps<{ searchQuery?: string }>(), { searchQuery: '' });

const emit = defineEmits<{
  'open-workflow': [payload: { workflowId: string }];
  'workflow-deleted': [workflowId: string];
}>();

// WebView2（Windows）不能可靠地支持 HTML5 拖放，改用指针事件模拟
const isWindows = navigator.userAgent.includes('Windows');

const confirm = useConfirm();
const workflowsStore = useWorkflowsStore();

const isSearching = computed(() => props.searchQuery.trim().length > 0);

const treeNodes = computed(() => buildWorkflowTree(workflowsStore.layout, workflowsStore.workflows, props.searchQuery));

// 搜索时展开全部，结束搜索后恢复原来的展开状态
const expandedKeys = ref<Record<string, boolean>>({});
const displayedExpandedKeys = computed({
  get: () => (isSearching.value ? collectExpandableKeys(treeNodes.value) : expandedKeys.value),
  set: (keys: Record<string, boolean>) => {
    if (!isSearching.value) expandedKeys.value = keys;
  },
});

const workflowKey = (nodes: WorkflowTreeNode[], workflowId: string): string | null => {
  for (const node of nodes) {
    if (node.data.type === 'workflow' && node.data.id === workflowId) return node.key;
    const found = workflowKey(node.children, workflowId);
    if (found) return found;
  }
  return null;
};

const folderKey = (nodes: WorkflowTreeNode[], folderId: string): string | null => {
  for (const node of nodes) {
    if (node.data.type === 'folder' && node.data.id === folderId) return node.key;
    const found = folderKey(node.children, folderId);
    if (found) return found;
  }
  return null;
};

/** 展开节点的全部上级文件夹（key 按层级拼接，每个前缀都是一个上级） */
const expandAncestors = (key: string, includeSelf = false) => {
  const parts = key.split('/');
  const next = { ...expandedKeys.value };
  const depth = includeSelf ? parts.length : parts.length - 1;
  for (let i = 1; i <= depth; i++) {
    next[parts.slice(0, i).join('/')] = true;
  }
  expandedKeys.value = next;
};

const activeKey = computed(() => (
  workflowsStore.activeWorkflowId ? workflowKey(treeNodes.value, workflowsStore.activeWorkflowId) : null
));
const selectionKeys = computed(() => (activeKey.value ? { [activeKey.value]: true } : {}));

// 打开的 Workflow 在折叠的文件夹中时展开它的上级
watch(activeKey, key => {
  if (key && !isSearching.value) expandAncestors(key);
}, { immediate: true });

const openWorkflow = (workflowId: string) => {
  workflowsStore.activeWorkflowId = workflowId;
  emit('open-workflow', { workflowId });
};

const toggleFolder = (node: WorkflowTreeNode) => {
  if (isSearching.value) return;
  const next = { ...expandedKeys.value };
  if (next[node.key]) delete next[node.key];
  else next[node.key] = true;
  expandedKeys.value = next;
};

const onNodeSelect = (node: WorkflowTreeNode) => {
  if (node.data.type === 'workflow') openWorkflow(node.data.id);
  else toggleFolder(node);
};

// 拖放：Workflow 不能包含子节点；搜索时只显示部分节点，不允许拖放
const onNodeDrop = async (event: { value: WorkflowTreeNode[] }) => {
  if (isSearching.value) return;
  await workflowsStore.setLayout(layoutFromTree(event.value));
};

const { onNodePointerDown, cancelPointerDrag } = usePointerTreeDrag(treeNodes, isWindows, {
  dropPosition: (_dragNode, targetNode, offsetRatio) => {
    if (isSearching.value) return null;
    // 文件夹的上下边缘放在它前后，中间放进去
    if (targetNode.data.type === 'folder' && offsetRatio > 0.25 && offsetRatio < 0.75) return 'inside';
    return offsetRatio < 0.5 ? 'before' : 'after';
  },
  onDrop: newTree => onNodeDrop({ value: newTree }),
});

const onTreeKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && cancelPointerDrag()) {
    event.stopPropagation();
  }
};

// 名称对话框：新建或重命名 Workflow、文件夹
type NameDialogMode = 'create-workflow' | 'create-folder' | 'rename-workflow' | 'rename-folder';

interface NameDialogState {
  mode: NameDialogMode;
  /** 新建时所在的文件夹，null 为根目录 */
  parentId: string | null;
  /** 重命名的 Workflow 或文件夹 */
  targetId: string | null;
  originalName: string;
}

const NAME_DIALOG_TEXT: Record<NameDialogMode, { header: string; placeholder: string; action: string }> = {
  'create-workflow': { header: 'New Workflow', placeholder: 'Enter a name', action: 'Create' },
  'create-folder': { header: 'New Folder', placeholder: 'Enter a name', action: 'Create' },
  'rename-workflow': { header: 'Rename Workflow', placeholder: 'Enter a new name', action: 'Rename' },
  'rename-folder': { header: 'Rename Folder', placeholder: 'Enter a new name', action: 'Rename' },
};

const showNameDialog = ref(false);
const nameDialog = ref<NameDialogState>({ mode: 'create-workflow', parentId: null, targetId: null, originalName: '' });
const nameInput = ref('');
const nameDialogText = computed(() => NAME_DIALOG_TEXT[nameDialog.value.mode]);

const isNameDuplicate = computed(() => {
  const name = nameInput.value.trim().toLowerCase();
  const { mode, parentId, targetId, originalName } = nameDialog.value;
  if (!name) return false;
  if (mode.startsWith('rename') && name === originalName.toLowerCase()) return false;
  if (mode === 'create-folder') return isWorkflowFolderNameTaken(workflowsStore.layout, parentId, name);
  if (mode === 'rename-folder') {
    const folderParentId = targetId ? findParentFolderId(workflowsStore.layout, targetId) ?? null : null;
    return isWorkflowFolderNameTaken(workflowsStore.layout, folderParentId, name, targetId);
  }
  // Workflow 名称在全部 Workflow 中唯一（AI 按名称查找）
  return workflowsStore.workflows.some(workflow => workflow.name.toLowerCase() === name && workflow.id !== targetId);
});

const canSubmitName = computed(() => {
  const name = nameInput.value.trim();
  if (!name || isNameDuplicate.value) return false;
  return !nameDialog.value.mode.startsWith('rename') || name !== nameDialog.value.originalName;
});

const openNameDialog = (state: NameDialogState) => {
  nameDialog.value = state;
  nameInput.value = state.originalName;
  showNameDialog.value = true;
};

const openCreateWorkflowDialog = (parentId: string | null = null) => {
  openNameDialog({ mode: 'create-workflow', parentId, targetId: null, originalName: '' });
};

const openCreateFolderDialog = (parentId: string | null = null) => {
  openNameDialog({ mode: 'create-folder', parentId, targetId: null, originalName: '' });
};

const openRenameDialog = (node: WorkflowTreeNode) => {
  const mode = node.data.type === 'folder' ? 'rename-folder' : 'rename-workflow';
  openNameDialog({ mode, parentId: null, targetId: node.data.id, originalName: node.data.name });
};

const expandFolder = (folderId: string | null) => {
  const key = folderId ? folderKey(treeNodes.value, folderId) : null;
  if (key) expandAncestors(key, true);
};

const submitNameDialog = async () => {
  if (!canSubmitName.value) return;
  const name = nameInput.value.trim();
  const { mode, parentId, targetId } = nameDialog.value;
  showNameDialog.value = false;

  if (mode === 'create-workflow') {
    const workflow = await workflowsStore.createWorkflow(name, parentId);
    expandFolder(parentId);
    emit('open-workflow', { workflowId: workflow.id });
  } else if (mode === 'create-folder') {
    await workflowsStore.createFolder(name, parentId);
    expandFolder(parentId);
  } else if (mode === 'rename-folder' && targetId) {
    await workflowsStore.renameFolder(targetId, name);
  } else if (mode === 'rename-workflow' && targetId) {
    const workflow = workflowsStore.workflows.find(item => item.id === targetId);
    if (workflow) await workflowsStore.saveWorkflow({ ...workflow, name });
  }
};

const deleteNode = (node: WorkflowTreeNode) => {
  const folder = node.data.type === 'folder' ? findWorkflowFolder(workflowsStore.layout.items, node.data.id) : null;
  const workflowCount = folder ? collectFolderWorkflowIds(folder).length : 0;
  const message = workflowCount > 0
    ? `Are you sure you want to delete "${node.data.name}" and the ${workflowCount} workflow${workflowCount === 1 ? '' : 's'} in it?`
    : `Are you sure you want to delete "${node.data.name}"?`;
  confirm.require({
    message,
    header: 'Confirm Deletion',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: async () => {
      if (node.data.type === 'folder') {
        const deletedIds = await workflowsStore.deleteFolder(node.data.id);
        deletedIds.forEach(id => emit('workflow-deleted', id));
      } else {
        await workflowsStore.deleteWorkflow(node.data.id);
        emit('workflow-deleted', node.data.id);
      }
    }
  });
};

// 右键菜单
const contextMenu = ref<{ show: (event: Event) => void } | null>(null);
const contextMenuNode = ref<WorkflowTreeNode | null>(null);

const menuItems = computed(() => {
  const node = contextMenuNode.value;
  if (!node) return [];
  const common = [
    { label: 'Rename', icon: 'pi pi-pencil', command: () => openRenameDialog(node) },
    { separator: true },
    { label: 'Delete', icon: 'pi pi-trash', class: 'text-red-600', command: () => deleteNode(node) },
  ];
  if (node.data.type === 'workflow') {
    const workflowId = node.data.id;
    return [{ label: 'Open', icon: 'pi pi-external-link', command: () => openWorkflow(workflowId) }, { separator: true }, ...common];
  }
  const folderId = node.data.id;
  return [
    { label: 'New Workflow', icon: 'pi pi-plus', command: () => openCreateWorkflowDialog(folderId) },
    { label: 'New Folder', icon: 'pi pi-folder-plus', command: () => openCreateFolderDialog(folderId) },
    { separator: true },
    ...common,
  ];
});

const showContextMenu = (node: WorkflowTreeNode, event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  contextMenuNode.value = node;
  contextMenu.value?.show(event);
};

// 在行内图标以外的位置右键（如缩进区域）时按 DOM 位置找节点
const onTreeContextMenu = (event: MouseEvent) => {
  const treeItem = (event.target as HTMLElement | null)?.closest('[role="treeitem"]') || null;
  const node = treeItem ? findNodeByIndexPath(treeNodes.value, treeItemIndexPath(treeItem)) : null;
  if (node) showContextMenu(node, event);
};
</script>

<template>
  <div class="h-full min-h-0 flex flex-col overflow-hidden p-2 bg-surface-0 dark:bg-surface-950">
    <div class="mb-2 shrink-0 flex items-center gap-1">
      <Button
        label="New Workflow"
        icon="pi pi-plus"
        size="small"
        class="flex-1"
        @click="openCreateWorkflowDialog(null)"
      />
      <Button
        icon="pi pi-folder-plus"
        size="small"
        severity="secondary"
        outlined
        title="New Folder"
        aria-label="New Folder"
        @click="openCreateFolderDialog(null)"
      />
    </div>

    <div v-if="treeNodes.length === 0" class="text-surface-500 dark:text-surface-400 text-xs text-center py-4">
      {{ searchQuery ? 'No matching workflows found' : 'No workflows yet' }}
    </div>

    <div
      v-else
      class="workflow-tree flex-1 min-h-0 overflow-hidden"
      @contextmenu="onTreeContextMenu"
      @keydown="onTreeKeyDown"
    >
      <Tree
        v-model:expandedKeys="displayedExpandedKeys"
        :value="treeNodes"
        :selectionKeys="selectionKeys"
        selectionMode="single"
        :draggableNodes="!isWindows && !isSearching"
        :droppableNodes="!isWindows && !isSearching"
        scrollHeight="flex"
        class="w-full h-full min-w-0"
        @node-select="onNodeSelect"
        @node-drop="onNodeDrop"
      >
        <template #default="slotProps">
          <div
            class="flex items-center gap-1 flex-1 min-w-0 select-none"
            :data-testid="`workflow-node-${slotProps.node.data.type}`"
            @contextmenu="showContextMenu(slotProps.node, $event)"
            @pointerdown="onNodePointerDown(slotProps.node, $event)"
          >
            <span
              class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm"
              :title="slotProps.node.label"
            >{{ slotProps.node.label }}</span>
            <span class="workflow-actions flex items-center shrink-0">
              <Button
                v-if="slotProps.node.data.type === 'folder'"
                icon="pi pi-plus"
                text
                rounded
                size="small"
                severity="secondary"
                title="New Workflow in Folder"
                aria-label="New Workflow in Folder"
                @click.stop="openCreateWorkflowDialog(slotProps.node.data.id)"
              />
              <Button
                icon="pi pi-pencil"
                text
                rounded
                size="small"
                severity="secondary"
                title="Rename"
                aria-label="Rename"
                @click.stop="openRenameDialog(slotProps.node)"
              />
              <Button
                icon="pi pi-trash"
                text
                rounded
                size="small"
                severity="danger"
                title="Delete"
                aria-label="Delete"
                @click.stop="deleteNode(slotProps.node)"
              />
            </span>
          </div>
        </template>
      </Tree>
    </div>

    <ContextMenu ref="contextMenu" :model="menuItems" />

    <Dialog v-model:visible="showNameDialog" :header="nameDialogText.header" :modal="true" :style="dialogStyle('sm')">
      <div>
        <label class="block text-sm font-medium mb-2">Name</label>
        <InputText
          v-model="nameInput"
          class="w-full"
          :placeholder="nameDialogText.placeholder"
          :invalid="isNameDuplicate"
          autofocus
          @keydown.enter="submitNameDialog"
        />
        <small v-if="isNameDuplicate" class="text-red-500">This name already exists</small>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="showNameDialog = false" />
        <Button :label="nameDialogText.action" :disabled="!canSubmitName" @click="submitNameDialog" />
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

/* 名称占满整行，行内按钮靠右 */
:deep(.p-tree-node-label) {
  flex: 1;
  min-width: 0;
  display: flex;
}

/* 行内按钮只在悬停或选中时显示 */
.workflow-actions {
  opacity: 0;
}

:deep(.p-tree-node-content:hover) .workflow-actions,
:deep(.p-tree-node-content.p-tree-node-selected) .workflow-actions,
.workflow-actions:focus-within {
  opacity: 1;
}

.workflow-actions :deep(.p-button) {
  width: 1.75rem;
  height: 1.75rem;
}
</style>
