<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useWorkflowsStore } from '@/stores/workflows';
import type { WorkflowRunLog } from '@/types/models';
import { formatJsonPreservingNumbers } from '@/utils/jsonFormat';
import { getOperatorLabel } from '@/constants/testOperators';
import {
  buildWorkflowLogTree,
  flattenWorkflowLogTree,
  isWorkflowLogNearBottom,
  resolveWorkflowLogExpandedKeys,
  type WorkflowLogTreeNode,
  type WorkflowLogTreeRow,
} from '@/utils/workflowLogTree';
import {
  canInspectWorkflowLog,
  formatWorkflowConditionTarget,
  formatWorkflowLogValue,
  getRequestTestStats,
  getWorkflowLogDiagnosticSummaries,
} from '@/utils/workflowLogPresentation';

const props = defineProps<{
  visible: boolean;
  workflowId?: string;
  workflowName?: string;
}>();

const emit = defineEmits(['update:visible']);

const workflowsStore = useWorkflowsStore();
const selectedLog = ref<WorkflowRunLog | null>(null);

const selectedAssertions = computed(() => {
  const results = selectedLog.value?.testResults;
  if (!results) return [];
  return [
    ...(results.statusCode || []).map(result => ({ ...result, typeLabel: 'Status code', subject: 'HTTP status' })),
    ...(results.jsonFields || []).map(result => ({ ...result, typeLabel: 'JSON field', subject: result.jsonPath || 'JSON path' })),
  ];
});

const selectedTestStats = computed(() => getRequestTestStats(selectedLog.value?.testResults));
const selectedGlobalVariables = computed(() => selectedLog.value?.testResults?.globalVars || []);
const selectedGlobalVariableStats = computed(() => ({
  set: selectedGlobalVariables.value.filter(result => result.success).length,
  total: selectedGlobalVariables.value.length,
}));

const getGlobalVariableStatus = (result: { success: boolean; status?: string }) => (
  result.status || (result.success ? 'set' : 'failed')
);

const getGlobalVariableSeverity = (result: { success: boolean; status?: string }) => {
  const status = getGlobalVariableStatus(result);
  if (status === 'set') return 'success';
  if (status === 'skipped') return 'warn';
  return 'danger';
};

const getGlobalVariableName = (result: { variableName?: string; message: string }) => (
  result.variableName || result.message.split(' = ')[0].replace(/^Set /, '').replace(/^Failed to set /, '')
);

const getGlobalVariableValue = (result: { value?: string; message: string }) => (
  result.value ?? result.message.split(' = ')[1] ?? '-'
);

const lifecycleRowClasses = [
  'bg-sky-50/80 dark:bg-sky-950/30',
  'bg-emerald-50/80 dark:bg-emerald-950/30',
  'bg-violet-50/80 dark:bg-violet-950/30',
  'bg-amber-50/80 dark:bg-amber-950/30',
  'bg-cyan-50/80 dark:bg-cyan-950/30',
];
const lifecycleBadgeClasses = [
  '!bg-sky-500 !text-white dark:!bg-sky-400 dark:!text-sky-950',
  '!bg-emerald-500 !text-white dark:!bg-emerald-400 dark:!text-emerald-950',
  '!bg-violet-500 !text-white dark:!bg-violet-400 dark:!text-violet-950',
  '!bg-amber-500 !text-white dark:!bg-amber-400 dark:!text-amber-950',
  '!bg-cyan-500 !text-white dark:!bg-cyan-400 dark:!text-cyan-950',
];

const expandedKeys = ref<Record<string, boolean>>({});
const manualExpandedKeys = ref<Record<string, boolean>>({});
const followLatest = ref(true);
const logScrollContainer = ref<HTMLElement | null>(null);
const activeTreeRootId = ref('');
let scrollRequest = 0;
let programmaticScroll = false;

const treeNodes = computed<WorkflowLogTreeNode[]>(() => {
  if (!props.workflowId) return [];
  return buildWorkflowLogTree(workflowsStore.getWorkflowLogs(props.workflowId));
});

const rows = computed(() => flattenWorkflowLogTree(treeNodes.value));

const scrollToLatest = async () => {
  if (!followLatest.value) return;
  const request = ++scrollRequest;
  programmaticScroll = true;
  await nextTick();
  if (request !== scrollRequest || !followLatest.value) return;

  const container = logScrollContainer.value;
  if (!container) {
    programmaticScroll = false;
    return;
  }
  container.scrollTop = container.scrollHeight;
  window.requestAnimationFrame(() => {
    if (request === scrollRequest) programmaticScroll = false;
  });
};

const syncExpandedKeys = (nodes: WorkflowLogTreeNode[], isNewTree: boolean = false) => {
  if (isNewTree) manualExpandedKeys.value = {};
  expandedKeys.value = resolveWorkflowLogExpandedKeys(
    manualExpandedKeys.value,
    nodes,
    isNewTree,
    followLatest.value,
  );
};

const pauseFollowLatest = () => {
  if (!followLatest.value) return;
  manualExpandedKeys.value = { ...expandedKeys.value };
  followLatest.value = false;
  scrollRequest++;
  programmaticScroll = false;
};

const resumeFollowLatest = () => {
  manualExpandedKeys.value = {};
  followLatest.value = true;
  syncExpandedKeys(treeNodes.value);
  void scrollToLatest();
};

const toggleFollowLatest = () => {
  if (followLatest.value) pauseFollowLatest();
  else resumeFollowLatest();
};

const setLogScrollContainer = (element: HTMLElement | null) => {
  logScrollContainer.value = element;
  if (element && followLatest.value) void scrollToLatest();
};

const handleLogScroll = (event: Event) => {
  if (!followLatest.value || programmaticScroll) return;
  const container = event.currentTarget as HTMLElement;
  if (!isWorkflowLogNearBottom(container.scrollTop, container.clientHeight, container.scrollHeight)) {
    pauseFollowLatest();
  }
};

const handleTreeToggle = (node: { key?: string | number }, expanded: boolean) => {
  if (node.key === undefined) return;
  const key = String(node.key);
  const next = { ...expandedKeys.value };
  if (expanded) next[key] = true;
  else delete next[key];
  expandedKeys.value = next;
  manualExpandedKeys.value = next;
  followLatest.value = false;
  scrollRequest++;
  programmaticScroll = false;
};

watch(treeNodes, nodes => {
  const rootId = nodes[0]?.key || '';
  const isNewTree = rootId !== activeTreeRootId.value;
  activeTreeRootId.value = rootId;
  syncExpandedKeys(nodes, isNewTree);
  if (followLatest.value) void scrollToLatest();
}, { immediate: true });

watch(() => workflowsStore.runningWorkflowId, (newRunningId) => {
  if (newRunningId === props.workflowId) {
    selectedLog.value = null;
    manualExpandedKeys.value = {};
    expandedKeys.value = {};
    activeTreeRootId.value = '';
    followLatest.value = true;
  }
});

watch(() => props.visible, visible => {
  if (visible) resumeFollowLatest();
}, { immediate: true });

const canInspect = (log: WorkflowRunLog) => canInspectWorkflowLog(log);

const selectLog = (log: WorkflowRunLog) => {
  if (!canInspect(log)) return;
  const nextLog = selectedLog.value?.id === log.id ? null : log;
  if (nextLog) pauseFollowLatest();
  selectedLog.value = nextLog;
};

const closeSelectedLog = () => {
  selectedLog.value = null;
};

const clearLogs = () => {
  if (!props.workflowId) return;
  workflowsStore.clearWorkflowLogs(props.workflowId);
  selectedLog.value = null;
  expandedKeys.value = {};
  manualExpandedKeys.value = {};
  activeTreeRootId.value = '';
};

const getStatusColor = (status: number) => {
  if (status >= 200 && status < 300) return 'text-green-600 dark:text-green-400';
  if (status >= 400) return 'text-red-600 dark:text-red-400';
  return 'text-yellow-600 dark:text-yellow-400';
};

const getMethodColor = (method?: string) => {
  const colors: Record<string, string> = {
    GET: 'text-green-600 dark:text-green-400',
    POST: 'text-blue-600 dark:text-blue-400',
    PUT: 'text-yellow-600 dark:text-yellow-400',
    DELETE: 'text-red-600 dark:text-red-400',
    PATCH: 'text-purple-600 dark:text-purple-400',
  };
  return method ? colors[method] || 'text-surface-600' : 'text-surface-600';
};

const getStatusSeverity = (log: WorkflowRunLog) => {
  if (log.level === 'error' || log.status === 'failed') return 'danger';
  if (log.level === 'success' || log.status === 'passed' || log.status === 'completed') return 'success';
  if (log.level === 'warn' || log.status === 'stopped') return 'warn';
  return 'info';
};

const getRowClass = (log: WorkflowLogTreeRow) => {
  if (selectedLog.value?.id === log.id) return 'bg-surface-50 dark:bg-surface-900';
  if (log.level === 'error' || log.status === 'failed') return 'bg-red-50/80 dark:bg-red-950/30';
  if (log.level === 'warn' || log.status === 'stopped') return 'bg-amber-50/80 dark:bg-amber-950/30';
  if (log.lifecycleDepth === undefined) {
    return '';
  }
  return lifecycleRowClasses[log.lifecycleDepth % lifecycleRowClasses.length];
};

const getStatusBadgeClass = (log: WorkflowLogTreeRow) => {
  if (log.level === 'error' || log.status === 'failed' || log.level === 'warn' || log.status === 'stopped') {
    return '';
  }
  if (log.lifecycleDepth === undefined) {
    return '';
  }
  return `${lifecycleBadgeClasses[log.lifecycleDepth % lifecycleBadgeClasses.length]} ring-1 ring-inset ring-current/20`;
};

const getNodeRowClass = (node: WorkflowLogTreeNode | WorkflowLogTreeRow) => getRowClass('data' in node ? node.data : node);

const getTypeLabel = (log: WorkflowRunLog) => {
  if (log.iteration !== undefined) return 'Iteration';
  const labels: Record<string, string> = {
    workflow: 'Workflow',
    request: 'Request',
    if: 'If',
    for: 'For',
    while: 'While',
    doWhile: 'Do While',
    until: 'Until',
  };
  return labels[log.stepType] || log.stepType;
};

const getStepTitle = (log: WorkflowRunLog) => log.iteration === undefined
  ? log.stepName
  : `Iteration ${log.iteration}${log.iterationTotal ? `/${log.iterationTotal}` : ''}`;

const formatLogMessage = (log: WorkflowRunLog) => {
  if (!log.requestCount) return log.message;
  const summary = `${log.passedRequestCount || 0}/${log.requestCount} request${log.requestCount === 1 ? '' : 's'} passed`;
  return log.failedRequestCount
    ? `${log.message} · ${summary} · ${log.failedRequestCount} failed`
    : `${log.message} · ${summary}`;
};

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const getConditionResultLabel = (log: WorkflowRunLog) => log.conditionResult === undefined
  ? 'not evaluated'
  : log.conditionResult ? 'passed' : 'failed';

const getConditionResultSeverity = (log: WorkflowRunLog) => log.conditionResult === undefined
  ? 'secondary'
  : log.conditionResult ? 'success' : 'danger';

const getConditionExpectedValue = (log: WorkflowRunLog) => {
  if (!log.condition) return '-';
  return ['exists', 'notExists'].includes(log.condition.operator)
    ? 'Not required'
    : formatWorkflowLogValue(log.condition.expectedValue);
};

const formatJson = (value: any) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') {
    try {
      // String-based formatter keeps large integers (e.g. Long) at full precision,
      // unlike JSON.parse which rounds beyond Number.MAX_SAFE_INTEGER.
      return formatJsonPreservingNumbers(value);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
};

const copyLogBody = async (value: any, label: string) => {
  try {
    await navigator.clipboard.writeText(formatJson(value));
    window.$toast?.add({
      severity: 'success',
      summary: 'Copied',
      detail: `${label} copied to clipboard`,
      life: 2000,
    });
  } catch (error) {
    console.error('Failed to copy workflow log:', error);
    window.$toast?.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to copy to clipboard',
      life: 3000,
    });
  }
};
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    maximizable
    class="w-[90vw]"
    :style="{ height: '75vh' }"
    @update:visible="emit('update:visible', $event)"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <i class="pi pi-list"></i>
        <span class="font-semibold">{{ workflowName || 'Workflow' }} Log</span>
        <Badge v-if="rows.length > 0" :value="rows.length" severity="info" class="text-badge" />
      </div>
    </template>

    <div class="h-full flex flex-col overflow-hidden">
      <div class="flex justify-between items-center pb-2 border-b border-surface-200 dark:border-surface-700">
        <span class="text-meta text-surface-500">{{ rows.length }} record(s)</span>
        <div class="flex items-center gap-1">
          <Button
            v-if="rows.length > 0"
            :label="followLatest ? 'Following latest' : 'Jump to latest'"
            :icon="followLatest ? 'pi pi-arrow-down' : 'pi pi-angle-double-down'"
            size="small"
            :severity="followLatest ? 'secondary' : 'info'"
            :text="followLatest"
            :outlined="!followLatest"
            :title="followLatest ? 'Pause live log tracking' : 'Resume live log tracking'"
            @click="toggleFollowLatest"
          />
          <Button label="Clear" icon="pi pi-trash" size="small" text @click="clearLogs" />
        </div>
      </div>

      <div class="flex-1 min-h-0">
        <div v-if="rows.length === 0" class="text-center text-surface-400 dark:text-surface-500 text-xs py-8">
          No workflow logs yet
        </div>

        <TreeTable
          v-else
          v-model:expandedKeys="expandedKeys"
          :value="treeNodes"
          :rowClass="getNodeRowClass"
          :pt="{ tableContainer: { ref: setLogScrollContainer, onScroll: handleLogScroll } }"
          scrollable
          scrollHeight="flex"
          class="workflow-log-tree text-xs"
          tableStyle="min-width: 980px"
          @node-expand="handleTreeToggle($event, true)"
          @node-collapse="handleTreeToggle($event, false)"
        >
          <Column header="Path" style="width: 5rem">
            <template #body="{ node }">
              <span class="text-meta text-surface-500 font-mono" :title="`Event #${node.data.sequence || '-'}`">{{ node.data.treePath }}</span>
            </template>
          </Column>
          <Column header="Time" style="width: 10rem">
            <template #body="{ node }">
              <span class="text-meta text-surface-500 whitespace-nowrap">{{ formatTime(node.data.timestamp) }}</span>
            </template>
          </Column>
          <Column header="Level" style="width: 7rem">
            <template #body="{ node }">
              <Badge :value="node.data.status" :severity="getStatusSeverity(node.data)" :class="['text-badge', getStatusBadgeClass(node.data)]" />
            </template>
          </Column>
          <Column header="Type" style="width: 8rem">
            <template #body="{ node }">
              <span class="font-semibold">{{ getTypeLabel(node.data) }}</span>
            </template>
          </Column>
          <Column header="Step" expander style="min-width: 20rem">
            <template #body="{ node }">
              <div
                :class="canInspect(node.data) ? 'cursor-pointer' : ''"
                @click="selectLog(node.data)"
              >
                <div class="font-medium text-surface-700 dark:text-surface-200 truncate" :title="getStepTitle(node.data)">{{ getStepTitle(node.data) }}</div>
                <div class="flex items-center gap-2 min-w-0 mt-0.5">
                  <span class="text-surface-500 truncate min-w-0" :title="formatLogMessage(node.data)">{{ formatLogMessage(node.data) }}</span>
                  <span
                    v-for="summary in getWorkflowLogDiagnosticSummaries(node.data)"
                    :key="summary.kind"
                    :title="summary.title"
                    :class="[
                      'inline-block flex-shrink-0 max-w-64 truncate rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      summary.severity === 'success'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300'
                        : summary.severity === 'danger'
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300'
                          : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300',
                    ]"
                  >
                    {{ summary.label }}
                  </span>
                </div>
              </div>
            </template>
          </Column>
          <Column header="Duration" style="width: 6rem">
            <template #body="{ node }">
              <span class="text-surface-500">{{ node.data.durationMs !== undefined ? `${node.data.durationMs}ms` : '-' }}</span>
            </template>
          </Column>
          <Column header="Details" style="width: 5rem">
            <template #body="{ node }">
              <Button
                v-if="canInspect(node.data)"
                :icon="selectedLog?.id === node.data.id ? 'pi pi-times' : 'pi pi-search'"
                text
                rounded
                size="small"
                severity="secondary"
                :title="selectedLog?.id === node.data.id ? 'Close details' : 'View details'"
                :aria-label="selectedLog?.id === node.data.id ? 'Close log details' : 'View log details'"
                @click.stop="selectLog(node.data)"
              />
              <span v-else class="text-surface-400">-</span>
            </template>
          </Column>
        </TreeTable>
      </div>

      <div
        v-if="selectedLog"
        class="flex-shrink-0 h-[82.5%] max-h-[calc(100%-5rem)] min-h-80 overflow-y-auto border-t border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-950 p-3"
      >
        <div class="flex items-center justify-between gap-3 mb-3">
          <div class="min-w-0">
            <div class="font-semibold text-surface-800 dark:text-surface-100 truncate">{{ selectedLog.stepName }}</div>
            <div class="text-xs text-surface-500 truncate">{{ selectedLog.message }}</div>
          </div>
          <Button icon="pi pi-times" label="Close" size="small" text severity="secondary" @click="closeSelectedLog" />
        </div>

        <div
          v-if="selectedLog.condition"
          class="mb-4 p-3 rounded border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 text-xs"
        >
          <div class="flex items-center justify-between gap-3 mb-3">
            <h4 class="font-semibold text-surface-700 dark:text-surface-300">Condition</h4>
            <Badge
              :value="getConditionResultLabel(selectedLog)"
              :severity="getConditionResultSeverity(selectedLog)"
              class="text-badge"
            />
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div class="p-2 rounded bg-surface-0 dark:bg-surface-950 min-w-0">
              <div class="font-semibold text-surface-500 mb-1">Target</div>
              <div class="font-mono break-all">{{ formatWorkflowConditionTarget(selectedLog) }}</div>
            </div>
            <div class="p-2 rounded bg-surface-0 dark:bg-surface-950 min-w-0">
              <div class="font-semibold text-surface-500 mb-1">Operator</div>
              <div class="font-mono break-all">{{ getOperatorLabel(selectedLog.condition.operator) }}</div>
            </div>
            <div class="p-2 rounded bg-surface-0 dark:bg-surface-950 min-w-0">
              <div class="font-semibold text-surface-500 mb-1">Expected</div>
              <div class="font-mono break-all">{{ getConditionExpectedValue(selectedLog) }}</div>
            </div>
            <div class="p-2 rounded bg-surface-0 dark:bg-surface-950 min-w-0">
              <div class="font-semibold text-surface-500 mb-1">Actual</div>
              <div class="font-mono whitespace-pre-wrap break-all">{{ formatWorkflowLogValue(selectedLog.actualValue) }}</div>
            </div>
          </div>
        </div>

        <div
          v-if="selectedLog.request || selectedLog.response || selectedLog.testResults"
          class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs"
        >
          <div class="min-h-full">
            <h4 class="font-semibold text-surface-700 dark:text-surface-300 mb-2">Request</h4>
            <div class="space-y-2">
              <div>
                <span class="text-surface-500">Method:</span>
                <span :class="['ml-2 font-semibold', getMethodColor(selectedLog.request?.method)]">{{ selectedLog.request?.method || '-' }}</span>
              </div>
              <div>
                <span class="text-surface-500">URL:</span>
                <span class="ml-2 text-surface-700 dark:text-surface-300 break-all">{{ selectedLog.request?.url || '-' }}</span>
              </div>
              <div v-if="selectedLog.request?.requestHeaders && Object.keys(selectedLog.request.requestHeaders).length > 0">
                <span class="text-surface-500 font-semibold">Headers:</span>
                <pre class="mt-1 p-2 bg-surface-100 dark:bg-surface-900 rounded overflow-x-auto max-h-64">{{ formatJson(selectedLog.request.requestHeaders) }}</pre>
              </div>
              <div v-if="selectedLog.request?.requestBody">
                <div class="flex items-center gap-1">
                  <span class="text-surface-500 font-semibold">Body:</span>
                  <Button
                    icon="pi pi-copy"
                    size="small"
                    text
                    rounded
                    severity="secondary"
                    aria-label="Copy request body"
                    title="Copy request body"
                    @click="copyLogBody(selectedLog.request.requestBody, 'Request body')"
                  />
                </div>
                <pre class="mt-1 p-2 bg-surface-100 dark:bg-surface-900 rounded overflow-x-auto max-h-80">{{ formatJson(selectedLog.request.requestBody) }}</pre>
              </div>
            </div>
          </div>

          <div class="min-h-full">
            <h4 class="font-semibold text-surface-700 dark:text-surface-300 mb-2">Response</h4>
            <div class="space-y-2">
              <div>
                <span class="text-surface-500">Status:</span>
                <span v-if="selectedLog.response" :class="['ml-2 font-semibold', getStatusColor(selectedLog.response.status)]">
                  {{ selectedLog.response.status }} {{ selectedLog.response.statusText }}
                </span>
                <span v-else class="ml-2 text-surface-400">-</span>
              </div>
              <div>
                <span class="text-surface-500">Duration:</span>
                <span class="ml-2 text-surface-700 dark:text-surface-300">{{ selectedLog.durationMs !== undefined ? `${selectedLog.durationMs}ms` : '-' }}</span>
              </div>
              <div v-if="selectedLog.response?.headers && Object.keys(selectedLog.response.headers).length > 0">
                <span class="text-surface-500 font-semibold">Headers:</span>
                <pre class="mt-1 p-2 bg-surface-100 dark:bg-surface-900 rounded overflow-x-auto max-h-64">{{ formatJson(selectedLog.response.headers) }}</pre>
              </div>
              <div v-if="selectedLog.response?.rawBody || selectedLog.response?.body">
                <div class="flex items-center gap-1">
                  <span class="text-surface-500 font-semibold">Body:</span>
                  <Button
                    icon="pi pi-copy"
                    size="small"
                    text
                    rounded
                    severity="secondary"
                    aria-label="Copy response body"
                    title="Copy response body"
                    @click="copyLogBody(selectedLog.response.rawBody || selectedLog.response.body, 'Response body')"
                  />
                </div>
                <pre class="mt-1 p-2 bg-surface-100 dark:bg-surface-900 rounded overflow-x-auto max-h-80">{{ formatJson(selectedLog.response.rawBody || selectedLog.response.body) }}</pre>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="selectedAssertions.length > 0 || selectedGlobalVariables.length > 0"
          class="mt-4 pt-4 border-t border-surface-200 dark:border-surface-700 text-xs"
        >
          <div class="flex items-center justify-between gap-3 mb-3">
            <h4 class="font-semibold text-surface-700 dark:text-surface-300">Tests</h4>
            <span v-if="selectedAssertions.length > 0" class="text-surface-500">{{ selectedTestStats?.passed || 0 }}/{{ selectedTestStats?.total || 0 }} passed</span>
            <span v-else class="text-surface-400">No assertions</span>
          </div>
          <div v-if="selectedAssertions.length > 0" class="space-y-2">
            <div
              v-for="(result, index) in selectedAssertions"
              :key="`${result.typeLabel}-${result.index}-${index}`"
              class="p-3 rounded border"
              :class="result.passed
                ? 'bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800'"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <Badge :value="result.passed ? 'passed' : 'failed'" :severity="result.passed ? 'success' : 'danger'" class="text-badge" />
                    <span class="font-semibold text-surface-700 dark:text-surface-200">{{ result.typeLabel }}</span>
                    <span class="font-mono text-surface-500 break-all">{{ result.subject }}</span>
                  </div>
                  <div class="text-surface-700 dark:text-surface-300 break-all">{{ result.message }}</div>
                  <div v-if="result.description" class="mt-1 text-surface-500 break-all">{{ result.description }}</div>
                </div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                <div class="p-2 rounded bg-surface-0/70 dark:bg-surface-900/70 min-w-0">
                  <div class="font-semibold text-surface-500 mb-1">Actual</div>
                  <div class="font-mono break-all">{{ formatWorkflowLogValue(result.actualValue) }}</div>
                </div>
                <div class="p-2 rounded bg-surface-0/70 dark:bg-surface-900/70 min-w-0">
                  <div class="font-semibold text-surface-500 mb-1">Operator</div>
                  <div class="font-mono break-all">{{ getOperatorLabel(result.operator) }}</div>
                </div>
                <div class="p-2 rounded bg-surface-0/70 dark:bg-surface-900/70 min-w-0">
                  <div class="font-semibold text-surface-500 mb-1">Expected</div>
                  <div class="font-mono break-all">{{ formatWorkflowLogValue(result.expectedValue) }}</div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="selectedGlobalVariables.length > 0" class="mt-4 pt-4 border-t border-surface-200 dark:border-surface-700">
            <div class="flex items-center justify-between gap-3 mb-3">
              <h5 class="font-semibold text-surface-700 dark:text-surface-300 flex items-center gap-2">
                <i class="pi pi-globe"></i>
                Global Variables
              </h5>
              <span class="text-surface-500">{{ selectedGlobalVariableStats.set }}/{{ selectedGlobalVariableStats.total }} set</span>
            </div>
            <div class="space-y-2">
              <div
                v-for="result in selectedGlobalVariables"
                :key="`global-variable-${result.index}`"
                class="p-3 rounded border"
                :class="getGlobalVariableStatus(result) === 'set'
                  ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800'
                  : getGlobalVariableStatus(result) === 'skipped'
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800'
                    : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800'"
              >
                <div class="flex items-center gap-2 mb-1">
                  <Badge
                    :value="getGlobalVariableStatus(result)"
                    :severity="getGlobalVariableSeverity(result)"
                    class="text-badge"
                  />
                  <span class="font-semibold text-surface-700 dark:text-surface-200">Global variable</span>
                  <span class="font-mono text-surface-500 break-all">{{ getGlobalVariableName(result) }}</span>
                </div>
                <div class="text-surface-700 dark:text-surface-300 break-all">{{ result.message }}</div>
                <div v-if="result.description" class="mt-1 text-surface-500 break-all">{{ result.description }}</div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                  <div class="p-2 rounded bg-surface-0/70 dark:bg-surface-900/70 min-w-0">
                    <div class="font-semibold text-surface-500 mb-1">Variable</div>
                    <div class="font-mono break-all">{{ getGlobalVariableName(result) }}</div>
                  </div>
                  <div class="p-2 rounded bg-surface-0/70 dark:bg-surface-900/70 min-w-0">
                    <div class="font-semibold text-surface-500 mb-1">Source</div>
                    <div class="font-mono break-all">{{ result.source || (result.valueType === 'customValue' ? 'Custom value' : '-') }}</div>
                  </div>
                  <div class="p-2 rounded bg-surface-0/70 dark:bg-surface-900/70 min-w-0">
                    <div class="font-semibold text-surface-500 mb-1">Value</div>
                    <div class="font-mono break-all">{{ getGlobalVariableValue(result) }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
</style>
