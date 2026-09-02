<script setup>
import { computed, ref } from 'vue';
import { importExportService } from '@/services/import-export';
import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';

const emit = defineEmits(['new-request', 'import-file', 'import-curl']);

const collectionsStore = useCollectionsStore();
const requestsStore = useRequestsStore();

const showImportDialog = ref(false);
const importType = ref('file');
const curlInput = ref('');
const isImporting = ref(false);
const showExportDialog = ref(false);
const exportSelectionKeys = ref({});
const exportExpandedKeys = ref({});
const exportFormat = ref('apikit');
const isExporting = ref(false);

const handleNewRequest = () => {
  emit('new-request');
};

const openImportDialog = () => {
  showImportDialog.value = true;
  importType.value = 'file';
  curlInput.value = '';
};

const closeImportDialog = () => {
  showImportDialog.value = false;
  curlInput.value = '';
};

const collectionKey = (collectionId) => `collection:${collectionId}`;
const folderKey = (collectionId, folderId) => `folder:${collectionId}:${folderId}`;
const requestKey = (collectionId, requestId) => `request:${collectionId}:${requestId}`;

const buildFolderNode = (folder, collectionId) => ({
  key: folderKey(collectionId, folder.id),
  label: folder.name,
  data: { type: 'folder', id: folder.id, collectionId },
  icon: 'pi pi-folder',
  children: [
    ...(folder.folders || []).map(child => buildFolderNode(child, collectionId)),
    ...(folder.requests || []).map(request => buildRequestNode(request, collectionId))
  ]
});

const buildRequestNode = (request, collectionId) => ({
  key: requestKey(collectionId, request.id),
  label: request.name,
  data: { type: 'request', id: request.id, collectionId, method: request.method },
  icon: 'pi pi-send'
});

const methodBadgeClass = (method) => ({
  GET: 'method-get',
  POST: 'method-post',
  PUT: 'method-put',
  DELETE: 'method-delete',
  PATCH: 'method-patch',
  HEAD: 'method-head',
  OPTIONS: 'method-options'
}[method] || 'method-default');

const exportTreeNodes = computed(() => collectionsStore.collections.map(collection => ({
  key: collectionKey(collection.id),
  label: collection.name,
  data: { type: 'collection', id: collection.id },
  icon: 'pi pi-folder-open',
  children: [
    ...(collection.folders || []).map(folder => buildFolderNode(folder, collection.id)),
    ...(collection.requests || []).map(request => buildRequestNode(request, collection.id))
  ]
})));

const getTreeKeys = (nodes) => nodes.flatMap(node => [
  node.key,
  ...getTreeKeys(node.children || [])
]);

const getRequestKeys = (nodes) => nodes.flatMap(node => [
  ...(node.data.type === 'request' ? [node.key] : []),
  ...getRequestKeys(node.children || [])
]);

const exportTreeKeys = computed(() => getTreeKeys(exportTreeNodes.value));
const exportRequestKeys = computed(() => getRequestKeys(exportTreeNodes.value));

const isAllExportSelected = computed(() => (
  exportTreeKeys.value.length > 0 &&
  exportTreeKeys.value.every(key => exportSelectionKeys.value[key]?.checked === true)
));

const selectedExportCount = computed(() => (
  exportTreeKeys.value.filter(key => exportSelectionKeys.value[key]?.checked === true).length
));

const selectedRequestCount = computed(() => (
  exportRequestKeys.value.filter(key => exportSelectionKeys.value[key]?.checked === true).length
));

const toggleSelectAllExport = () => {
  if (isAllExportSelected.value) {
    exportSelectionKeys.value = {};
    return;
  }

  exportSelectionKeys.value = Object.fromEntries(
    exportTreeKeys.value.map(key => [key, { checked: true, partialChecked: false }])
  );
};

const openExportDialog = () => {
  exportSelectionKeys.value = {};
  exportExpandedKeys.value = Object.fromEntries(
    collectionsStore.collections.map(collection => [collectionKey(collection.id), true])
  );
  exportFormat.value = 'apikit';
  showExportDialog.value = true;
};

const closeExportDialog = () => {
  showExportDialog.value = false;
  exportSelectionKeys.value = {};
};

const handleImport = async () => {
  if (importType.value === 'file') {
    emit('import-file');
    closeImportDialog();
  } else if (importType.value === 'curl') {
    if (!curlInput.value.trim()) {
      if (window.$toast) {
        window.$toast.add({
          severity: 'warn',
          summary: 'Warning',
          detail: 'Please enter a cURL command',
          life: 3000
        });
      }
      return;
    }
    
    emit('import-curl', curlInput.value.trim());
    closeImportDialog();
  }
};

const isNodeChecked = (key) => exportSelectionKeys.value[key]?.checked === true;

const collectFolderRequestIds = (folder, ids) => {
  (folder.requests || []).forEach(request => ids.add(request.id));
  (folder.folders || []).forEach(child => collectFolderRequestIds(child, ids));
};

const collectCollectionRequestIds = (collection, ids) => {
  (collection.requests || []).forEach(request => ids.add(request.id));
  (collection.folders || []).forEach(folder => collectFolderRequestIds(folder, ids));
};

const filterFolderForExport = (folder, collectionId, selectedRequestIds) => {
  if (isNodeChecked(folderKey(collectionId, folder.id))) {
    collectFolderRequestIds(folder, selectedRequestIds);
    return JSON.parse(JSON.stringify(folder));
  }

  const requests = (folder.requests || []).filter(request => {
    const selected = isNodeChecked(requestKey(collectionId, request.id));
    if (selected) selectedRequestIds.add(request.id);
    return selected;
  });

  const folders = (folder.folders || [])
    .map(child => filterFolderForExport(child, collectionId, selectedRequestIds))
    .filter(Boolean);

  if (requests.length === 0 && folders.length === 0) {
    return null;
  }

  return {
    ...JSON.parse(JSON.stringify(folder)),
    folders,
    requests
  };
};

const buildExportSelection = () => {
  const selectedRequestIds = new Set();
  const selectedCollections = [];

  for (const collection of collectionsStore.collections) {
    if (isNodeChecked(collectionKey(collection.id))) {
      collectCollectionRequestIds(collection, selectedRequestIds);
      selectedCollections.push(JSON.parse(JSON.stringify(collection)));
      continue;
    }

    const requests = (collection.requests || []).filter(request => {
      const selected = isNodeChecked(requestKey(collection.id, request.id));
      if (selected) selectedRequestIds.add(request.id);
      return selected;
    });

    const folders = (collection.folders || [])
      .map(folder => filterFolderForExport(folder, collection.id, selectedRequestIds))
      .filter(Boolean);

    if (requests.length > 0 || folders.length > 0) {
      selectedCollections.push({
        ...JSON.parse(JSON.stringify(collection)),
        folders,
        requests
      });
    }
  }

  return { selectedCollections, selectedRequestIds };
};

const handleExport = async () => {
  const { selectedCollections, selectedRequestIds } = buildExportSelection();

  if (selectedCollections.length === 0 || selectedRequestIds.size === 0) {
    window.$toast?.add({
      severity: 'warn',
      summary: 'Warning',
      detail: 'Please select at least one request',
      life: 3000
    });
    return;
  }

  isExporting.value = true;

  try {
    const requests = await requestsStore.loadMultipleRequests(Array.from(selectedRequestIds));

    const exported = selectedCollections.length === 1
      ? await importExportService.exportCollection(selectedCollections[0], requests, exportFormat.value)
      : await importExportService.exportCollections(selectedCollections, requests, exportFormat.value);

    if (!exported) return;

    window.$toast?.add({
      severity: 'success',
      summary: 'Success',
      detail: 'Selection exported',
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
</script>

<template>
  <div class="toolbar bg-surface-0 dark:bg-surface-950 text-surface-900 dark:text-surface-50 px-4 py-2 border-b border-surface-200 dark:border-surface-700 flex items-center gap-2">
    <button 
      @click="handleNewRequest"
      class="px-3 py-1.5 text-sm bg-primary hover:bg-primary-600 text-primary-contrast rounded transition"
    >
      + New Request
    </button>
    
    <button 
      @click="openImportDialog"
      class="px-3 py-1.5 text-sm bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 rounded transition"
    >
      Import
    </button>

    <button 
      @click="openExportDialog"
      class="px-3 py-1.5 text-sm bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 rounded transition"
    >
      Export
    </button>
  </div>

  <!-- Import Dialog -->
  <Dialog 
    v-model:visible="showImportDialog"
    header="Import"
    :modal="true"
    :style="{ width: '32rem' }"
    @hide="closeImportDialog"
  >
    <div class="flex flex-col gap-4">
      <!-- Import Type Selection -->
      <div>
        <label class="block text-sm font-medium mb-2">Import Type</label>
        <div class="flex gap-4">
          <div class="flex items-center">
            <RadioButton 
              v-model="importType" 
              inputId="type-file" 
              value="file" 
            />
            <label for="type-file" class="ml-2 cursor-pointer">File</label>
          </div>
          <div class="flex items-center">
            <RadioButton 
              v-model="importType" 
              inputId="type-curl" 
              value="curl" 
            />
            <label for="type-curl" class="ml-2 cursor-pointer">cURL</label>
          </div>
        </div>
      </div>

      <!-- File Import Description -->
      <div v-if="importType === 'file'" class="text-sm text-surface-600 dark:text-surface-400">
        <p class="mb-2">Import a collection from an ApiKit export or Postman collection JSON file.</p>
        <ul class="list-disc list-inside space-y-1">
          <li>The file will be validated before import</li>
          <li>A new collection will be created with unique IDs</li>
          <li>Existing collections will not be affected</li>
        </ul>
      </div>

      <!-- cURL Import Input -->
      <div v-if="importType === 'curl'">
        <label class="block text-sm font-medium mb-2">cURL Command</label>
        <Textarea 
          v-model="curlInput"
          rows="8"
          placeholder="Paste your cURL command here...&#10;Example:&#10;curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{&quot;name&quot;:&quot;John&quot;}'"
          class="w-full font-mono text-sm"
        />
        <p class="text-xs text-surface-500 dark:text-surface-400 mt-2">
          The cURL command will be parsed and a new request will be created
        </p>
      </div>
    </div>
    
    <template #footer>
      <Button 
        label="Cancel" 
        severity="secondary" 
        @click="closeImportDialog" 
      />
      <Button 
        :label="importType === 'file' ? 'Select File' : 'Import'" 
        @click="handleImport"
        :disabled="isImporting"
      />
    </template>
  </Dialog>

  <!-- Export Dialog -->
  <Dialog
    v-model:visible="showExportDialog"
    header="Export"
    :modal="true"
    :style="{ width: '38rem' }"
    @hide="closeExportDialog"
  >
    <div class="flex flex-col gap-3">
      <div class="text-sm text-surface-600 dark:text-surface-400">
        Select the collections or requests to export.
      </div>

      <div>
        <label class="block text-sm font-medium mb-2">Export Format</label>
        <div class="flex gap-4">
          <label class="flex items-center cursor-pointer">
            <RadioButton
              v-model="exportFormat"
              inputId="format-apikit"
              value="apikit"
            />
            <span class="ml-2">ApiKit JSON</span>
          </label>
          <label class="flex items-center cursor-pointer">
            <RadioButton
              v-model="exportFormat"
              inputId="format-postman"
              value="postman"
            />
            <span class="ml-2">Postman</span>
          </label>
        </div>
      </div>

      <div class="flex items-center justify-between gap-3">
        <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            class="h-4 w-4 accent-primary"
            :checked="isAllExportSelected"
            :disabled="exportTreeNodes.length === 0"
            @change="toggleSelectAllExport"
          />
          <span>Select all</span>
        </label>
        <span class="text-xs text-surface-500 dark:text-surface-400">
          {{ selectedRequestCount }} requests selected
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
            </span>
            <span v-else>{{ node.label }}</span>
          </template>
        </Tree>
        <div v-else class="p-4 text-sm text-surface-500 dark:text-surface-400">
          No collections available.
        </div>
      </div>
    </div>

    <template #footer>
      <Button
        label="Cancel"
        severity="secondary"
        @click="closeExportDialog"
      />
      <Button
        label="Export"
        @click="handleExport"
        :loading="isExporting"
        :disabled="isExporting || selectedRequestCount === 0"
      />
    </template>
  </Dialog>
</template>

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
