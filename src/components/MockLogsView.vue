<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMocksStore, MAX_MOCK_LOGS } from '@/stores/mocks';
import type { MockLogEntry, MockLogSummary } from '@/types/models';
import { beautifyJsonText } from '@/utils/beautifyJson';
import CodeEditor from './CodeEditor.vue';

const props = defineProps<{ serviceId: string }>();
const emit = defineEmits<{
  'add-route': [method: string, path: string];
  'open-request': [entry: MockLogEntry];
}>();

const mocksStore = useMocksStore();
const filter = ref('');
const unmatchedOnly = ref(false);
const selectedId = ref<string | null>(null);
const detail = ref<MockLogEntry | null>(null);
const loadingDetail = ref(false);

const summaries = computed(() => mocksStore.logs[props.serviceId] || []);
const filtered = computed(() => {
  const query = filter.value.trim().toLowerCase();
  return summaries.value.filter(log => (!unmatchedOnly.value || !log.route || log.reason)
    && (!query || `${log.method} ${log.path}?${log.query} ${log.status}`.toLowerCase().includes(query)));
});

const timeOf = (log: MockLogSummary) => new Date(log.time).toLocaleTimeString(undefined, { hour12: false });
const urlOf = (log: MockLogSummary) => (log.query ? `${log.path}?${log.query}` : log.path);
const matchedOf = (log: MockLogSummary) => (log.route
  ? `${log.route}${log.responseName ? ` · ${log.responseName}` : ''}`
  : 'No route matches');
const statusClass = (status: number) => (status >= 400 ? 'status-error' : status >= 300 ? 'status-redirect' : 'status-ok');
const methodClass = (method: string) => `method-${method.toLowerCase()}`;

const select = async (log: MockLogSummary) => {
  selectedId.value = log.id;
  loadingDetail.value = true;
  try {
    const entry = await mocksStore.loadLogEntry(props.serviceId, log.id);
    if (selectedId.value === log.id) detail.value = entry;
  } finally {
    loadingDetail.value = false;
  }
};

// 打开时显示最新的一条
watch(summaries, (list) => {
  if (!selectedId.value && list.length > 0) void select(list[0]);
  if (selectedId.value && !list.some(log => log.id === selectedId.value)) {
    selectedId.value = null;
    detail.value = null;
  }
}, { immediate: true });

const contentType = (headers: Array<[string, string]>) => headers.find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '';
const formatBody = (body: string, headers: Array<[string, string]>) => {
  if (!body) return '';
  if (contentType(headers).includes('json') || /^\s*[[{]/.test(body)) {
    try {
      return beautifyJsonText(body);
    } catch {
      return body;
    }
  }
  return body;
};
const bodyLanguage = (headers: Array<[string, string]>) => (contentType(headers).includes('xml') ? 'xml' : contentType(headers).includes('json') ? 'json' : 'text');

const clear = () => {
  window.$confirm?.require({
    message: 'Delete all logged calls of this mock service?',
    header: 'Clear Logs',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Clear',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: () => void mocksStore.clearLogs(props.serviceId),
  });
};
</script>

<template>
  <div class="mock-logs h-full flex min-h-0">
    <div class="logs-list shrink-0 w-104 max-w-[45%] border-r border-surface-200 dark:border-surface-700 flex flex-col min-h-0">
      <div class="flex gap-2 p-2 border-b border-surface-200 dark:border-surface-700 items-center flex-wrap">
        <InputText v-model="filter" placeholder="Filter by path or status" aria-label="Filter logs" size="small" class="flex-1 min-w-32" />
        <label class="flex items-center gap-1.5 text-xs"><Checkbox v-model="unmatchedOnly" binary /> Unmatched only</label>
        <Button label="Clear" text size="small" severity="secondary" :disabled="summaries.length === 0" @click="clear" />
      </div>
      <div class="px-3 py-2 text-xs text-surface-500 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900">
        Latest {{ MAX_MOCK_LOGS }} calls, saved on this computer and kept after ApiKit restarts. Older calls are removed.
      </div>
      <div class="flex-1 overflow-y-auto">
        <div v-if="filtered.length === 0" class="text-xs text-surface-500 text-center py-6">
          {{ summaries.length === 0 ? 'No calls yet. Start the service and send a request to it.' : 'No matching calls' }}
        </div>
        <button
          v-for="log in filtered"
          :key="log.id"
          type="button"
          class="log-row w-full grid items-center gap-2 px-3 py-2 text-left border-b border-surface-100 dark:border-surface-800 cursor-pointer"
          :class="{ selected: log.id === selectedId }"
          :data-log-path="urlOf(log)"
          @click="select(log)"
        >
          <span class="font-mono text-[11px] text-surface-500">{{ timeOf(log) }}</span>
          <span class="font-mono text-xs" :class="methodClass(log.method)">{{ log.method }}</span>
          <span class="min-w-0 flex flex-col">
            <span class="font-mono text-xs truncate">{{ urlOf(log) }}</span>
            <span class="text-[11px] truncate" :class="log.route ? 'text-surface-500' : 'text-amber-700 dark:text-amber-400'">{{ matchedOf(log) }}</span>
          </span>
          <span class="font-mono text-xs text-right px-1 rounded" :class="statusClass(log.status)">{{ log.status }}</span>
        </button>
      </div>
    </div>

    <div class="flex-1 min-w-0 overflow-y-auto p-4 flex flex-col gap-3">
      <div v-if="!detail" class="text-surface-500">{{ loadingDetail ? 'Loading…' : 'Select a call to see the request and response.' }}</div>
      <template v-else>
        <div class="flex items-center gap-2.5 flex-wrap">
          <span class="font-mono" :class="methodClass(detail.method)">{{ detail.method }}</span>
          <span class="font-mono flex-1 min-w-48 break-all">{{ mocksStore.baseUrl(mocksStore.getService(serviceId) || { port: 0 }) }}{{ urlOf(detail) }}</span>
          <Button label="Open as Request" size="small" severity="secondary" outlined @click="emit('open-request', detail)" />
        </div>
        <div
          class="match-banner flex items-center gap-2.5 px-3 py-2 rounded-lg flex-wrap"
          :class="detail.reason ? 'unmatched' : 'matched'"
        >
          <span class="font-mono text-xs px-1.5 rounded" :class="statusClass(detail.status)">{{ detail.status }}</span>
          <span v-if="detail.route && detail.responseName">
            Route <span class="font-mono">{{ detail.route }}</span> → response <strong>{{ detail.responseName }}</strong>
          </span>
          <span v-else>{{ detail.reason }}</span>
          <span class="flex-1"></span>
          <span class="text-surface-500">{{ detail.durationMs }} ms</span>
          <Button
            v-if="!detail.route"
            label="Add Route"
            icon="pi pi-plus"
            size="small"
            @click="emit('add-route', detail.method, detail.path)"
          />
        </div>

        <div class="grid gap-4 detail-columns">
          <section class="flex flex-col gap-2 min-w-0">
            <span class="font-semibold">Request</span>
            <div class="header-table border border-surface-200 dark:border-surface-700 rounded-lg text-xs">
              <div v-for="([key, value], index) in detail.request.headers" :key="index" class="header-row grid gap-2.5 px-2.5 py-1.5">
                <span class="text-surface-600 dark:text-surface-300">{{ key }}</span>
                <span class="font-mono break-all">{{ value }}</span>
              </div>
              <div v-if="detail.request.headers.length === 0" class="px-2.5 py-1.5 text-surface-500">No headers</div>
            </div>
            <div v-if="detail.request.body" class="log-body border border-surface-200 dark:border-surface-700 rounded overflow-hidden">
              <CodeEditor :model-value="formatBody(detail.request.body, detail.request.headers)" :language="bodyLanguage(detail.request.headers)" read-only />
            </div>
            <span v-else class="text-xs text-surface-500">No body</span>
          </section>
          <section class="flex flex-col gap-2 min-w-0">
            <span class="font-semibold">Response</span>
            <div class="header-table border border-surface-200 dark:border-surface-700 rounded-lg text-xs">
              <div v-for="([key, value], index) in detail.response.headers" :key="index" class="header-row grid gap-2.5 px-2.5 py-1.5">
                <span class="text-surface-600 dark:text-surface-300">{{ key }}</span>
                <span class="font-mono break-all">{{ value }}</span>
              </div>
            </div>
            <div v-if="detail.response.body" class="log-body border border-surface-200 dark:border-surface-700 rounded overflow-hidden">
              <CodeEditor :model-value="formatBody(detail.response.body, detail.response.headers)" :language="bodyLanguage(detail.response.headers)" read-only />
            </div>
            <span v-else class="text-xs text-surface-500">No body</span>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.log-row { grid-template-columns: 4rem 3.25rem minmax(0, 1fr) 2.5rem; }
.log-row:hover, .log-row.selected { background: var(--p-content-hover-background); }
.match-banner.matched { background: rgba(20, 184, 166, 0.1); border: 1px solid rgba(20, 184, 166, 0.45); }
.match-banner.unmatched { background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.5); }
.detail-columns { grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); }
.header-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr); }
.header-row + .header-row { border-top: 1px solid var(--p-content-border-color); }
.log-body { height: 16rem; }
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
