<script setup lang="ts">
import { dialogStyle } from '@/utils/dialogSize';
import { computed, ref, watch } from 'vue';
import { useCollectionsStore } from '@/stores/collections';
import { useConsoleLogsStore } from '@/stores/consoleLogs';
import { useEnvironmentsStore } from '@/stores/environments';
import { useMocksStore } from '@/stores/mocks';
import { useRequestsStore } from '@/stores/requests';
import { pickOpenApiMockFile, type OpenApiMockFile } from '@/services/mock/openApiFile';
import type { HttpMethod, MockRoute } from '@/types/models';
import { collectAllRequestIds } from '@/utils/collectionTree';
import { createMockService, nextFreeMockPort } from '@/utils/mockFactory';
import { latestObservedFor, mockResponseFromObserved, routesFromRequests, type RequestForMock } from '@/utils/mockFromRequests';

const visible = defineModel<boolean>('visible', { required: true });
const props = withDefaults(defineProps<{ initialCollectionId?: string | null }>(), { initialCollectionId: null });
const emit = defineEmits<{ created: [serviceId: string] }>();

const mocksStore = useMocksStore();
const collectionsStore = useCollectionsStore();
const requestsStore = useRequestsStore();
const consoleLogsStore = useConsoleLogsStore();
const environmentsStore = useEnvironmentsStore();

type Source = 'blank' | 'collection' | 'openapi';
const sources: Array<{ value: Source; title: string; text: string }> = [
  { value: 'blank', title: 'Blank', text: 'Add routes by hand, for APIs that do not exist yet.' },
  { value: 'collection', title: 'Collection', text: 'One route per request, with the latest responses from the Console.' },
  { value: 'openapi', title: 'OpenAPI file', text: 'One response per documented status, from examples or schemas.' },
];

const name = ref('');
const portInput = ref('');
const source = ref<Source>('blank');
const collectionId = ref<string | null>(null);
const useObserved = ref(true);
const createEnvironment = ref(true);
const startNow = ref(true);
const openApiFile = ref<OpenApiMockFile | null>(null);
const openApiError = ref('');
const preview = ref<Array<{ route: MockRoute; request?: RequestForMock; observed: boolean }>>([]);
const baseVariable = ref('baseUrl');
const isCreating = ref(false);
const baseVariableTag = computed(() => `{{${baseVariable.value}}}`);

const reset = () => {
  name.value = '';
  portInput.value = String(nextFreeMockPort(mocksStore.services));
  source.value = props.initialCollectionId ? 'collection' : 'blank';
  collectionId.value = props.initialCollectionId || collectionsStore.collections[0]?.id || null;
  useObserved.value = true;
  createEnvironment.value = true;
  startNow.value = true;
  openApiFile.value = null;
  openApiError.value = '';
  preview.value = [];
};
watch(visible, (open) => { if (open) reset(); }, { immediate: true });

const collectionOptions = computed(() => collectionsStore.collections.map(collection => ({ label: collection.name, value: collection.id })));
const selectedCollection = computed(() => collectionsStore.collections.find(collection => collection.id === collectionId.value));

const portError = computed(() => {
  const port = Number(portInput.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Enter a port between 1 and 65535';
  const other = mocksStore.services.find(service => service.port === port);
  return other ? `"${other.name}" already uses this port` : '';
});

const defaultName = computed(() => {
  if (source.value === 'collection' && selectedCollection.value) return `${selectedCollection.value.name} Mock`;
  if (source.value === 'openapi' && openApiFile.value) return `${openApiFile.value.title} Mock`;
  return 'Mock Service';
});

/** 请求 URL 开头最常用的 {{变量}}，Mock 环境中把它设为 Mock 地址 */
const leadingVariable = (requests: RequestForMock[]) => {
  const counts = new Map<string, number>();
  requests.forEach(request => {
    const match = request.url.trim().match(/^\{\{\s*([^}]+?)\s*\}\}/);
    if (match) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  });
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || 'baseUrl';
};

const buildCollectionPreview = async () => {
  const collection = selectedCollection.value;
  if (source.value !== 'collection' || !collection) {
    if (source.value === 'collection') preview.value = [];
    return;
  }
  const requests = (await requestsStore.loadMultipleRequests(collectAllRequestIds(collection)))
    .map(request => ({ name: request.name, method: request.method as HttpMethod, url: request.url }));
  baseVariable.value = leadingVariable(requests);
  const logs = consoleLogsStore.logs;
  preview.value = routesFromRequests(requests).map(item => ({
    ...item,
    observed: Boolean(latestObservedFor(logs, item.route.method, item.route.path)),
  }));
};
watch([source, collectionId, visible], () => void buildCollectionPreview());

const chooseOpenApiFile = async () => {
  openApiError.value = '';
  try {
    const file = await pickOpenApiMockFile();
    if (!file) return;
    openApiFile.value = file;
    preview.value = file.routes.map(route => ({ route, observed: false }));
    baseVariable.value = 'baseUrl';
  } catch (error) {
    openApiError.value = error instanceof Error ? error.message : String(error);
  }
};

const responseSummary = (item: { route: MockRoute; observed: boolean }) => {
  if (source.value === 'collection') return useObserved.value && item.observed ? 'Latest response from the Console' : 'Empty 200 response';
  return item.route.responses.map(response => response.status).join(', ') || 'No responses';
};

const canCreate = computed(() => !portError.value && !isCreating.value
  && (source.value !== 'collection' || Boolean(selectedCollection.value))
  && (source.value !== 'openapi' || Boolean(openApiFile.value)));

const routesToCreate = async (): Promise<MockRoute[]> => {
  if (source.value === 'blank') return [];
  if (source.value === 'openapi') return openApiFile.value?.routes || [];
  const routes: MockRoute[] = [];
  for (const { route } of preview.value) {
    const observed = useObserved.value ? latestObservedFor(consoleLogsStore.logs, route.method, route.path) : undefined;
    if (observed) {
      const { responseBody } = await consoleLogsStore.loadLogBody(observed.id);
      const name = route.responses[0]?.name || 'Success';
      route.responses = [{
        ...mockResponseFromObserved({ ...observed, headers: observed.responseHeaders, body: responseBody }, name),
        isDefault: true,
      }];
    }
    routes.push(route);
  }
  return routes;
};

const create = async () => {
  if (!canCreate.value) return;
  isCreating.value = true;
  try {
    const service = createMockService({
      name: name.value.trim() || defaultName.value,
      port: Number(portInput.value),
      routes: await routesToCreate(),
    });
    await mocksStore.createService(service);
    if (createEnvironment.value && source.value !== 'blank') {
      const environment = await environmentsStore.createEnvironment(`${service.name}`);
      await environmentsStore.updateEnvironment(environment.id, {
        variables: [{ key: baseVariable.value, value: mocksStore.baseUrl(service), enabled: true }],
      });
    }
    if (startNow.value) await mocksStore.start(service.id);
    visible.value = false;
    emit('created', service.id);
  } finally {
    isCreating.value = false;
  }
};
</script>

<template>
  <Dialog v-model:visible="visible" header="New Mock Service" modal :style="dialogStyle('xl')" :dismissable-mask="true">
    <div class="flex flex-col gap-4 text-sm">
      <div class="flex gap-3 flex-wrap items-end">
        <label class="flex flex-col gap-1 flex-1 min-w-60 text-xs text-surface-500">Name
          <InputText v-model="name" :placeholder="defaultName" aria-label="Name" autofocus />
        </label>
        <label class="flex flex-col gap-1 w-32 text-xs text-surface-500">Port
          <InputText v-model="portInput" class="font-mono" inputmode="numeric" :invalid="Boolean(portError)" aria-label="Port" />
        </label>
        <span class="pb-2 text-xs" :class="portError ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'">
          {{ portError || 'Not used by other mock services' }}
        </span>
      </div>

      <div class="flex flex-col gap-2">
        <span class="font-semibold">Start from</span>
        <div class="grid grid-cols-3 gap-2.5">
          <label
            v-for="item in sources"
            :key="item.value"
            class="source-card flex flex-col gap-1.5 p-3 rounded-lg border cursor-pointer"
            :class="{ selected: source === item.value }"
          >
            <span class="flex items-center gap-2 font-semibold">
              <RadioButton v-model="source" :value="item.value" :input-id="`mock-source-${item.value}`" /> {{ item.title }}
            </span>
            <span class="text-xs text-surface-600 dark:text-surface-400">{{ item.text }}</span>
          </label>
        </div>
      </div>

      <div v-if="source === 'collection'" class="border border-surface-200 dark:border-surface-700 rounded-lg p-3 flex flex-col gap-2.5">
        <div class="flex items-center gap-2.5 flex-wrap">
          <span class="text-surface-600 dark:text-surface-300">Collection</span>
          <Select v-model="collectionId" :options="collectionOptions" option-label="label" option-value="value" class="min-w-56" placeholder="Choose a collection" aria-label="Collection" />
          <span class="text-xs text-surface-500">{{ preview.length }} route{{ preview.length === 1 ? '' : 's' }}</span>
        </div>
        <label class="flex items-start gap-2">
          <Checkbox v-model="useObserved" binary class="mt-0.5" />
          <span>Use the latest response in the Console as each route's default response
            <span class="block text-xs text-surface-500">{{ preview.filter(item => item.observed).length }} of {{ preview.length }} routes have a response in the Console. The others get an empty 200 response.</span>
          </span>
        </label>
      </div>

      <div v-else-if="source === 'openapi'" class="border border-surface-200 dark:border-surface-700 rounded-lg p-3 flex flex-col gap-2.5">
        <div class="flex items-center gap-2.5 flex-wrap">
          <Button label="Choose File" icon="pi pi-file" size="small" severity="secondary" @click="chooseOpenApiFile" />
          <span v-if="openApiFile" class="font-medium">{{ openApiFile.fileName }}</span>
          <span v-if="openApiFile" class="text-xs text-surface-500">{{ openApiFile.routes.length }} operations</span>
          <span v-if="openApiError" class="text-xs text-red-600 dark:text-red-400">{{ openApiError }}</span>
        </div>
        <ul v-if="openApiFile?.warnings.length" class="m-0 pl-5 text-xs text-amber-700 dark:text-amber-400">
          <li v-for="warning in openApiFile.warnings" :key="warning">{{ warning }}</li>
        </ul>
      </div>

      <div v-if="source !== 'blank' && preview.length > 0" class="route-preview border border-surface-200 dark:border-surface-700 rounded-lg overflow-y-auto text-xs">
        <div v-for="item in preview" :key="item.route.id" class="preview-row grid gap-2.5 px-2.5 py-1.5">
          <span class="font-mono">{{ item.route.method }}</span>
          <span class="font-mono truncate">{{ item.route.path }}</span>
          <span class="truncate" :class="source === 'collection' && !(useObserved && item.observed) ? 'text-amber-700 dark:text-amber-400' : 'text-surface-500'">{{ responseSummary(item) }}</span>
        </div>
      </div>

      <label v-if="source !== 'blank'" class="flex items-start gap-2">
        <Checkbox v-model="createEnvironment" binary class="mt-0.5" />
        <span>Create environment "{{ name.trim() || defaultName }}"
          <span class="block text-xs text-surface-500">Sets <code>{{ baseVariableTag }}</code> to http://127.0.0.1:{{ portInput }}, so switching to it sends the requests to this mock.</span>
        </span>
      </label>
      <label class="flex items-center gap-2"><Checkbox v-model="startNow" binary /> Start the service now</label>
    </div>
    <template #footer>
      <Button label="Cancel" severity="secondary" @click="visible = false" />
      <Button label="Create" :disabled="!canCreate" :loading="isCreating" @click="create" />
    </template>
  </Dialog>
</template>

<style scoped>
.source-card { border-color: var(--p-content-border-color); }
.source-card.selected { border-color: #14b8a6; background: rgba(20, 184, 166, 0.12); }
.route-preview { max-height: 12rem; }
.preview-row { grid-template-columns: 4rem minmax(0, 1.4fr) minmax(0, 1fr); }
.preview-row + .preview-row { border-top: 1px solid var(--p-content-border-color); }
</style>
