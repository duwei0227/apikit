<script setup lang="ts">
import { computed, ref } from 'vue';
import { importExportService, type ImportFilePreview } from '@/services/import-export';
import type { Collection, Environment, Request } from '@/types/models';
import { useCollectionsStore } from '@/stores/collections';
import { useEnvironmentsStore } from '@/stores/environments';
import { useRequestsStore } from '@/stores/requests';
import { useWorkflowsStore } from '@/stores/workflows';
import { pluralize, workflowMeta } from '@/utils/transferFormat';
import { inlineWorkflowReferences, summarizeWorkflow } from '@/utils/workflowTransfer';

const emit = defineEmits<{ 'import-curl': [command: string] }>();

const collectionsStore = useCollectionsStore();
const environmentsStore = useEnvironmentsStore();
const requestsStore = useRequestsStore();
const workflowsStore = useWorkflowsStore();

const showImportDialog = ref(false);
const importType = ref<'file' | 'curl'>('file');
const curlInput = ref('');
const isImporting = ref(false);
const importPreview = ref<ImportFilePreview | null>(null);
const importTab = ref<'collections' | 'workflows'>('collections');
const importCollectionSelection = ref<Record<string, boolean>>({});
const importWorkflowSelection = ref<Record<string, boolean>>({});
const importEnvironmentSelected = ref(true);

const uniqueName = (name: string, takenNames: Set<string>) => {
  if (!takenNames.has(name)) return name;
  let candidate = `${name} (Imported)`;
  let counter = 2;
  while (takenNames.has(candidate)) {
    candidate = `${name} (Imported ${counter})`;
    counter++;
  }
  return candidate;
};

// 按顺序为一批导入项分配不重名的名称（同一批内部也不重名）
const assignImportNames = (items: Array<{ id: string; name: string }>, existingNames: string[]): Record<string, string> => {
  const taken = new Set(existingNames);
  return Object.fromEntries(items.map(item => {
    const name = uniqueName(item.name, taken);
    taken.add(name);
    return [item.id, name];
  }));
};

const openImportDialog = () => {
  showImportDialog.value = true;
  importType.value = 'file';
  curlInput.value = '';
  importPreview.value = null;
};

const closeImportDialog = () => {
  showImportDialog.value = false;
  curlInput.value = '';
  importPreview.value = null;
};

const previewCollections = computed(() => importPreview.value?.collections || []);
const previewWorkflows = computed(() => importPreview.value?.workflows || []);
const previewEnvironments = computed(() => importPreview.value?.environments || []);
const previewWarnings = computed(() => importPreview.value?.warnings || []);

const importEnvironmentNames = computed(() => assignImportNames(
  previewEnvironments.value,
  environmentsStore.environments.map(environment => environment.name)
));

const baseUrlOf = (environment: Environment) => environment.variables.find(variable => variable.key === 'baseUrl')?.value || '';

const previewRequestCount = (collection: Collection) => (
  importPreview.value?.requests.filter(request => request.collectionId === collection.id).length || 0
);

const importCollectionNames = computed(() => assignImportNames(
  previewCollections.value,
  collectionsStore.collections.map(collection => collection.name)
));

const importWorkflowNames = computed(() => assignImportNames(
  previewWorkflows.value,
  workflowsStore.workflows.map(workflow => workflow.name)
));

const selectedImportCollections = computed(() => (
  previewCollections.value.filter(collection => importCollectionSelection.value[collection.id])
));

const selectedImportWorkflows = computed(() => (
  previewWorkflows.value.filter(workflow => importWorkflowSelection.value[workflow.id])
));

const selectedImportRequestCount = computed(() => {
  const ids = new Set(selectedImportCollections.value.map(collection => collection.id));
  return importPreview.value?.requests.filter(request => ids.has(request.collectionId ?? '')).length || 0;
});

const isAllImportCollectionsSelected = computed(() => (
  previewCollections.value.length > 0 && selectedImportCollections.value.length === previewCollections.value.length
));

const isAllImportWorkflowsSelected = computed(() => (
  previewWorkflows.value.length > 0 && selectedImportWorkflows.value.length === previewWorkflows.value.length
));

const toggleSelectAllImportCollections = () => {
  importCollectionSelection.value = isAllImportCollectionsSelected.value
    ? {}
    : Object.fromEntries(previewCollections.value.map(collection => [collection.id, true]));
};

const toggleSelectAllImportWorkflows = () => {
  importWorkflowSelection.value = isAllImportWorkflowsSelected.value
    ? {}
    : Object.fromEntries(previewWorkflows.value.map(workflow => [workflow.id, true]));
};

const toggleImportCollection = (id: string) => {
  importCollectionSelection.value = { ...importCollectionSelection.value, [id]: !importCollectionSelection.value[id] };
};

const toggleImportWorkflow = (id: string) => {
  importWorkflowSelection.value = { ...importWorkflowSelection.value, [id]: !importWorkflowSelection.value[id] };
};

// 选中的 Workflow 中，引用了未勾选 Collection 内请求的那些
const workflowsWithSkippedReferences = computed(() => {
  const preview = importPreview.value;
  if (!preview) return [];
  const skippedCollectionIds = new Set(
    previewCollections.value.filter(collection => !importCollectionSelection.value[collection.id]).map(collection => collection.id)
  );
  const skippedRequestIds = new Set(
    preview.requests.filter(request => skippedCollectionIds.has(request.collectionId ?? '')).map(request => request.id)
  );
  return selectedImportWorkflows.value
    .map(workflow => {
      const ids = summarizeWorkflow(workflow).requestIds;
      const collectionNames = [...new Set(preview.requests
        .filter(request => ids.has(request.id) && skippedRequestIds.has(request.id))
        .map(request => previewCollections.value.find(collection => collection.id === request.collectionId)?.name)
        .filter(Boolean))];
      return { name: importWorkflowNames.value[workflow.id], collectionNames };
    })
    .filter(item => item.collectionNames.length > 0);
});

const importSummary = computed(() => {
  const parts: string[] = [];
  if (previewCollections.value.length > 0) {
    parts.push(pluralize(selectedImportCollections.value.length, 'collection'));
    parts.push(pluralize(selectedImportRequestCount.value, 'request'));
  }
  if (previewWorkflows.value.length > 0) {
    parts.push(pluralize(selectedImportWorkflows.value.length, 'workflow'));
  }
  if (previewEnvironments.value.length > 0 && importEnvironmentSelected.value) {
    parts.push(pluralize(previewEnvironments.value.length, 'environment'));
  }
  return parts.join(' · ');
});

const canImport = computed(() => (
  selectedImportCollections.value.length > 0 || selectedImportWorkflows.value.length > 0
));

const importFormatLabel = computed(() => {
  if (!importPreview.value) return '';
  if (importPreview.value.source === 'postman') return 'Postman';
  if (importPreview.value.source === 'openapi') return importPreview.value.version || 'OpenAPI';
  return `ApiKit ${importPreview.value.version || ''}`.trim();
});

const pickImportFile = async () => {
  try {
    const preview = await importExportService.pickImportFile();
    if (!preview) return;

    if (preview.collections.length === 0 && preview.workflows.length === 0) {
      window.$toast?.add({
        severity: 'warn',
        summary: 'Nothing to Import',
        detail: 'The file contains no collections or workflows',
        life: 4000
      });
      return;
    }

    importPreview.value = preview;
    importCollectionSelection.value = Object.fromEntries(preview.collections.map(collection => [collection.id, true]));
    importWorkflowSelection.value = Object.fromEntries(preview.workflows.map(workflow => [workflow.id, true]));
    importEnvironmentSelected.value = true;
    importTab.value = preview.collections.length > 0 ? 'collections' : 'workflows';
  } catch (error) {
    console.error('Failed to read import file:', error);
    window.$toast?.add({
      severity: 'error',
      summary: 'Import Failed',
      detail: errorMessage(error) === 'Invalid import file format'
        ? 'This file is not an ApiKit export, a Postman collection or an OpenAPI document'
        : (errorMessage(error) || 'Failed to read the file'),
      life: 5000
    });
  }
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error ?? ''));

const importSelection = async () => {
  const preview = importPreview.value;
  if (!preview) return { collections: 0, workflows: 0, environments: 0 };
  const collections = selectedImportCollections.value;
  const collectionIds = new Set(collections.map(collection => collection.id));
  const keptRequestIds = new Set(
    preview.requests.filter(request => collectionIds.has(request.collectionId ?? '')).map(request => request.id)
  );
  const requestMap = new Map<string, Request>(preview.requests.map(request => [request.id, request]));
  const collectionNames = importCollectionNames.value;
  const workflowNames = importWorkflowNames.value;

  for (const collection of collections) {
    const newCollection = await collectionsStore.createCollection(collectionNames[collection.id], collection.description);
    if (!newCollection) continue;

    await collectionsStore.updateCollection(newCollection.id, {
      folders: collection.folders,
      requests: collection.requests
    });

    for (const request of preview.requests.filter(item => item.collectionId === collection.id)) {
      await requestsStore.saveRequest({ ...request, collectionId: newCollection.id });
    }
  }

  // 引用了未导入请求的步骤转成 inline 请求，Workflow 仍可运行
  // 导出时在文件夹中的 Workflow 放回同名文件夹（没有时新建）
  for (const { folderPath = [], ...workflow } of selectedImportWorkflows.value) {
    await workflowsStore.saveWorkflow({
      ...inlineWorkflowReferences(workflow, requestMap, keptRequestIds),
      name: workflowNames[workflow.id]
    });
    const folderId = await workflowsStore.ensureFolderPath(folderPath);
    if (folderId) await workflowsStore.moveWorkflowToFolder(workflow.id, folderId);
  }

  let environmentCount = 0;
  if (importEnvironmentSelected.value) {
    for (const environment of previewEnvironments.value) {
      const created = await environmentsStore.createEnvironment(importEnvironmentNames.value[environment.id]);
      await environmentsStore.updateEnvironment(created.id, { variables: environment.variables });
      environmentCount++;
    }
  }

  return {
    collections: collections.length,
    workflows: selectedImportWorkflows.value.length,
    environments: environmentCount
  };
};

const handleImport = async () => {
  if (importType.value === 'curl') {
    if (!curlInput.value.trim()) {
      window.$toast?.add({
        severity: 'warn',
        summary: 'Warning',
        detail: 'Please enter a cURL command',
        life: 3000
      });
      return;
    }

    emit('import-curl', curlInput.value.trim());
    closeImportDialog();
    return;
  }

  if (!importPreview.value) {
    await pickImportFile();
    return;
  }

  isImporting.value = true;
  try {
    const result = await importSelection();
    const parts: string[] = [];
    if (result.collections > 0) parts.push(pluralize(result.collections, 'collection'));
    if (result.workflows > 0) parts.push(pluralize(result.workflows, 'workflow'));
    if (result.environments > 0) parts.push(pluralize(result.environments, 'environment'));
    window.$toast?.add({
      severity: 'success',
      summary: 'Success',
      detail: `Imported ${parts.join(' and ')}`,
      life: 3000
    });
    closeImportDialog();
  } catch (error) {
    console.error('Failed to import:', error);
    window.$toast?.add({
      severity: 'error',
      summary: 'Import Failed',
      detail: errorMessage(error) || 'Failed to import',
      life: 5000
    });
  } finally {
    isImporting.value = false;
  }
};

defineExpose({ open: openImportDialog });
</script>

<template>
  <!-- Import Dialog -->
  <Dialog
    v-model:visible="showImportDialog"
    header="Import"
    :modal="true"
    :style="{ width: '40rem' }"
    @hide="closeImportDialog"
  >
    <div class="flex flex-col gap-4">
      <div>
        <label class="block text-sm font-medium mb-2">Import Type</label>
        <div class="flex gap-4">
          <div class="flex items-center">
            <RadioButton v-model="importType" inputId="type-file" value="file" />
            <label for="type-file" class="ml-2 cursor-pointer">File</label>
          </div>
          <div class="flex items-center">
            <RadioButton v-model="importType" inputId="type-curl" value="curl" />
            <label for="type-curl" class="ml-2 cursor-pointer">cURL</label>
          </div>
        </div>
      </div>

      <template v-if="importType === 'file'">
        <!-- Step 1: choose a file -->
        <div v-if="!importPreview" class="flex flex-col gap-3">
          <div class="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-surface-300 dark:border-surface-600 px-4 py-6 text-center">
            <span class="font-medium">Choose a JSON or YAML file</span>
            <span class="text-xs text-surface-500 dark:text-surface-400">
              ApiKit export (collections and workflows), Postman collection v2.1, or OpenAPI 3.x / Swagger 2.0
            </span>
            <Button label="Browse..." severity="secondary" size="small" class="mt-2" @click="pickImportFile" />
          </div>
          <p class="text-sm text-surface-600 dark:text-surface-400">
            You can review what the file contains before importing. Existing data is not changed;
            items whose names already exist get an "(Imported)" suffix.
          </p>
        </div>

        <!-- Step 2: preview and choose items -->
        <div v-else class="flex flex-col gap-3">
          <div class="flex items-center gap-3 rounded border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-3 py-2 min-w-0">
            <i class="pi pi-file text-surface-500"></i>
            <span class="flex-1 min-w-0 truncate font-mono text-xs">{{ importPreview.fileName }}</span>
            <span class="transfer-tag">{{ importFormatLabel }}</span>
            <button type="button" class="text-xs underline hover:text-primary" @click="pickImportFile">Change</button>
          </div>

          <div class="transfer-tabs">
            <button
              v-if="previewCollections.length > 0"
              type="button"
              class="transfer-tab"
              :class="{ active: importTab === 'collections' }"
              @click="importTab = 'collections'"
            >
              Collections
              <span class="transfer-count">{{ selectedImportCollections.length }} / {{ previewCollections.length }}</span>
            </button>
            <button
              v-if="previewWorkflows.length > 0"
              type="button"
              class="transfer-tab"
              :class="{ active: importTab === 'workflows' }"
              @click="importTab = 'workflows'"
            >
              Workflows
              <span class="transfer-count">{{ selectedImportWorkflows.length }} / {{ previewWorkflows.length }}</span>
            </button>
          </div>

          <template v-if="importTab === 'collections'">
            <div class="flex items-center justify-between gap-3">
              <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-primary"
                  :checked="isAllImportCollectionsSelected"
                  :indeterminate="selectedImportCollections.length > 0 && !isAllImportCollectionsSelected"
                  @change="toggleSelectAllImportCollections"
                />
                <span>Select all</span>
              </label>
              <span class="text-xs text-surface-500 dark:text-surface-400">
                {{ pluralize(selectedImportRequestCount, 'request') }}
              </span>
            </div>
            <div class="transfer-list">
              <label v-for="collection in previewCollections" :key="collection.id" class="transfer-row">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-primary shrink-0"
                  :checked="!!importCollectionSelection[collection.id]"
                  @change="toggleImportCollection(collection.id)"
                />
                <span class="flex-1 min-w-0 truncate">{{ collection.name }}</span>
                <span
                  v-if="importCollectionNames[collection.id] !== collection.name"
                  class="transfer-tag rename"
                  :title="`Will be imported as ${importCollectionNames[collection.id]}`"
                >→ {{ importCollectionNames[collection.id] }}</span>
                <span class="transfer-meta">{{ pluralize(previewRequestCount(collection), 'request') }}</span>
              </label>
            </div>
          </template>

          <template v-else>
            <div class="flex items-center justify-between gap-3">
              <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-primary"
                  :checked="isAllImportWorkflowsSelected"
                  :indeterminate="selectedImportWorkflows.length > 0 && !isAllImportWorkflowsSelected"
                  @change="toggleSelectAllImportWorkflows"
                />
                <span>Select all</span>
              </label>
              <span class="text-xs text-surface-500 dark:text-surface-400">
                {{ pluralize(selectedImportWorkflows.length, 'workflow') }}
              </span>
            </div>
            <div class="transfer-list">
              <label v-for="workflow in previewWorkflows" :key="workflow.id" class="transfer-row">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-primary shrink-0"
                  :checked="!!importWorkflowSelection[workflow.id]"
                  @change="toggleImportWorkflow(workflow.id)"
                />
                <span class="flex-1 min-w-0 truncate">{{ workflow.name }}</span>
                <span
                  v-if="importWorkflowNames[workflow.id] !== workflow.name"
                  class="transfer-tag rename"
                  :title="`Will be imported as ${importWorkflowNames[workflow.id]}`"
                >→ {{ importWorkflowNames[workflow.id] }}</span>
                <span
                  v-if="workflow.folderPath?.length"
                  class="transfer-meta truncate"
                  :title="workflow.folderPath.join(' / ')"
                ><i class="pi pi-folder text-xs mr-1"></i>{{ workflow.folderPath.join(' / ') }}</span>
                <span class="transfer-meta">{{ workflowMeta(workflow) }}</span>
              </label>
            </div>
          </template>

          <label
            v-for="environment in previewEnvironments"
            :key="environment.id"
            class="flex items-start gap-2 text-sm cursor-pointer select-none"
          >
            <input
              v-model="importEnvironmentSelected"
              type="checkbox"
              class="h-4 w-4 mt-0.5 accent-primary shrink-0"
            />
            <span class="min-w-0">
              Also create environment "{{ importEnvironmentNames[environment.id] }}"
              <span class="block truncate font-mono text-xs text-surface-500 dark:text-surface-400">
                baseUrl = {{ baseUrlOf(environment) || '(empty)' }}
              </span>
            </span>
          </label>

          <div v-if="previewWarnings.length > 0" class="transfer-note warn">
            <i class="pi pi-exclamation-triangle mt-0.5"></i>
            <span>{{ previewWarnings.join('; ') }}.</span>
          </div>

          <div v-if="workflowsWithSkippedReferences.length > 0" class="transfer-note warn">
            <i class="pi pi-exclamation-triangle mt-0.5"></i>
            <span>
              <template v-for="(item, index) in workflowsWithSkippedReferences" :key="item.name">
                <template v-if="index > 0">; </template>
                "{{ item.name }}" uses requests from {{ item.collectionNames.join(', ') }}
              </template>.
              Those collections are not selected, so the steps will keep a copy of each request as an inline request.
            </span>
          </div>
        </div>
      </template>

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
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <span class="text-xs text-surface-500 dark:text-surface-400 tabular-nums">
          {{ importType === 'file' && importPreview ? importSummary : '' }}
        </span>
        <div class="flex gap-2">
          <Button label="Cancel" severity="secondary" @click="closeImportDialog" />
          <Button
            :label="importType === 'file' && !importPreview ? 'Select File' : 'Import'"
            @click="handleImport"
            :loading="isImporting"
            :disabled="isImporting || (importType === 'file' && !!importPreview && !canImport)"
          />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<style scoped src="./transferDialog.css"></style>
