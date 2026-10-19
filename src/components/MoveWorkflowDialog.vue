<script setup lang="ts">
import { dialogStyle } from '@/utils/dialogSize';
import { computed, ref } from 'vue';
import { useWorkflowsStore } from '@/stores/workflows';
import { collectExpandableKeys } from '@/utils/treeDrop';
import { buildWorkflowFolderTree, type WorkflowTreeNode } from '@/utils/workflowTree';

interface LocationNode {
  key: string;
  label: string;
  icon: string;
  /** 目标文件夹，null 为根目录 */
  data: { folderId: string | null; path: string[] };
  children: LocationNode[];
}

const ROOT_KEY = '__root__';
const ROOT_LABEL = 'Workflows';

const workflowsStore = useWorkflowsStore();

const showMoveDialog = ref(false);
const movingWorkflow = ref<{ id: string; name: string } | null>(null);
const selectedKeys = ref<Record<string, boolean>>({});
const expandedKeys = ref<Record<string, boolean>>({});
const target = ref<LocationNode['data'] | null>(null);

const toLocation = (node: WorkflowTreeNode, parentPath: string[]): LocationNode => {
  const path = [...parentPath, node.label];
  return {
    key: node.key,
    label: node.label,
    icon: 'pi pi-folder',
    data: { folderId: node.data.id, path },
    children: node.children.map(child => toLocation(child, path)),
  };
};

const locationTree = computed<LocationNode[]>(() => [{
  key: ROOT_KEY,
  label: ROOT_LABEL,
  icon: 'pi pi-sitemap',
  data: { folderId: null, path: [ROOT_LABEL] },
  children: buildWorkflowFolderTree(workflowsStore.layout.items).map(node => toLocation(node, [ROOT_LABEL])),
}]);

const openMoveDialog = (workflow: { id: string; name: string }) => {
  movingWorkflow.value = { ...workflow };
  selectedKeys.value = {};
  expandedKeys.value = collectExpandableKeys(locationTree.value);
  target.value = null;
  showMoveDialog.value = true;
};

const onNodeSelect = (node: LocationNode) => {
  target.value = node.data;
  selectedKeys.value = { [node.key]: true };
};

const confirmMove = async () => {
  const workflow = movingWorkflow.value;
  if (!workflow || !target.value) return;
  try {
    await workflowsStore.moveWorkflowToFolder(workflow.id, target.value.folderId);
    showMoveDialog.value = false;
    movingWorkflow.value = null;
    if (window.$toast) window.$toast.add({ severity: 'success', summary: 'Moved', detail: 'Workflow moved successfully', life: 2000 });
  } catch (e) { console.error('Failed to move workflow:', e); }
};

defineExpose({ open: openMoveDialog });
</script>

<template>
  <Dialog
    v-model:visible="showMoveDialog"
    header="Move Workflow"
    :modal="true"
    :style="dialogStyle('md')"
  >
    <div class="flex flex-col gap-3">
      <p class="text-sm text-surface-600 dark:text-surface-400">
        Select target location for "{{ movingWorkflow?.name }}"
      </p>
      <div class="border border-surface-300 dark:border-surface-600 rounded p-3 max-h-64 overflow-y-auto">
        <Tree
          v-model:expandedKeys="expandedKeys"
          v-model:selectionKeys="selectedKeys"
          :value="locationTree"
          selectionMode="single"
          @node-select="onNodeSelect"
        />
      </div>
      <div v-if="target" class="text-sm p-2 bg-surface-100 dark:bg-surface-800 rounded">
        <span class="font-medium">Target: </span>
        <span>{{ target.path.join(' / ') }}</span>
      </div>
    </div>
    <template #footer>
      <Button label="Cancel" severity="secondary" @click="showMoveDialog = false" />
      <Button label="Move" :disabled="!target" @click="confirmMove" />
    </template>
  </Dialog>
</template>
