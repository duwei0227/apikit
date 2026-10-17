<script setup lang="ts">
import { ref, computed, defineAsyncComponent } from 'vue';
import { useCollectionsStore } from '@/stores/collections';
import { useAppStateStore } from '@/stores/appState';
import { useMocksStore } from '@/stores/mocks';
import { useMcpStore } from '@/stores/mcp';
import { useConsoleLogsStore } from '@/stores/consoleLogs';
import type { Collection, ConsoleLogBody, ConsoleLogSummary, Folder, RequestReference } from '@/types/models';

const CodeEditor = defineAsyncComponent(() => import('./CodeEditor.vue'));

withDefaults(defineProps<{ consoleLogs?: ConsoleLogSummary[] }>(), { consoleLogs: () => [] });

const emit = defineEmits<{ 'clear-console': []; 'open-mocks': [] }>();

type BodySide = 'request' | 'response';
const BODY_SIDES: BodySide[] = ['request', 'response'];
const BODY_LABELS: Record<BodySide, string> = { request: 'Request body', response: 'Response body' };

const collectionsStore = useCollectionsStore();
const appStateStore = useAppStateStore();
const mocksStore = useMocksStore();
const mcpStore = useMcpStore();
const consoleLogsStore = useConsoleLogsStore();

const activeTab = ref(0); // 0: Find, 1: Console
const searchQuery = ref('');
const selectedLog = ref<ConsoleLogSummary | null>(null);
// 只读取并保留当前展开的那条日志的 body
const selectedBody = ref<ConsoleLogBody | null>(null);
// 当前展开的日志中已格式化显示的 body；只改变显示，不改保存的日志
const formattedBodies = ref<Partial<Record<BodySide, string>>>({});
const expandedBody = ref<{ logId: ConsoleLogSummary['id']; side: BodySide } | null>(null);
const isCollapsed = ref(true); // 默认隐藏
const footerHeight = ref(200);
const isResizing = ref(false);

// Flatten all requests from all collections and folders
const allRequests = computed(() => {
  const result: Array<RequestReference & { collectionPath: string }> = [];
  const collect = (items: Collection | Folder, path: string) => {
    for (const req of (items.requests || [])) {
      result.push({ ...req, collectionPath: path });
    }
    for (const folder of (items.folders || [])) {
      collect(folder, `${path} / ${folder.name}`);
    }
  };
  for (const col of collectionsStore.collections) {
    collect(col, col.name);
  }
  return result;
});

const filteredRequests = computed(() => {
  if (!searchQuery.value) return [];
  const query = searchQuery.value.toLowerCase();
  return allRequests.value.filter(req =>
    (req.name || '').toLowerCase().includes(query) ||
    (req.url || '').toLowerCase().includes(query)
  );
});

const openRequest = (request: RequestReference) => {
  appStateStore.addOpenRequest(request.id);
};

const clearConsole = () => {
  emit('clear-console');
};

// 复制 Console 中的 body 文本到剪贴板，复用全局 toast 做反馈。
// @param text 待复制内容  @param label toast 中展示的来源名称（如 'Request body'）
const copyConsoleBody = async (text: string | null | undefined, label: string) => {
  try {
    await navigator.clipboard.writeText(text ?? '');
    window.$toast?.add({ severity: 'success', summary: 'Copied', detail: `${label} copied to clipboard`, life: 2000 });
  } catch (error) {
    console.error('Failed to copy:', error);
    window.$toast?.add({ severity: 'error', summary: 'Error', detail: 'Failed to copy to clipboard', life: 3000 });
  }
};

const selectLog = async (log: ConsoleLogSummary) => {
  selectedLog.value = selectedLog.value?.id === log.id ? null : log;
  selectedBody.value = null;
  formattedBodies.value = {};
  expandedBody.value = null;
  if (!selectedLog.value) return;
  const body = await consoleLogsStore.loadLogBody(log.id);
  if (selectedLog.value?.id === log.id) selectedBody.value = body;
};

const isBodyExpanded = (logId: ConsoleLogSummary['id'], side: BodySide) => (
  expandedBody.value?.logId === logId && expandedBody.value?.side === side
);

const getBodyPanelClass = (logId: ConsoleLogSummary['id'], side: BodySide) => {
  if (!expandedBody.value || expandedBody.value.logId !== logId) return '';
  return expandedBody.value.side === side ? 'col-span-2' : 'hidden';
};

const toggleBodyExpansion = (logId: ConsoleLogSummary['id'], side: BodySide) => {
  expandedBody.value = isBodyExpanded(logId, side) ? null : { logId, side };
};

const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value;
};

const switchTab = (tabIndex: number) => {
  // 如果点击的是当前已激活的标签
  if (activeTab.value === tabIndex && !isCollapsed.value) {
    // 收起面板
    isCollapsed.value = true;
  } else {
    // 切换到新标签或展开面板
    activeTab.value = tabIndex;
    
    // 如果当前是收起状态，自动展开到窗口 50% 高度
    if (isCollapsed.value) {
      isCollapsed.value = false;
      const windowHeight = window.innerHeight;
      footerHeight.value = Math.floor(windowHeight * 0.5);
    }
  }
};

const startResize = (event: MouseEvent) => {
  event.preventDefault();
  
  isResizing.value = true;
  const windowHeight = window.innerHeight;
  const wasCollapsed = isCollapsed.value;
  
  // 如果是收起状态，先展开到鼠标位置
  if (wasCollapsed) {
    isCollapsed.value = false;
    const initialHeight = windowHeight - event.clientY;
    footerHeight.value = Math.max(50, Math.min(Math.floor(windowHeight * 0.8), initialHeight));
  }
  
  const startY = event.clientY;
  const startHeight = footerHeight.value;
  let hasMoved = false;

  const onMouseMove = (e: MouseEvent) => {
    // 检测是否真正移动了（超过3px才算移动）
    const moveDistance = Math.abs(e.clientY - startY);
    if (!hasMoved && moveDistance <= 3) {
      return;
    }
    
    hasMoved = true;
    
    // 计算高度变化
    const deltaY = startY - e.clientY;
    let newHeight = startHeight + deltaY;
    
    // 限制高度范围
    const maxHeight = Math.floor(windowHeight * 0.8);
    newHeight = Math.max(50, Math.min(maxHeight, newHeight));
    
    footerHeight.value = newHeight;
    
    // 检查自动收起条件：
    // 1. 当前是展开状态（!isCollapsed.value）
    // 2. 高度低于窗口高度的15%
    const collapseThreshold = windowHeight * 0.15;
    if (!isCollapsed.value && newHeight < collapseThreshold) {
      isCollapsed.value = true;
      isResizing.value = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
  };

  const onMouseUp = () => {
    isResizing.value = false;
    
    // 如果从收起状态点击但没有移动，则展开到窗口 50% 高度
    if (wasCollapsed && !hasMoved) {
      footerHeight.value = Math.floor(windowHeight * 0.5);
    }
    
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
};

const getMethodColor = (method: string) => {
  const colors: Record<string, string> = {
    'GET': 'text-green-600 dark:text-green-400',
    'POST': 'text-blue-600 dark:text-blue-400',
    'PUT': 'text-yellow-600 dark:text-yellow-400',
    'DELETE': 'text-red-600 dark:text-red-400',
    'PATCH': 'text-purple-600 dark:text-purple-400',
  };
  return colors[method] || 'text-surface-600';
};

const getStatusColor = (status: number) => {
  if (status >= 200 && status < 300) return 'text-green-600 dark:text-green-400';
  if (status >= 400) return 'text-red-600 dark:text-red-400';
  return 'text-yellow-600 dark:text-yellow-400';
};

const getHeaderValue = (headers: Record<string, string> | undefined, headerName: string): string => {
  const normalizedName = headerName.toLowerCase();
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === normalizedName);
  return entry?.[1] || '';
};

const getBodyLanguage = (headers: Record<string, string> | undefined, body: string | null | undefined) => {
  const contentType = getHeaderValue(headers, 'content-type').toLowerCase();

  if (contentType.includes('json')) return 'json';
  if (contentType.includes('html')) return 'html';
  if (contentType.includes('xml')) return 'xml';
  if (contentType.includes('x-www-form-urlencoded')) return 'urlencoded';

  const content = (body || '').trim();
  if (!content) return 'text';

  if (content.startsWith('{') || content.startsWith('[')) {
    try {
      JSON.parse(content);
      return 'json';
    } catch {
      // JSON-like request bodies still benefit from structural highlighting.
      return 'json';
    }
  }

  const lowerContent = content.toLowerCase();
  if (lowerContent.startsWith('<!doctype html') || lowerContent.startsWith('<html')) return 'html';
  if (content.startsWith('<?xml') || (content.startsWith('<') && content.includes('</'))) return 'xml';
  if (/^[^=&\s]+=[^&]*(?:&[^=&\s]+=[^&]*)*$/.test(content)) return 'urlencoded';

  return 'text';
};

const getRawBody = (side: BodySide) => (
  (side === 'request' ? selectedBody.value?.requestBody : selectedBody.value?.responseBody) || ''
);

const getShownBody = (side: BodySide) => formattedBodies.value[side] ?? getRawBody(side);

const getLogBodyLanguage = (log: ConsoleLogSummary, side: BodySide) => (
  getBodyLanguage(side === 'request' ? log.requestHeaders : log.responseHeaders, getRawBody(side))
);

const canFormatBody = (log: ConsoleLogSummary, side: BodySide) => ['json', 'xml'].includes(getLogBodyLanguage(log, side));

// 在格式化和原文之间切换，与请求编辑器的 Beautify 使用同一套格式化方法（首次使用时再加载）
const toggleBodyFormat = async (log: ConsoleLogSummary, side: BodySide) => {
  if (formattedBodies.value[side] !== undefined) {
    const { [side]: _removed, ...rest } = formattedBodies.value;
    formattedBodies.value = rest;
    return;
  }
  const language = getLogBodyLanguage(log, side);
  const logId = selectedLog.value?.id;
  try {
    const formatted = language === 'xml'
      ? (await import('@/utils/beautifyXml')).beautifyXmlText(getRawBody(side))
      : (await import('@/utils/beautifyJson')).beautifyJsonText(getRawBody(side));
    // 加载期间切换到了另一条日志
    if (selectedLog.value?.id !== logId) return;
    formattedBodies.value = { ...formattedBodies.value, [side]: formatted };
  } catch (error) {
    console.error(`Failed to format ${side} body:`, error);
    window.$toast?.add({ severity: 'warn', summary: 'Cannot format', detail: `Not valid ${language.toUpperCase()}`, life: 3000 });
  }
};

const formatTime = (timestamp: number | string) => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};
</script>

<template>
  <footer 
    class="footer bg-surface-0 dark:bg-surface-900 border-t border-surface-200 dark:border-surface-700 flex flex-col absolute bottom-0 left-0 right-0 z-30"
    :style="{ height: isCollapsed ? 'auto' : `${footerHeight}px` }"
  >
    <!-- Resize Handle (always visible) -->
    <div 
      @mousedown="startResize"
      class="h-1 bg-surface-200 dark:bg-surface-700 hover:bg-primary cursor-ns-resize transition"
      :class="{ 'bg-primary': isResizing }"
    ></div>

    <!-- Tab Headers -->
    <div class="flex border-b border-surface-200 dark:border-surface-700">
      <button 
        @click="switchTab(0)"
        :class="[
          'px-4 py-2 text-xs font-medium transition',
          activeTab === 0 
            ? 'text-primary border-b-2 border-primary bg-surface-0 dark:bg-surface-950' 
            : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-50'
        ]"
      >
        Find
      </button>
      <button 
        @click="switchTab(1)"
        :class="[
          'px-4 py-2 text-xs font-medium transition',
          activeTab === 1 
            ? 'text-primary border-b-2 border-primary bg-surface-0 dark:bg-surface-950' 
            : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-50'
        ]"
      >
        Console
      </button>
      <div class="flex-1"></div>
      <button
        class="mock-status-button px-3 text-xs text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-50 transition"
        :title="mocksStore.runningCount > 0 ? `${mocksStore.runningCount} mock service(s) running` : 'No mock services running'"
        @click="emit('open-mocks')"
      >
        <i class="pi pi-server text-[11px]"></i>
        <span>Mocks</span>
        <span class="mcp-status-dot" :class="mocksStore.runningCount > 0 ? 'running' : 'stopped'"></span>
        <span>{{ mocksStore.runningCount > 0 ? `${mocksStore.runningCount} running` : 'Off' }}</span>
      </button>
      <button
        @click="mcpStore.openDialog()"
        class="mcp-status-button px-3 text-xs text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-50 transition"
        :title="mcpStore.statusText"
      >
        <i class="pi pi-sparkles text-[11px]"></i>
        <span>MCP</span>
        <span class="mcp-status-dot" :class="mcpStore.status"></span>
        <span>{{ mcpStore.status === 'running' ? 'Running' : mcpStore.status === 'error' ? 'Error' : 'Off' }}</span>
      </button>
      <button 
        v-if="!isCollapsed"
        @click="toggleCollapse"
        class="px-4 py-2 text-xs text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-50 transition"
      >
        <i class="pi pi-times"></i>
      </button>
    </div>

    <!-- Tab Content (only when expanded) -->
    <div v-if="!isCollapsed" class="flex-1 overflow-hidden">
      <!-- Find Tab -->
      <div v-if="activeTab === 0" class="h-full flex">
        <!-- Search Box (30%) -->
        <div class="w-[30%] border-r border-surface-200 dark:border-surface-700 p-2">
          <IconField iconPosition="left">
            <InputIcon class="pi pi-search" />
            <InputText 
              v-model="searchQuery"
              placeholder="Search by name or URL..." 
              class="w-full text-xs"
              size="small"
            />
          </IconField>
        </div>
        
        <!-- Results (70%) -->
        <div class="flex-1 overflow-y-auto p-2">
          <div v-if="!searchQuery" class="text-center text-surface-400 dark:text-surface-500 text-xs py-4">
            Type to search all requests
          </div>
          <div v-else-if="filteredRequests.length === 0" class="text-center text-surface-400 dark:text-surface-500 text-xs py-4">
            No matching requests found
          </div>
          <div
            v-for="request in filteredRequests"
            :key="request.id"
            @click="openRequest(request)"
            class="p-2 mb-1 rounded hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer transition"
          >
            <div class="flex items-center gap-2 mb-1">
              <span :class="['text-badge font-semibold', getMethodColor(request.method)]">
                {{ request.method }}
              </span>
              <span class="text-xs text-surface-700 dark:text-surface-300 font-medium">
                {{ request.name }}
              </span>
              <span class="text-meta text-surface-400 ml-auto">{{ request.collectionPath }}</span>
            </div>
            <div class="text-xs text-surface-500 dark:text-surface-400 truncate">
              {{ request.url || 'No URL specified' }}
            </div>
          </div>
        </div>
      </div>

      <!-- Console Tab -->
      <div v-else class="h-full flex flex-col">
        <div class="p-2 border-b border-surface-200 dark:border-surface-700 flex justify-between items-center">
          <span class="text-meta text-surface-600 dark:text-surface-400">
            {{ consoleLogs.length }} request(s)
          </span>
          <Button 
            label="Clear"
            icon="pi pi-trash"
            size="small"
            text
            @click="clearConsole"
          />
        </div>
        <div class="flex-1 overflow-y-auto">
          <div v-if="consoleLogs.length === 0" class="text-center text-surface-400 dark:text-surface-500 text-xs py-4">
            No console logs yet
          </div>
          <div v-for="log in consoleLogs" :key="log.id" class="border-b border-surface-100 dark:border-surface-800">
            <!-- Log Summary -->
            <div 
              @click="selectLog(log)"
              class="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer transition"
            >
              <div class="flex items-center gap-2 text-xs">
                <span class="text-meta text-surface-400">{{ formatTime(log.startTime) }}</span>
                <span :class="['font-semibold', getMethodColor(log.method)]">
                  {{ log.method }}
                </span>
                <span class="flex-1 truncate text-surface-700 dark:text-surface-300">
                  {{ log.url }}
                </span>
                <span :class="['font-semibold', getStatusColor(log.status)]">
                  {{ log.status }}
                </span>
                <span class="text-meta text-surface-500">{{ log.duration }}</span>
                <i :class="['pi text-xs', selectedLog?.id === log.id ? 'pi-chevron-down' : 'pi-chevron-right']"></i>
              </div>
            </div>

            <!-- Log Details (Expanded) -->
            <div v-if="selectedLog?.id === log.id" class="bg-surface-0 dark:bg-surface-950 p-3 text-sm">
              <div class="grid grid-cols-2 gap-x-4 gap-y-3">
                <h4 class="font-semibold text-surface-700 dark:text-surface-300">Request</h4>
                <h4 class="font-semibold text-surface-700 dark:text-surface-300">Response</h4>

                <!-- Basic information shares one grid row so subsequent sections stay aligned. -->
                <div class="space-y-2.5">
                  <div>
                    <span class="text-surface-500">Start Time:</span>
                    <span class="ml-2 text-surface-700 dark:text-surface-300">{{ new Date(log.startTime).toLocaleString('zh-CN') }}</span>
                  </div>
                  <div>
                    <span class="text-surface-500">Method:</span>
                    <span :class="['ml-2 font-semibold', getMethodColor(log.method)]">{{ log.method }}</span>
                  </div>
                  <div>
                    <span class="text-surface-500">URL:</span>
                    <span class="ml-2 text-surface-700 dark:text-surface-300 break-all">{{ log.url }}</span>
                  </div>
                </div>
                <div class="space-y-2.5">
                  <div>
                    <span class="text-surface-500">End Time:</span>
                    <span class="ml-2 text-surface-700 dark:text-surface-300">{{ new Date(log.endTime).toLocaleString('zh-CN') }}</span>
                  </div>
                  <div>
                    <span class="text-surface-500">Status:</span>
                    <span :class="['ml-2 font-semibold', getStatusColor(log.status)]">{{ log.status }} {{ log.statusText }}</span>
                  </div>
                  <div>
                    <span class="text-surface-500">Duration:</span>
                    <span class="ml-2 text-surface-700 dark:text-surface-300">{{ log.duration }}</span>
                  </div>
                </div>

                <!-- Header blocks share the next grid row. -->
                <div>
                  <template v-if="log.requestHeaders && Object.keys(log.requestHeaders).length > 0">
                    <span class="text-surface-500 font-bold">Headers:</span>
                    <pre class="mt-2 p-2 text-sm leading-6 overflow-x-auto"><span
                      v-for="(value, key) in log.requestHeaders"
                      :key="key"
                      class="block"
                    ><span class="text-blue-600 dark:text-blue-400">{{ key }}</span><span class="text-surface-500">: </span><span class="text-green-700 dark:text-green-400">{{ value }}</span></span></pre>
                  </template>
                </div>
                <div>
                  <template v-if="log.responseHeaders && Object.keys(log.responseHeaders).length > 0">
                    <span class="text-surface-500 font-bold">Headers:</span>
                    <pre class="mt-2 p-2 text-sm leading-6 overflow-x-auto"><span
                      v-for="(value, key) in log.responseHeaders"
                      :key="key"
                      class="block"
                    ><span class="text-blue-600 dark:text-blue-400">{{ key }}</span><span class="text-surface-500">: </span><span class="text-green-700 dark:text-green-400">{{ value }}</span></span></pre>
                  </template>
                </div>

                <!-- Body blocks share the final grid row. -->
                <div v-for="side in BODY_SIDES" :key="side" :class="getBodyPanelClass(log.id, side)">
                  <template v-if="getRawBody(side)">
                    <div class="flex items-center gap-1.5">
                      <span class="text-surface-500 font-bold">Body:</span>
                      <i
                        class="pi pi-copy text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 cursor-pointer"
                        title="Copy"
                        @click="copyConsoleBody(getShownBody(side), BODY_LABELS[side])"
                      ></i>
                      <button
                        type="button"
                        class="inline-flex text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 cursor-pointer transition"
                        :title="isBodyExpanded(log.id, side) ? 'Restore width' : 'Expand horizontally'"
                        :aria-label="isBodyExpanded(log.id, side) ? `Restore ${side} body width` : `Expand ${side} body horizontally`"
                        @click="toggleBodyExpansion(log.id, side)"
                      >
                        <i :class="['pi', isBodyExpanded(log.id, side) ? 'pi-window-minimize' : 'pi-window-maximize']"></i>
                      </button>
                      <button
                        v-if="canFormatBody(log, side)"
                        type="button"
                        :class="[
                          'inline-flex cursor-pointer transition',
                          formattedBodies[side] !== undefined
                            ? 'text-primary'
                            : 'text-surface-400 hover:text-surface-700 dark:hover:text-surface-200',
                        ]"
                        :title="formattedBodies[side] !== undefined ? 'Show original' : 'Format'"
                        :aria-label="formattedBodies[side] !== undefined ? `Show original ${side} body` : `Format ${side} body`"
                        :aria-pressed="formattedBodies[side] !== undefined"
                        @click="toggleBodyFormat(log, side)"
                      >
                        <i class="pi pi-align-left"></i>
                      </button>
                    </div>
                    <CodeEditor
                      class="mt-2"
                      :modelValue="getShownBody(side)"
                      :language="getLogBodyLanguage(log, side)"
                      :readOnly="true"
                      autoHeight
                    />
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </footer>
</template>

<style scoped>
.mcp-status-button,
.mock-status-button {
  align-items: center;
  display: inline-flex;
  gap: 0.375rem;
}

.mcp-status-dot {
  background: var(--p-surface-400);
  border-radius: 999px;
  height: 0.4375rem;
  width: 0.4375rem;
}

.mcp-status-dot.running {
  background: #16a34a;
}

.mcp-status-dot.error {
  background: #dc2626;
}

</style>
