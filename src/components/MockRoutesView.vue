<script lang="ts">
// 切换 Routes / Logs / Settings 或页签时保留每个服务选中的路由和响应
const selections = new Map<string, { routeId?: string; responseId?: string }>();
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { HttpMethod, MockOpenRequest, MockResponse, MockRoute, MockService } from '@/types/models';
import { cloneJson } from '@/utils/clone';
import { generateId } from '@/utils/id-generator';
import { createMockResponse, createMockRoute, duplicateMockRoute, MOCK_HTTP_METHODS } from '@/utils/mockFactory';
import { MOCK_RESPONSE_NAME_HEADER, mockExamplePath, normalizeMockPath } from '@/utils/mockMatching';
import { useMocksStore } from '@/stores/mocks';
import MockResponseEditor from './MockResponseEditor.vue';

const service = defineModel<MockService>('service', { required: true });
const emit = defineEmits<{ 'open-request': [request: MockOpenRequest] }>();
const mocksStore = useMocksStore();

const remembered = selections.get(service.value.id) || {};

const filter = ref('');
const selectedRouteId = ref<string | undefined>(remembered.routeId);
const selectedResponseId = ref<string | undefined>(remembered.responseId);

watch([selectedRouteId, selectedResponseId], ([routeId, responseId]) => {
  selections.set(service.value.id, { routeId, responseId });
});

const methodColor = (method: string) => `method-${method.toLowerCase()}`;

const filteredRoutes = computed(() => {
  const query = filter.value.trim().toLowerCase();
  if (!query) return service.value.routes;
  return service.value.routes.filter(route => `${route.method} ${route.path}`.toLowerCase().includes(query));
});

const selectedRoute = computed<MockRoute | undefined>(() => (
  service.value.routes.find(route => route.id === selectedRouteId.value) || service.value.routes[0]
));

const selectedResponse = computed<MockResponse | undefined>(() => {
  const route = selectedRoute.value;
  if (!route) return undefined;
  return route.responses.find(response => response.id === selectedResponseId.value) || route.responses[0];
});

const selectedResponseIndex = computed(() => (
  selectedRoute.value && selectedResponse.value ? selectedRoute.value.responses.indexOf(selectedResponse.value) : -1
));

const responseTag = (response: MockResponse) => {
  if (response.isDefault) return 'Default';
  if (response.rules.length === 0) return 'No rules';
  if (response.rules.length === 1) {
    const [rule] = response.rules;
    const value = rule.operator === 'exists' || rule.operator === 'notExists' ? '' : ` ${rule.value}`;
    return `${rule.source} ${rule.key} ${rule.operator}${value}`;
  }
  return `${response.rules.length} rules`;
};

const statusClass = (status: number) => (status >= 400 ? 'status-error' : status >= 300 ? 'status-redirect' : 'status-ok');

const selectRoute = (route: MockRoute) => {
  selectedRouteId.value = route.id;
  selectedResponseId.value = undefined;
};

/** 新建路由；从日志添加时带上方法和路径 */
const addRoute = (method: string = 'GET', path: string = '/') => {
  const normalizedMethod = (MOCK_HTTP_METHODS.includes(method.toUpperCase() as HttpMethod) ? method.toUpperCase() : 'GET') as HttpMethod;
  const route = createMockRoute({ method: normalizedMethod, path: normalizeMockPath(path) });
  service.value.routes.push(route);
  filter.value = '';
  selectedRouteId.value = route.id;
  selectedResponseId.value = route.responses[0]?.id;
};

const pathInput = ref<HTMLInputElement | null>(null);

/** 副本停用、路径加 -copy；选中副本并聚焦路径，方便改成新路径 */
const duplicateRoute = async () => {
  const route = selectedRoute.value;
  if (!route) return;
  const copy = duplicateMockRoute(route, service.value.routes);
  service.value.routes.splice(service.value.routes.indexOf(route) + 1, 0, copy);
  selectedRouteId.value = copy.id;
  selectedResponseId.value = undefined;
  filter.value = '';
  await nextTick();
  pathInput.value?.focus();
  pathInput.value?.select();
};

/** 路由的完整地址，路径参数换成示例值 1 */
const exampleUrl = computed(() => (
  selectedRoute.value ? `${mocksStore.baseUrl(service.value)}${mockExamplePath(selectedRoute.value.path)}` : ''
));

const copyUrl = async () => {
  try {
    await navigator.clipboard.writeText(exampleUrl.value);
    window.$toast?.add({ severity: 'success', summary: 'Copied', detail: 'URL copied to clipboard', life: 2000 });
  } catch {
    window.$toast?.add({ severity: 'error', summary: 'Error', detail: 'Failed to copy to clipboard', life: 3000 });
  }
};

/** 在临时请求中打开：带上 x-mock-response-name，发送后返回正在编辑的响应 */
const openAsRequest = () => {
  const route = selectedRoute.value;
  if (!route) return;
  const responseName = selectedResponse.value?.name.trim();
  emit('open-request', {
    method: route.method,
    path: mockExamplePath(route.path),
    headers: responseName ? { [MOCK_RESPONSE_NAME_HEADER]: responseName } : {},
    body: '',
  });
};

const routeMenu = ref<{ toggle: (event: Event) => void } | null>(null);
const routeMenuItems = [
  { label: 'Duplicate Route', icon: 'pi pi-clone', command: () => { void duplicateRoute(); } },
  { label: 'Delete Route', icon: 'pi pi-trash', class: 'route-menu-delete', command: () => deleteRoute() },
];

const deleteRoute = () => {
  const route = selectedRoute.value;
  if (!route) return;
  window.$confirm?.require({
    message: `Delete the route ${route.method} ${route.path} and its ${route.responses.length} response(s)?`,
    header: 'Confirm Deletion',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: () => {
      const index = service.value.routes.indexOf(route);
      service.value.routes.splice(index, 1);
      selectedRouteId.value = service.value.routes[Math.min(index, service.value.routes.length - 1)]?.id;
    },
  });
};

const normalizeRoutePath = () => {
  if (selectedRoute.value) selectedRoute.value.path = normalizeMockPath(selectedRoute.value.path);
};

const addResponse = () => {
  const route = selectedRoute.value;
  if (!route) return;
  const response = createMockResponse({
    name: `Response ${route.responses.length + 1}`,
    isDefault: route.responses.length === 0,
  });
  route.responses.push(response);
  selectedResponseId.value = response.id;
};

const duplicateResponse = () => {
  const route = selectedRoute.value;
  const response = selectedResponse.value;
  if (!route || !response) return;
  const copy: MockResponse = {
    ...cloneJson(response),
    id: generateId(),
    name: `${response.name} (Copy)`,
    isDefault: false,
    rules: response.rules.map(rule => ({ ...rule, id: generateId() })),
  };
  route.responses.splice(route.responses.indexOf(response) + 1, 0, copy);
  selectedResponseId.value = copy.id;
};

const deleteResponse = () => {
  const route = selectedRoute.value;
  const response = selectedResponse.value;
  if (!route || !response) return;
  const index = route.responses.indexOf(response);
  route.responses.splice(index, 1);
  if (response.isDefault && route.responses.length > 0 && !route.responses.some(item => item.isDefault)) {
    route.responses[0].isDefault = true;
  }
  selectedResponseId.value = route.responses[Math.min(index, route.responses.length - 1)]?.id;
};

const moveResponse = (offset: number) => {
  const route = selectedRoute.value;
  const index = selectedResponseIndex.value;
  if (!route || index < 0) return;
  const target = index + offset;
  if (target < 0 || target >= route.responses.length) return;
  const [moved] = route.responses.splice(index, 1);
  route.responses.splice(target, 0, moved);
};

/** 一个路由只有一个默认响应 */
const setDefault = (isDefault: boolean) => {
  const route = selectedRoute.value;
  const response = selectedResponse.value;
  if (!route || !response) return;
  if (isDefault) route.responses.forEach(item => { item.isDefault = item === response; });
  else response.isDefault = false;
};

const updateResponse = (next: MockResponse) => {
  const route = selectedRoute.value;
  const index = selectedResponseIndex.value;
  if (!route || index < 0) return;
  route.responses.splice(index, 1, next);
};

defineExpose({ addRoute });
</script>

<template>
  <div class="mock-routes h-full flex min-h-0">
    <!-- 路由列表 -->
    <div class="routes-list flex-shrink-0 w-64 border-r border-surface-200 dark:border-surface-700 p-2 flex flex-col gap-1.5 overflow-y-auto">
      <div class="flex gap-1.5">
        <InputText v-model="filter" placeholder="Filter routes" aria-label="Filter routes" size="small" class="flex-1 min-w-0" />
        <Button label="Route" icon="pi pi-plus" size="small" severity="secondary" @click="addRoute()" />
      </div>
      <div v-if="service.routes.length === 0" class="text-xs text-surface-500 text-center py-4">
        No routes yet. Add one, or create the service from a collection.
      </div>
      <button
        v-for="route in filteredRoutes"
        :key="route.id"
        type="button"
        class="route-row flex items-center gap-2 px-2 py-1.5 rounded text-left"
        :class="{ selected: route.id === selectedRoute?.id, disabled: !route.enabled }"
        :data-route="`${route.method} ${route.path}`"
        @click="selectRoute(route)"
      >
        <span class="font-mono text-[11px] w-12 flex-shrink-0" :class="methodColor(route.method)">{{ route.method }}</span>
        <span class="flex-1 min-w-0 truncate font-mono text-xs">{{ route.path }}</span>
        <span class="text-[11px] text-surface-500">{{ route.responses.length }}</span>
      </button>
    </div>

    <!-- 路由编辑 -->
    <div v-if="selectedRoute" class="flex-1 min-w-0 overflow-y-auto p-4 flex flex-col gap-3">
      <div class="flex gap-2 items-center flex-wrap">
        <Select v-model="selectedRoute.method" :options="MOCK_HTTP_METHODS" size="small" class="w-28" aria-label="Method" />
        <div class="flex-1 min-w-64 flex items-center border border-surface-300 dark:border-surface-600 rounded-md overflow-hidden">
          <span class="px-2 font-mono text-surface-500 bg-surface-50 dark:bg-surface-800 self-stretch flex items-center">{{ mocksStore.baseUrl(service) }}</span>
          <input
            ref="pathInput"
            v-model="selectedRoute.path"
            class="route-path flex-1 min-w-0 px-2 py-1.5 font-mono bg-transparent outline-none"
            aria-label="Path"
            placeholder="/orders/:id"
            @blur="normalizeRoutePath"
          />
          <Button icon="pi pi-copy" text size="small" severity="secondary" class="copy-url" :title="`Copy URL: ${exampleUrl}`" aria-label="Copy URL" @click="copyUrl" />
        </div>
        <label class="flex items-center gap-1.5"><Checkbox v-model="selectedRoute.enabled" binary /> Enabled</label>
        <Button label="Open as Request" icon="pi pi-external-link" size="small" severity="secondary" outlined @click="openAsRequest" />
        <Button icon="pi pi-ellipsis-h" text rounded size="small" severity="secondary" title="More" aria-label="Route actions" aria-haspopup="true" @click="routeMenu?.toggle($event)" />
        <Menu ref="routeMenu" :model="routeMenuItems" :popup="true" />
      </div>

      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between text-xs text-surface-500">
          <span>RESPONSES · picked by header, then the first whose rules match, then the default</span>
          <Button label="Add response" icon="pi pi-plus" text size="small" @click="addResponse" />
        </div>
        <div class="flex gap-2 flex-wrap">
          <button
            v-for="(response, index) in selectedRoute.responses"
            :key="response.id"
            type="button"
            class="response-chip flex items-center gap-2 px-2.5 py-1.5 rounded-lg border"
            :class="{ selected: response.id === selectedResponse?.id }"
            :data-response="response.name"
            @click="selectedResponseId = response.id"
          >
            <span class="text-[11px] text-surface-400">{{ index + 1 }}</span>
            <span class="font-mono text-xs px-1.5 rounded" :class="statusClass(response.status)">{{ response.status }}</span>
            <span class="font-medium">{{ response.name }}</span>
            <span class="text-[11px] text-surface-500">{{ responseTag(response) }}</span>
          </button>
        </div>
      </div>

      <MockResponseEditor
        v-if="selectedResponse"
        :key="selectedResponse.id"
        :response="selectedResponse"
        :route="selectedRoute"
        :default-delay-ms="service.defaultDelayMs"
        :index="selectedResponseIndex"
        :count="selectedRoute.responses.length"
        @update:response="updateResponse"
        @set-default="setDefault"
        @move="moveResponse"
        @duplicate="duplicateResponse"
        @delete="deleteResponse"
      />
      <div v-else class="text-surface-500 text-sm">This route has no responses. Calls to it get a 404.</div>
    </div>
    <div v-else class="flex-1 flex items-center justify-center text-surface-500">Add a route to start.</div>
  </div>
</template>

<style scoped>
.route-row:hover { background: var(--p-content-hover-background); }
.route-row.selected { background: var(--p-content-hover-background); font-weight: 500; }
.route-row.disabled { opacity: 0.5; }
.response-chip { border-color: var(--p-content-border-color); }
.response-chip.selected { border-color: #14b8a6; background: rgba(20, 184, 166, 0.12); }
.status-ok { background: #dcfce7; color: #166534; }
.status-redirect { background: #e0e7ff; color: #3730a3; }
.status-error { background: #fee2e2; color: #991b1b; }
.method-get { color: #16a34a; }
.method-post { color: #ea580c; }
.method-put { color: #2563eb; }
.method-patch { color: #9333ea; }
.method-delete { color: #dc2626; }
.method-head, .method-options { color: var(--p-text-muted-color); }
</style>

<style>
/* 弹出菜单挂在 body 上，不能用 scoped 样式 */
.route-menu-delete .p-menu-item-label,
.route-menu-delete .p-menu-item-icon { color: var(--p-red-500); }
</style>
