<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useMocksStore, MAX_MOCK_LOGS } from '@/stores/mocks';
import type { MockLogEntry, MockOpenRequest, MockService } from '@/types/models';
import { cloneJson } from '@/utils/clone';
import MockRoutesView from './MockRoutesView.vue';
import MockLogsView from './MockLogsView.vue';
import MockSettingsView from './MockSettingsView.vue';

const props = defineProps<{ serviceId: string }>();
const emit = defineEmits<{ 'open-request': [request: MockOpenRequest] }>();

const mocksStore = useMocksStore();
type View = 'routes' | 'logs' | 'settings';
const view = ref<View>('routes');

// 编辑用的副本：修改后整体写回 store（store 合并保存到文件）
const local = ref<MockService | null>(null);

const reload = () => {
  const service = mocksStore.getService(props.serviceId);
  local.value = service ? cloneJson(service) : null;
};
reload();

watch(() => props.serviceId, reload);
// 编辑页签以外的修改（如「Save to Mock」）后重新载入
watch(() => mocksStore.externalRevisions[props.serviceId], reload);

watch(local, (next) => {
  if (!next) return;
  void mocksStore.updateService(cloneJson(next));
}, { deep: true });

const isRunning = computed(() => Boolean(mocksStore.running[props.serviceId]));
const error = computed(() => mocksStore.errors[props.serviceId]);
const baseUrl = computed(() => (local.value ? mocksStore.baseUrl(local.value) : ''));
const logCount = computed(() => mocksStore.logs[props.serviceId]?.length || 0);

const toggleRunning = async () => {
  if (isRunning.value) await mocksStore.stop(props.serviceId);
  else await mocksStore.start(props.serviceId);
};

const copyBaseUrl = async () => {
  try {
    await navigator.clipboard.writeText(baseUrl.value);
    window.$toast?.add({ severity: 'success', summary: 'Copied', detail: 'Base URL copied to clipboard', life: 2000 });
  } catch {
    window.$toast?.add({ severity: 'error', summary: 'Error', detail: 'Failed to copy to clipboard', life: 3000 });
  }
};

/** 日志中的「Open as Request」：用这次调用新建请求，去掉由客户端生成的请求头 */
const openLoggedRequest = (entry: MockLogEntry) => emit('open-request', {
  method: entry.method,
  path: `${entry.path}${entry.query ? `?${entry.query}` : ''}`,
  headers: Object.fromEntries(entry.request.headers
    .filter(([key]) => !/^(host|content-length|connection|accept-encoding)$/i.test(key))),
  body: entry.request.body,
});

/** 从日志的「Add Route」切到 Routes 并新建路由 */
const routesView = ref<InstanceType<typeof MockRoutesView> | null>(null);
const addRouteFromLog = async (method: string, path: string) => {
  view.value = 'routes';
  // Routes 视图要等切换后才挂载
  await nextTick();
  routesView.value?.addRoute(method, path);
};

defineExpose({ showView: (next: View) => { view.value = next; } });
</script>

<template>
  <div v-if="local" class="mock-workspace h-full flex flex-col overflow-hidden bg-surface-0 dark:bg-surface-950 text-sm">
    <div class="flex items-center gap-3 px-4 py-3 border-b border-surface-200 dark:border-surface-700 flex-wrap">
      <span class="text-base font-semibold text-surface-900 dark:text-surface-0">{{ local.name }}</span>
      <span
        class="mock-state flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full"
        :class="error ? 'error' : isRunning ? 'running' : 'stopped'"
      >
        <span class="mock-state-dot"></span>{{ error ? 'Failed to start' : isRunning ? 'Running' : 'Stopped' }}
      </span>
      <span class="font-mono text-surface-700 dark:text-surface-200">{{ baseUrl }}</span>
      <Button label="Copy" text size="small" @click="copyBaseUrl" />
      <span v-if="error" class="text-xs text-red-600 dark:text-red-400">{{ error }}</span>
      <span class="flex-1"></span>
      <Button
        :label="isRunning ? 'Stop' : 'Start'"
        :icon="isRunning ? 'pi pi-stop-circle' : 'pi pi-play'"
        size="small"
        :severity="isRunning ? 'secondary' : undefined"
        :outlined="isRunning"
        @click="toggleRunning"
      />
    </div>

    <Tabs v-model:value="view">
      <TabList>
        <Tab value="routes">Routes ({{ local.routes.length }})</Tab>
        <Tab value="logs">Logs ({{ logCount }} / {{ MAX_MOCK_LOGS }})</Tab>
        <Tab value="settings">Settings</Tab>
      </TabList>
    </Tabs>

    <div class="flex-1 min-h-0 overflow-hidden">
      <MockRoutesView
        v-if="view === 'routes'"
        ref="routesView"
        v-model:service="local"
        @open-request="(request: MockOpenRequest) => emit('open-request', request)"
      />
      <MockLogsView
        v-else-if="view === 'logs'"
        :service-id="serviceId"
        @add-route="addRouteFromLog"
        @open-request="openLoggedRequest"
      />
      <MockSettingsView v-else v-model:service="local" :is-running="isRunning" />
    </div>
  </div>
  <div v-else class="h-full flex items-center justify-center text-surface-500">This mock service no longer exists.</div>
</template>

<style scoped>
.mock-state.running { background: rgba(22, 163, 74, 0.14); color: #16a34a; }
.mock-state.stopped { background: var(--p-content-hover-background); color: var(--p-text-muted-color); }
.mock-state.error { background: rgba(220, 38, 38, 0.12); color: #dc2626; }
.mock-state-dot { width: 7px; height: 7px; border-radius: 999px; background: currentColor; }
</style>
