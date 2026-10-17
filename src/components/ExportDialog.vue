<script setup lang="ts">
import { cloneJson } from '@/utils/clone';
import { computed, ref } from 'vue';
import { importExportService, type CollectionExportTarget } from '@/services/import-export';
import type { Collection, Folder, Request, RequestReference } from '@/types/models';

interface ExportTreeNode {
  key: string;
  label: string;
  data: { type: 'collection' | 'folder' | 'request'; id: string; collectionId?: string; method?: string };
  icon: string;
  children?: ExportTreeNode[];
}

/** PrimeVue Tree 的勾选状态 */
type CheckState = { checked: boolean; partialChecked: boolean };
import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import { useWorkflowsStore } from '@/stores/workflows';
import { pluralize, workflowMeta } from '@/utils/transferFormat';
import { collectWorkflowRequestIds, inlineWorkflowReferences } from '@/utils/workflowTransfer';

const collectionsStore = useCollectionsStore();
const requestsStore = useRequestsStore();
const workflowsStore = useWorkflowsStore();

const showExportDialog = ref(false);
const exportTab = ref<'collections' | 'workflows'>('collections');
const exportUserSelectionKeys = ref<Record<string, CheckState>>({});
const exportExpandedKeys = ref<Record<string, boolean>>({});
const exportFormat = ref<CollectionExportTarget>('apikit');
const exportWorkflowSelection = ref<Record<string, boolean>>({});
const includeReferencedRequests = ref(true);
const isExporting = ref(false);

const collectionKey = (collectionId: string) => `collection:${collectionId}`;
const folderKey = (collectionId: string, folderId: string) => `folder:${collectionId}:${folderId}`;
const requestKey = (collectionId: string, requestId: string) => `request:${collectionId}:${requestId}`;

const buildFolderNode = (folder: Folder, collectionId: string): ExportTreeNode => ({
  key: folderKey(collectionId, folder.id),
  label: folder.name,
  data: { type: 'folder', id: folder.id, collectionId },
  icon: 'pi pi-folder',
  children: [
    ...(folder.folders || []).map(child => buildFolderNode(child, collectionId)),
    ...(folder.requests || []).map(request => buildRequestNode(request, collectionId))
  ]
});

const buildRequestNode = (request: RequestReference, collectionId: string): ExportTreeNode => ({
  key: requestKey(collectionId, request.id),
  label: request.name,
  data: { type: 'request', id: request.id, collectionId, method: request.method },
  icon: 'pi pi-send'
});

const methodBadgeClass = (method: string) => (({
  GET: 'method-get',
  POST: 'method-post',
  PUT: 'method-put',
  DELETE: 'method-delete',
  PATCH: 'method-patch',
  HEAD: 'method-head',
  OPTIONS: 'method-options'
} as Record<string, string>)[method] || 'method-default');

const exportTreeNodes = computed<ExportTreeNode[]>(() => collectionsStore.collections.map(collection => ({
  key: collectionKey(collection.id),
  label: collection.name,
  data: { type: 'collection', id: collection.id },
  icon: 'pi pi-folder-open',
  children: [
    ...(collection.folders || []).map(folder => buildFolderNode(folder, collection.id)),
    ...(collection.requests || []).map(request => buildRequestNode(request, collection.id))
  ]
})));

const getTreeKeys = (nodes: ExportTreeNode[]): string[] => nodes.flatMap(node => [
  node.key,
  ...getTreeKeys(node.children || [])
]);

const getLeafKeys = (nodes: ExportTreeNode[]): string[] => nodes.flatMap(node => (
  node.children?.length ? getLeafKeys(node.children) : [node.key]
));

const getRequestNodes = (nodes: ExportTreeNode[]): ExportTreeNode[] => nodes.flatMap(node => [
  ...(node.data.type === 'request' ? [node] : []),
  ...getRequestNodes(node.children || [])
]);

const exportTreeKeys = computed(() => getTreeKeys(exportTreeNodes.value));
const exportLeafKeys = computed(() => getLeafKeys(exportTreeNodes.value));
const exportRequestNodes = computed(() => getRequestNodes(exportTreeNodes.value));

const workflowsSupported = computed(() => exportFormat.value === 'apikit');

const selectedExportWorkflows = computed(() => (
  workflowsSupported.value
    ? workflowsStore.workflows.filter(workflow => exportWorkflowSelection.value[workflow.id])
    : []
));

// 选中的 Workflow 引用、且需要随之导出的请求节点 key
const forcedRequestKeys = computed(() => {
  if (!includeReferencedRequests.value || selectedExportWorkflows.value.length === 0) return new Set<string>();
  const ids = collectWorkflowRequestIds(selectedExportWorkflows.value);
  return new Set(exportRequestNodes.value.filter(node => ids.has(node.data.id)).map(node => node.key));
});

// 由勾选的叶子节点推算整棵树的勾选/半选状态
const computeSelectionKeys = (nodes: ExportTreeNode[], checkedLeaves: Set<string>) => {
  const result: Record<string, CheckState> = {};
  const visit = (node: ExportTreeNode): 'all' | 'partial' | 'none' => {
    if (!node.children?.length) {
      const checked = checkedLeaves.has(node.key);
      if (checked) result[node.key] = { checked: true, partialChecked: false };
      return checked ? 'all' : 'none';
    }
    const states = node.children.map(visit);
    if (states.every(state => state === 'all')) {
      result[node.key] = { checked: true, partialChecked: false };
      return 'all';
    }
    if (states.some(state => state !== 'none')) {
      result[node.key] = { checked: false, partialChecked: true };
      return 'partial';
    }
    return 'none';
  };
  nodes.forEach(visit);
  return result;
};

const exportSelectionKeys = computed({
  get: () => {
    const leaves = new Set(exportLeafKeys.value.filter(key => exportUserSelectionKeys.value[key]?.checked === true));
    forcedRequestKeys.value.forEach(key => leaves.add(key));
    return computeSelectionKeys(exportTreeNodes.value, leaves);
  },
  set: (value: Record<string, CheckState>) => {
    const next = { ...value };
    forcedRequestKeys.value.forEach(key => delete next[key]);
    exportUserSelectionKeys.value = next;
  }
});

const isAllExportSelected = computed(() => (
  exportTreeKeys.value.length > 0 &&
  exportTreeKeys.value.every(key => exportSelectionKeys.value[key]?.checked === true)
));

const isSomeExportSelected = computed(() => (
  !isAllExportSelected.value &&
  exportTreeKeys.value.some(key => exportSelectionKeys.value[key]?.checked === true)
));

const selectedRequestCount = computed(() => (
  exportRequestNodes.value.filter(node => exportSelectionKeys.value[node.key]?.checked === true).length
));

const toggleSelectAllExport = () => {
  exportUserSelectionKeys.value = isAllExportSelected.value
    ? {}
    : Object.fromEntries(exportTreeKeys.value.map(key => [key, { checked: true, partialChecked: false }]));
};

const isAllWorkflowsSelected = computed(() => (
  workflowsStore.workflows.length > 0 &&
  workflowsStore.workflows.every(workflow => exportWorkflowSelection.value[workflow.id])
));

const isSomeWorkflowsSelected = computed(() => (
  !isAllWorkflowsSelected.value &&
  workflowsStore.workflows.some(workflow => exportWorkflowSelection.value[workflow.id])
));

const selectedWorkflowCount = computed(() => (
  workflowsStore.workflows.filter(workflow => exportWorkflowSelection.value[workflow.id]).length
));

const toggleSelectAllWorkflows = () => {
  exportWorkflowSelection.value = isAllWorkflowsSelected.value
    ? {}
    : Object.fromEntries(workflowsStore.workflows.map(workflow => [workflow.id, true]));
};

const toggleExportWorkflow = (id: string) => {
  exportWorkflowSelection.value = { ...exportWorkflowSelection.value, [id]: !exportWorkflowSelection.value[id] };
};

const referencedRequestSummary = computed(() => {
  const ids = collectWorkflowRequestIds(workflowsStore.workflows.filter(workflow => exportWorkflowSelection.value[workflow.id]));
  const nodes = exportRequestNodes.value.filter(node => ids.has(node.data.id));
  const collectionNames = [...new Set(nodes.map(node => (
    collectionsStore.collections.find(collection => collection.id === node.data.collectionId)?.name
  )).filter(Boolean))];
  return { count: nodes.length, collectionNames };
});

const exportSummary = computed(() => {
  const parts = [pluralize(selectedRequestCount.value, 'request')];
  if (workflowsSupported.value) parts.push(pluralize(selectedExportWorkflows.value.length, 'workflow'));
  return parts.join(' · ');
});

const canExport = computed(() => selectedRequestCount.value > 0 || selectedExportWorkflows.value.length > 0);

const openExportDialog = () => {
  exportUserSelectionKeys.value = {};
  exportWorkflowSelection.value = {};
  exportExpandedKeys.value = Object.fromEntries(
    collectionsStore.collections.map(collection => [collectionKey(collection.id), true])
  );
  exportFormat.value = 'apikit';
  exportTab.value = 'collections';
  includeReferencedRequests.value = true;
  showExportDialog.value = true;
};

const closeExportDialog = () => {
  showExportDialog.value = false;
  exportUserSelectionKeys.value = {};
  exportWorkflowSelection.value = {};
};

const setExportFormat = (format: CollectionExportTarget) => {
  exportFormat.value = format;
  if (format === 'postman') exportTab.value = 'collections';
};

const isNodeChecked = (key: string) => exportSelectionKeys.value[key]?.checked === true;

const collectFolderRequestIds = (folder: Folder, ids: Set<string>): void => {
  (folder.requests || []).forEach(request => ids.add(request.id));
  (folder.folders || []).forEach(child => collectFolderRequestIds(child, ids));
};

const collectCollectionRequestIds = (collection: Collection, ids: Set<string>) => {
  (collection.requests || []).forEach(request => ids.add(request.id));
  (collection.folders || []).forEach(folder => collectFolderRequestIds(folder, ids));
};

const filterFolderForExport = (folder: Folder, collectionId: string, selectedRequestIds: Set<string>): Folder | null => {
  if (isNodeChecked(folderKey(collectionId, folder.id))) {
    collectFolderRequestIds(folder, selectedRequestIds);
    return cloneJson(folder);
  }

  const requests = (folder.requests || []).filter(request => {
    const selected = isNodeChecked(requestKey(collectionId, request.id));
    if (selected) selectedRequestIds.add(request.id);
    return selected;
  });

  const folders = (folder.folders || [])
    .map(child => filterFolderForExport(child, collectionId, selectedRequestIds))
    .filter((child): child is Folder => child !== null);

  if (requests.length === 0 && folders.length === 0) {
    return null;
  }

  return {
    ...cloneJson(folder),
    folders,
    requests
  };
};

const buildExportSelection = () => {
  const selectedRequestIds = new Set<string>();
  const selectedCollections: Collection[] = [];

  for (const collection of collectionsStore.collections) {
    if (isNodeChecked(collectionKey(collection.id))) {
      collectCollectionRequestIds(collection, selectedRequestIds);
      selectedCollections.push(cloneJson(collection));
      continue;
    }

    const requests = (collection.requests || []).filter(request => {
      const selected = isNodeChecked(requestKey(collection.id, request.id));
      if (selected) selectedRequestIds.add(request.id);
      return selected;
    });

    const folders = (collection.folders || [])
      .map(folder => filterFolderForExport(folder, collection.id, selectedRequestIds))
      .filter((folder): folder is Folder => folder !== null);

    if (requests.length > 0 || folders.length > 0) {
      selectedCollections.push({
        ...cloneJson(collection),
        folders,
        requests
      });
    }
  }

  return { selectedCollections, selectedRequestIds };
};

const handleExport = async () => {
  const { selectedCollections, selectedRequestIds } = buildExportSelection();
  const workflows = cloneJson(selectedExportWorkflows.value);

  if (selectedRequestIds.size === 0 && workflows.length === 0) {
    window.$toast?.add({
      severity: 'warn',
      summary: 'Warning',
      detail: 'Please select at least one request or workflow',
      life: 3000
    });
    return;
  }

  isExporting.value = true;

  try {
    // 引用了但未导出的请求也要加载，用来转成 inline 请求
    const neededIds = new Set([...selectedRequestIds, ...collectWorkflowRequestIds(workflows)]);
    const loadedRequests = await requestsStore.loadMultipleRequests(Array.from(neededIds));
    const requestMap = new Map<string, Request>(loadedRequests.map(request => [request.id, request]));

    const exported = await importExportService.exportBundle({
      collections: selectedCollections,
      requests: loadedRequests.filter(request => selectedRequestIds.has(request.id)),
      workflows: workflows.map(workflow => inlineWorkflowReferences(workflow, requestMap, selectedRequestIds))
    }, exportFormat.value);

    if (!exported) return;

    window.$toast?.add({
      severity: 'success',
      summary: 'Success',
      detail: `Exported ${[
        selectedRequestIds.size > 0 ? pluralize(selectedRequestIds.size, 'request') : '',
        workflows.length > 0 ? pluralize(workflows.length, 'workflow') : ''
      ].filter(Boolean).join(' and ')}`,
      life: 3000
    });
    closeExportDialog();
  } catch (error) {
    console.error('Failed to export selection:', error);
    window.$toast?.add({
      severity: 'error',
      summary: 'Export Failed',
      detail: 'Failed to export selected data',
      life: 5000
    });
  } finally {
    isExporting.value = false;
  }
};

defineExpose({ open: openExportDialog });
</script>

<template>
  <!-- Export Dialog -->
  <Dialog
    v-model:visible="showExportDialog"
    header="Export"
    :modal="true"
    :style="{ width: '42rem' }"
    @hide="closeExportDialog"
  >
    <div class="flex flex-col gap-3">
      <div>
        <label class="block text-sm font-medium mb-2">Export Format</label>
        <div class="flex flex-wrap gap-4">
          <label class="flex items-center cursor-pointer">
            <RadioButton
              :modelValue="exportFormat"
              inputId="format-apikit"
              value="apikit"
              @update:modelValue="setExportFormat"
            />
            <span class="ml-2">ApiKit JSON</span>
          </label>
          <label class="flex items-center cursor-pointer">
            <RadioButton
              :modelValue="exportFormat"
              inputId="format-postman"
              value="postman"
              @update:modelValue="setExportFormat"
            />
            <span class="ml-2">Postman</span>
            <span class="ml-1 text-xs text-surface-500 dark:text-surface-400">(collections only)</span>
          </label>
        </div>
      </div>

      <div class="transfer-tabs">
        <button
          type="button"
          class="transfer-tab"
          :class="{ active: exportTab === 'collections' }"
          @click="exportTab = 'collections'"
        >
          Collections
          <span class="transfer-count">{{ selectedRequestCount }} / {{ exportRequestNodes.length }}</span>
        </button>
        <button
          type="button"
          class="transfer-tab"
          :class="{ active: exportTab === 'workflows' }"
          :disabled="!workflowsSupported"
          :title="workflowsSupported ? '' : 'Postman format does not support workflows'"
          @click="exportTab = 'workflows'"
        >
          Workflows
          <span class="transfer-count">{{ selectedWorkflowCount }} / {{ workflowsStore.workflows.length }}</span>
        </button>
      </div>

      <template v-if="exportTab === 'collections'">
        <div class="flex items-center justify-between gap-3">
          <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              class="h-4 w-4 accent-primary"
              :checked="isAllExportSelected"
              :indeterminate="isSomeExportSelected"
              :disabled="exportTreeNodes.length === 0"
              @change="toggleSelectAllExport"
            />
            <span>Select all</span>
          </label>
          <span class="text-xs text-surface-500 dark:text-surface-400">
            {{ pluralize(selectedRequestCount, 'request') }} selected
          </span>
        </div>

        <div class="border border-surface-200 dark:border-surface-700 rounded overflow-hidden">
          <Tree
            v-if="exportTreeNodes.length > 0"
            v-model:selectionKeys="exportSelectionKeys"
            v-model:expandedKeys="exportExpandedKeys"
            :value="exportTreeNodes"
            selectionMode="checkbox"
            class="w-full max-h-96 overflow-auto"
          >
            <template #default="{ node }">
              <span v-if="node.data.type === 'request'" class="export-request-node">
                <span class="method-badge" :class="methodBadgeClass(node.data.method)">
                  {{ node.data.method }}
                </span>
                <span>{{ node.label }}</span>
                <span v-if="forcedRequestKeys.has(node.key)" class="transfer-tag info">used by workflow</span>
              </span>
              <span v-else>{{ node.label }}</span>
            </template>
          </Tree>
          <div v-else class="p-4 text-sm text-surface-500 dark:text-surface-400">
            No collections available.
          </div>
        </div>

        <div v-if="forcedRequestKeys.size > 0" class="transfer-note info">
          <i class="pi pi-info-circle mt-0.5"></i>
          <span>
            Requests marked "used by workflow" are exported because the selected workflows use them.
            To leave them out, turn off "Include referenced requests" on the Workflows tab.
          </span>
        </div>
        <div v-if="!workflowsSupported" class="transfer-note warn">
          <i class="pi pi-exclamation-triangle mt-0.5"></i>
          <span>Postman format does not support workflows. Only the selected requests are exported.</span>
        </div>
      </template>

      <template v-else>
        <div class="flex items-center justify-between gap-3">
          <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              class="h-4 w-4 accent-primary"
              :checked="isAllWorkflowsSelected"
              :indeterminate="isSomeWorkflowsSelected"
              :disabled="workflowsStore.workflows.length === 0"
              @change="toggleSelectAllWorkflows"
            />
            <span>Select all</span>
          </label>
          <span class="text-xs text-surface-500 dark:text-surface-400">
            {{ pluralize(selectedWorkflowCount, 'workflow') }} selected
          </span>
        </div>

        <div class="transfer-list">
          <label v-for="workflow in workflowsStore.workflows" :key="workflow.id" class="transfer-row">
            <input
              type="checkbox"
              class="h-4 w-4 accent-primary shrink-0"
              :checked="!!exportWorkflowSelection[workflow.id]"
              @change="toggleExportWorkflow(workflow.id)"
            />
            <span class="flex-1 min-w-0 truncate">{{ workflow.name }}</span>
            <span class="transfer-meta">{{ workflowMeta(workflow) }}</span>
          </label>
          <div v-if="workflowsStore.workflows.length === 0" class="p-4 text-sm text-surface-500 dark:text-surface-400">
            No workflows available.
          </div>
        </div>

        <label class="flex items-start gap-2 text-sm cursor-pointer select-none">
          <input v-model="includeReferencedRequests" type="checkbox" class="h-4 w-4 mt-0.5 accent-primary shrink-0" />
          <span>
            Include referenced requests
            <span class="block text-xs text-surface-500 dark:text-surface-400 mt-0.5">
              <template v-if="referencedRequestSummary.count > 0">
                The selected workflows use {{ pluralize(referencedRequestSummary.count, 'saved request') }}
                from {{ referencedRequestSummary.collectionNames.join(', ') }}.
              </template>
              When on, those requests are exported with their collections and the steps stay linked to them after import.
              When off, each step keeps a copy of its request as an inline request.
            </span>
          </span>
        </label>
      </template>
    </div>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <span class="text-xs text-surface-500 dark:text-surface-400 tabular-nums">{{ exportSummary }}</span>
        <div class="flex gap-2">
          <Button label="Cancel" severity="secondary" @click="closeExportDialog" />
          <Button
            label="Export"
            @click="handleExport"
            :loading="isExporting"
            :disabled="isExporting || !canExport"
          />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<style scoped src="./transferDialog.css"></style>

<style scoped>
.export-request-node {
  align-items: center;
  display: inline-flex;
  gap: 0.5rem;
  min-width: 0;
}

.method-badge {
  border-radius: 0.25rem;
  display: inline-flex;
  font-size: 10px;
  font-weight: 700;
  justify-content: center;
  line-height: 1;
  min-width: 3.25rem;
  padding: 0.25rem 0.375rem;
}

.method-get {
  background: #dcfce7;
  color: #166534;
}

.method-post {
  background: #dbeafe;
  color: #1d4ed8;
}

.method-put {
  background: #fef3c7;
  color: #92400e;
}

.method-delete {
  background: #fee2e2;
  color: #b91c1c;
}

.method-patch {
  background: #f3e8ff;
  color: #7e22ce;
}

.method-head,
.method-options,
.method-default {
  background: #e5e7eb;
  color: #374151;
}
</style>
