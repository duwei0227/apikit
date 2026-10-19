<script setup lang="ts">
import { cloneJson } from '@/utils/clone';
import { ref, watch, computed, onUnmounted } from 'vue';
import VariableInput from './VariableInput.vue';
import SaveRequestDialog from './SaveRequestDialog.vue';
import ResponseViewer from './ResponseViewer.vue';
import RequestTestsEditor from './RequestTestsEditor.vue';
import RequestBodyEditor from './RequestBodyEditor.vue';
import RequestAuthEditor from './RequestAuthEditor.vue';
import RequestHeadersEditor from './RequestHeadersEditor.vue';
import RequestCodePanel from './RequestCodePanel.vue';
import RequestSettingsPanel from './RequestSettingsPanel.vue';
import { apiService } from '@/services/api/apiService';
import { useKeyValueRows } from '@/composables/useKeyValueRows';
import { useRequestSave } from '@/composables/useRequestSave';
import { useUrlParamsSync } from '@/composables/useUrlParamsSync';
import { debounce } from '@/utils/debounce';
import { useVisitedTabs } from '@/composables/useVisitedTabs';
import { getRowKey, reconcileRows } from '@/utils/stableRows';
import { parseKeyValueBulkEdit, serializeKeyValueBulkEdit } from '@/utils/keyValueBulkEdit';
import { canSendRequestBody } from '@/utils/httpMethods';
import { parseRequestUrl } from '@/utils/urlQuery';
import { useRequestsStore } from '@/stores/requests';
import { normalizeTestConfig } from '@/utils/requestTests';
import { getAvailableVariables, replaceVariables, variableContext } from '@/services/variables/resolver';
import { downloadHttpResponse, executeHttpRequest } from '@/services/http/HttpExecutionService';
import { suggestDownloadFileName } from '@/utils/download';
import { createEmptyRequest } from '@/utils/requestFactory';
import type { RequestSaveData } from '@/composables/useRequestSave';
import type { ParsedCurl } from '@/utils/curl-parser';
import type {
  Collection, ConsoleLog, GlobalVariableConfig, HttpMethod, HttpResponseView, JsonFieldTest, Request,
  RequestTestResults, StatusCodeTest,
} from '@/types/models';

const props = withDefaults(defineProps<{
  request?: Request;
  isActive?: boolean;
  collections?: Collection[];
  embedded?: boolean;
  editableName?: boolean;
}>(), {
  request: () => createEmptyRequest({ name: 'Untitled Request' }),
  isActive: false,
  collections: () => [],
  embedded: false,
  editableName: true
});

const emit = defineEmits<{
  'update:request': [request: Request];
  close: [];
  'add-console-log': [log: ConsoleLog];
  'save-request': [saveData: RequestSaveData];
}>();

const requestsStore = useRequestsStore();

// 从 store 的 responseCache 恢复状态
const cachedState = requestsStore.getResponseCache(props.request.id);

// Tests 相关数据（编辑 UI 在 RequestTestsEditor 子组件；这里持有数据供执行/保存/恢复）
const statusCodeTests = ref<StatusCodeTest[]>([
  { enabled: true, operator: 'equals', expectedValue: '200', description: '' }
]);
const jsonFieldTests = ref<JsonFieldTest[]>([
  { enabled: false, jsonPath: '', operator: 'equals', expectedValue: '', description: '' }
]);
const globalVariables = ref<GlobalVariableConfig[]>([
  { enabled: false, variableName: '', valueType: 'jsonPath', jsonPath: '', customValue: '', description: '' }
]);

// 测试操作符选项已移至 @/constants/testOperators
// 测试行的增删与折叠面板 UI 已移入 RequestTestsEditor 子组件

// 深拷贝创建完全独立的本地请求实例
const localRequest = ref<Request>(cloneJson(props.request));
const REQUEST_TAB_INDEX = {
  params: 0,
  body: 3,
};

const getInitialRequestTab = (request: Request, state: { activeParamTab?: number } | null) => {
  if (state?.activeParamTab !== undefined) {
    return state.activeParamTab;
  }

  if (!canSendRequestBody(request?.method)) {
    return REQUEST_TAB_INDEX.params;
  }

  return request?.body?.type && request.body.type !== 'none'
    ? REQUEST_TAB_INDEX.body
    : REQUEST_TAB_INDEX.params;
};

const activeParamTab = ref(getInitialRequestTab(localRequest.value, cachedState));
// 子页签首次打开时才渲染，之后切换只隐藏不销毁，保留各编辑器的撤销/重做历史
const { isVisited: isParamTabVisited } = useVisitedTabs(activeParamTab);
const activeResponseTab = ref(cachedState?.activeResponseTab || 0);
const activeBodyViewTab = ref(cachedState?.activeBodyViewTab || 0);
const response = ref<HttpResponseView | null>(cachedState?.response || null);
const isLoading = ref(false);
const isEditingName = ref(false);
const elapsedSeconds = ref(0);
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

watch(isLoading, (loading) => {
  if (loading) {
    elapsedSeconds.value = 0;
    elapsedTimer = setInterval(() => { elapsedSeconds.value++; }, 1000);
  } else {
    clearInterval(elapsedTimer);
    elapsedTimer = undefined;
  }
});
// 根据窗口高度计算默认响应区域高度
const calculateDefaultResponseHeight = () => {
  const windowHeight = window.innerHeight;
  return windowHeight < 900 ? 350 : 500;
};
const responseHeight = ref(cachedState?.responseHeight || calculateDefaultResponseHeight());
const isResponseCollapsed = ref(cachedState?.response ? (cachedState.isResponseCollapsed ?? false) : true);
const isUrlInputFocused = ref(false); // URL 输入框是否获得焦点
const isParamsBulkEdit = ref(false);
const paramsBulkText = ref('');
const testResults = ref<RequestTestResults | null>(cachedState?.testResults || null);
let currentRequestId: string | null = null; // 当前请求 ID，用于取消

// Settings - 从请求中加载或使用默认值
const requestSettings = props.request.settings || {};
const followRedirects = ref(requestSettings.followRedirects !== undefined ? requestSettings.followRedirects : true);
const maxRedirectCount = ref(requestSettings.maxRedirectCount !== undefined ? requestSettings.maxRedirectCount : 10);
const verifySsl = ref(requestSettings.verifySsl !== undefined ? requestSettings.verifySsl : true);
const autoEncodeUrl = ref(requestSettings.autoEncodeUrl !== undefined ? requestSettings.autoEncodeUrl : true);
const acceptEncoding = ref(requestSettings.acceptEncoding !== undefined ? requestSettings.acceptEncoding : true);

// 监听 settings 变化，同步到 localRequest
watch([followRedirects, maxRedirectCount, verifySsl, autoEncodeUrl, acceptEncoding], () => {
  localRequest.value.settings = {
    followRedirects: followRedirects.value,
    maxRedirectCount: maxRedirectCount.value,
    verifySsl: verifySsl.value,
    autoEncodeUrl: autoEncodeUrl.value,
    acceptEncoding: acceptEncoding.value,
  };
}, { immediate: true });

// 当前设置（Code 页签生成 cURL 时使用）
const currentSettings = computed(() => ({
  followRedirects: followRedirects.value,
  maxRedirectCount: maxRedirectCount.value,
  verifySsl: verifySsl.value,
  autoEncodeUrl: autoEncodeUrl.value,
  acceptEncoding: acceptEncoding.value,
}));

// 监听 response 变化，保存到 store 的 responseCache（用于 tab 切换时恢复）
watch([response, isResponseCollapsed, responseHeight, testResults, activeParamTab, activeResponseTab, activeBodyViewTab], () => {
  if (props.request.id) {
    requestsStore.setResponseCache(props.request.id, {
      response: response.value,
      responseHeight: responseHeight.value,
      isResponseCollapsed: isResponseCollapsed.value,
      testResults: testResults.value,
      activeParamTab: activeParamTab.value,
      activeResponseTab: activeResponseTab.value,
      activeBodyViewTab: activeBodyViewTab.value,
    });
  }
});

// 从请求中加载 Tests 数据，同时在工作副本中兼容旧版 value 字段。
const normalizedInitialTests = normalizeTestConfig(props.request.testsConfig ?? props.request.tests);
statusCodeTests.value = cloneJson(normalizedInitialTests.statusCodeTests);
jsonFieldTests.value = cloneJson(normalizedInitialTests.jsonFieldTests);
globalVariables.value = cloneJson(normalizedInitialTests.globalVariables);
localRequest.value.testsConfig = cloneJson(normalizedInitialTests);

// 监听 props.request.name 的变化，同步更新 localRequest.name
watch(
  () => props.request.name,
  (newName) => {
    if (newName && newName !== localRequest.value.name) {
      localRequest.value.name = newName;
    }
  }
);

// 保存：Save 按钮、Ctrl+S 和保存对话框
const {
  showSaveDialog,
  saveDialogName,
  saveDialogCollection,
  saveDialogFolder,
  handleSaveClick,
  openSaveDialog,
  onDialogSave,
} = useRequestSave({
  props,
  localRequest,
  buildTestsConfig: () => ({
    statusCodeTests: cloneJson(statusCodeTests.value),
    jsonFieldTests: cloneJson(jsonFieldTests.value),
    globalVariables: cloneJson(globalVariables.value)
  }),
  emitSave: (saveData) => emit('save-request', saveData),
});

// 可用变量（环境变量、全局变量和内置变量），用于输入框的补全和未定义变量提示
const availableVariables = computed(() => getAvailableVariables());

const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

// 请求体编辑 UI（含 body 类型/JSON/form-data/urlencoded/搜索/美化）已移入 RequestBodyEditor 子组件
// Headers 表格及常用 Header 补全已移入 RequestHeadersEditor 子组件

// Debounce the upward emit: it drives the parent's per-keystroke cascade
// (request.value reassignment + full re-render + hasChanges() running ~7
// JSON.stringify on the whole request). Running that synchronously on every
// keystroke overloads the input tick and races with WebView2's IME finalize,
// dropping every other committed Chinese character (the bug disappears when
// DevTools is open because it changes the timing). Sending uses localRequest
// directly, and draft saving is already debounced downstream, so deferring this
// emit is safe.
const emitRequestUpdate = debounce((val: Request) => emit('update:request', val), 250);
watch(localRequest, (newVal) => {
  emitRequestUpdate(newVal);
}, { deep: true });

// 同步 Tests 数据到 localRequest，使其随 localRequest 一起持久化
watch([statusCodeTests, jsonFieldTests, globalVariables], () => {
  localRequest.value.testsConfig = {
    statusCodeTests: cloneJson(statusCodeTests.value),
    jsonFieldTests: cloneJson(jsonFieldTests.value),
    globalVariables: cloneJson(globalVariables.value)
  };
}, { deep: true });

// URL 与 Params 双向同步
const { syncUrlFromParams, syncParamsFromUrl } = useUrlParamsSync(localRequest, isUrlInputFocused);

// SplitButton menu items
const sendMenuItems = ref([
  {
    label: 'Send And Download',
    icon: 'pi pi-download',
    command: () => sendAndDownload()
  }
]);

// 极快响应（< MIN_LOADING_MS）时保证加载遮罩至少显示一段时间，
// 避免用户感觉"无变化"。值可按手感调整。
const MIN_LOADING_MS = 300;
const ensureMinLoadingDuration = async (startTime: number) => {
  const elapsed = Date.now() - startTime;
  if (elapsed < MIN_LOADING_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_LOADING_MS - elapsed));
  }
};

const cancelRequest = async () => {
  // 流式响应点 Stop：只停止接收，已收到的内容由 sendRequest 照常展示并执行断言
  if (currentRequestId && response.value?.stream?.active) {
    await apiService.cancelHttpRequest(currentRequestId);
    return;
  }
  if (currentRequestId) {
    await apiService.cancelHttpRequest(currentRequestId);
    currentRequestId = null;
    isLoading.value = false;

    // 生成取消请求的测试结果 - 所有断言失败
    testResults.value = {
      statusCode: statusCodeTests.value
        .filter(test => test.enabled)
        .map((test, index) => ({
          index,
          passed: false,
          message: `Request cancelled - Status code test failed`,
          description: test.description,
          actualValue: 0,
          operator: test.operator,
          expectedValue: test.expectedValue
        })),
      jsonFields: jsonFieldTests.value
        .filter(test => test.enabled && test.jsonPath)
        .map((test, index) => ({
          index,
          passed: false,
          message: `Request cancelled - JSON field test failed`,
          description: test.description,
          actualValue: undefined,
          operator: test.operator,
          expectedValue: test.expectedValue,
          jsonPath: test.jsonPath
        })),
      globalVars: []
    };

    if (window.$toast) {
      window.$toast.add({
        severity: 'info',
        summary: 'Cancelled',
        detail: 'Request cancelled by user',
        life: 2000
      });
    }
  }
};

// 编辑器当前内容（含尚未同步到 localRequest 的设置和断言）
const buildExecutionRequest = () => ({
  ...localRequest.value,
  settings: {
    followRedirects: followRedirects.value,
    maxRedirectCount: maxRedirectCount.value,
    verifySsl: verifySsl.value,
    autoEncodeUrl: autoEncodeUrl.value,
    acceptEncoding: acceptEncoding.value,
  },
  testsConfig: {
    statusCodeTests: statusCodeTests.value,
    jsonFieldTests: jsonFieldTests.value,
    globalVariables: globalVariables.value,
  },
});

const isCancelledError = (error: unknown) => (
  error === 'Request cancelled' || (typeof error === 'string' && error.includes('cancelled'))
);

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const errorResponse = (error: unknown, startTime: number): HttpResponseView => {
  const message = `Error: ${errorMessage(error)}`;
  return {
    status: 0,
    statusText: 'Error',
    time: `${Date.now() - startTime}ms`,
    size: '0B',
    body: message,
    rawBody: message,
    headers: {},
    contentType: '',
    imageDataUrl: ''
  };
};

// 结束加载：保证遮罩至少显示 MIN_LOADING_MS；期间若已发起新请求（含已取消），不覆盖其状态
const finishLoading = async (requestId: string | null, startTime: number) => {
  await ensureMinLoadingDuration(startTime);
  if (requestId && currentRequestId === requestId) {
    isLoading.value = false;
    currentRequestId = null;
  }
};

// 发送请求：拼请求、发送、解析响应、执行断言都由 HttpExecutionService 完成，与 Workflow、MCP 一致
const sendRequest = async () => {
  let requestId: string | null = null;
  isLoading.value = true;
  isResponseCollapsed.value = false; // 发送请求时展开响应区域
  const startTime = Date.now();

  try {
    const result = await executeHttpRequest(buildExecutionRequest(), {
      ...variableContext(),
      onRequestStart: (id) => {
        requestId = id;
        currentRequestId = id;
      },
      onConsoleLog: (log) => emit('add-console-log', log),
      // 流式响应边接收边显示
      onStreamUpdate: (liveResponse) => {
        if (currentRequestId !== requestId) return;
        testResults.value = null;
        response.value = liveResponse;
      },
    });
    response.value = result.response;
    testResults.value = result.testResults;
  } catch (error) {
    if (isCancelledError(error)) return; // 用户取消，不显示错误
    response.value = errorResponse(error, startTime);
  } finally {
    await finishLoading(requestId, startTime);
  }
};

const sendAndDownload = async () => {
  let requestId: string | null = null;
  isLoading.value = true;
  isResponseCollapsed.value = false;
  const startTime = Date.now();

  try {
    const download = await downloadHttpResponse(buildExecutionRequest(), {
      replaceVariables,
      onRequestStart: (id) => {
        requestId = id;
        currentRequestId = id;
      },
    });

    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const filePath = await save({
      defaultPath: suggestDownloadFileName(download.headers, download.url, download.contentType),
      filters: []
    });

    if (!filePath) {
      window.$toast?.add({ severity: 'info', summary: 'Download Cancelled', detail: 'File download was cancelled', life: 2000 });
      return;
    }

    await writeFile(filePath, download.bytes);
    window.$toast?.add({ severity: 'success', summary: 'Download Complete', detail: `File saved to ${filePath}`, life: 3000 });

    const message = `File downloaded successfully to:\n${filePath}`;
    response.value = {
      status: download.status,
      statusText: download.statusText,
      time: `${download.durationMs}ms`,
      size: download.size,
      body: message,
      rawBody: message,
      headers: download.headers,
      contentType: download.contentType,
      imageDataUrl: ''
    };
  } catch (error) {
    if (isCancelledError(error)) return; // 用户取消，不显示错误
    response.value = errorResponse(error, startTime);
    window.$toast?.add({ severity: 'error', summary: 'Download Failed', detail: errorMessage(error) || 'Failed to download file', life: 3000 });
  } finally {
    await finishLoading(requestId, startTime);
  }
};

// Query params: empty-table removal resets the single row; onChange also re-syncs the URL.
const { add: addParam, remove: removeParam, onChange: onParamChange } = useKeyValueRows({
  getRows: () => localRequest.value.params,
  createRow: () => ({ key: '', value: '', enabled: true }),
  removeStrategy: 'replaceLast',
  onAfterChange: () => syncUrlFromParams(),
});

const enterParamsBulkEdit = () => {
  paramsBulkText.value = serializeKeyValueBulkEdit(localRequest.value.params);
  isParamsBulkEdit.value = true;
};

const updateParamsFromBulkEdit = () => {
  const parsed = parseKeyValueBulkEdit(paramsBulkText.value, localRequest.value.params);
  reconcileRows(localRequest.value.params, parsed);
  onParamChange();
};

const leaveParamsBulkEdit = () => {
  isParamsBulkEdit.value = false;
  onParamChange();
};

// 响应搜索/高亮/滚动、resize、折叠、响应相关 computed（isImageResponse/responseLanguage/
// shouldUseCodeEditor/testResultsSummary）、getOperatorLabel 等均已移入 ResponseViewer 子组件

// 从 Code 页签导入 cURL：回填解析结果到当前请求
const applyCurlImport = (parsed: ParsedCurl) => {
  localRequest.value.method = parsed.method as HttpMethod;
  localRequest.value.headers = parsed.headers;
  localRequest.value.auth = parsed.auth;
  localRequest.value.body = parsed.body;
  followRedirects.value = parsed.settings.followRedirects;
  maxRedirectCount.value = parsed.settings.maxRedirectCount;
  verifySsl.value = parsed.settings.verifySsl;
  autoEncodeUrl.value = parsed.settings.autoEncodeUrl;
  acceptEncoding.value = parsed.settings.acceptEncoding;

  // 解析 URL 中的 query 参数到 Params，URL 保留完整内容
  const parsedParams = parseRequestUrl(parsed.url).params;
  if (parsedParams.length > 0) {
    localRequest.value.params = [...parsedParams, { key: '', value: '', enabled: true }];
    localRequest.value.url = parsed.url;
  } else {
    localRequest.value.params = [{ key: '', value: '', enabled: true }];
    localRequest.value.url = parsed.url;
  }
};

// 保存位置选择（树构建、节点选择、路径显示）已移入 SaveRequestDialog 子组件

onUnmounted(() => {
  clearInterval(elapsedTimer);
});

// 暴露方法供父组件调用
defineExpose({
  openSaveDialog,
  getCurrentRequest: () => cloneJson(localRequest.value)
});
</script>

<template>
  <div class="http-request flex flex-col h-full">
    <!-- Title Bar -->
    <div
      v-if="!embedded"
      class="flex items-center px-4 py-3 border-b border-surface-200 dark:border-surface-700"
    >
      <div class="flex items-center gap-2 flex-1">
        <InputText
          v-if="editableName"
          v-model="localRequest.name"
          class="font-medium leading-[18px] flex-1"
          placeholder="Request Name"
        />
        <span v-else class="text-sm font-medium flex-1 truncate">{{ localRequest.name }}</span>
        <span v-if="editableName && !localRequest.collectionId" class="text-xs text-surface-400">(Unsaved)</span>
      </div>
    </div>

    <!-- Request Section -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Method + URL -->
      <div class="p-4 py-3 border-b border-surface-200 dark:border-surface-700">
            <div class="flex gap-2 top-url-row">
              <Dropdown
                v-model="localRequest.method"
                :options="methods"
                class="w-32"
              />
              <VariableInput
                v-model="localRequest.url"
                placeholder="Enter request URL"
                class="flex-1"
                :availableVariables="availableVariables"
                @focus="isUrlInputFocused = true"
                @blur="isUrlInputFocused = false; syncParamsFromUrl()"
              />
          <SplitButton
            v-if="!isLoading"
            label="Send"
            :model="sendMenuItems"
            @click="sendRequest"
          />
          <Button
            v-else
            label="Cancel"
            icon="pi pi-times"
            severity="danger"
            @click="cancelRequest"
          />
          <Button
            v-if="!embedded"
            label="Save"
            icon="pi pi-save"
            severity="secondary"
            @click="handleSaveClick"
          />
        </div>
      </div>

      <!-- Params Tabs -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <TabView v-model:activeIndex="activeParamTab" class="request-tabs">
          <template #end>
            <Button
              icon="pi pi-code"
              text
              rounded
              size="small"
              class="mr-1"
              @click="activeParamTab = 5"
              title="Code"
            />
            <Button
              icon="pi pi-cog"
              text
              rounded
              size="small"
              class="mr-2"
              @click="activeParamTab = 6"
              title="Settings"
            />
          </template>

          <TabPanel header="Params">
            <template v-if="isParamTabVisited(0)">
            <div class="p-4 overflow-y-auto">
              <div class="mb-3">
                <h4 class="text-sm font-medium text-surface-700 dark:text-surface-300">Query Params</h4>
              </div>

              <div v-show="isParamsBulkEdit" class="mb-2 flex justify-end">
                <Button
                  label="Key-Value Edit"
                  text
                  size="small"
                  class="ak-mode-toggle-button ak-mode-toggle-key-value"
                  @click="leaveParamsBulkEdit"
                />
              </div>

              <div v-show="isParamsBulkEdit">
                <textarea
                  v-model="paramsBulkText"
                  class="ak-bulk-edit-textarea w-full"
                  aria-label="Query Params bulk edit"
                  placeholder="key: value"
                  spellcheck="false"
                  @input="updateParamsFromBulkEdit"
                />
              </div>

              <div v-show="!isParamsBulkEdit">
                <div class="ak-key-value-table-header relative flex gap-2 mb-2 text-sm font-bold text-surface-700 dark:text-surface-300 px-2">
                  <div style="width: 40px;"></div>
                  <div class="flex-1">KEY</div>
                  <div class="flex-1">VALUE</div>
                  <Button
                    label="Bulk Edit"
                    text
                    size="small"
                    class="ak-key-value-bulk-edit-button ak-mode-toggle-button ak-mode-toggle-bulk"
                    @click="enterParamsBulkEdit"
                  />
                  <div style="width: 40px; flex: 0 0 40px;"></div>
                </div>

                <div class="space-y-1">
                  <div
                    v-for="(param, index) in localRequest.params"
                    :key="getRowKey(param)"
                    class="flex gap-2 items-center"
                  >
                    <div class="flex justify-center" style="width: 40px;">
                      <Checkbox v-model="param.enabled" :binary="true" />
                    </div>
                    <div class="flex-1">
                      <VariableInput
                        v-model="param.key"
                        placeholder="Key"
                        size="small"
                        :availableVariables="availableVariables"
                        @input="onParamChange"
                      />
                    </div>
                    <div class="flex-1">
                      <VariableInput
                        v-model="param.value"
                        placeholder="Value"
                        size="small"
                        :availableVariables="availableVariables"
                        @input="onParamChange"
                      />
                    </div>
                    <div class="flex justify-center" style="width: 40px;">
                      <Button
                        v-if="localRequest.params.length > 1 || param.key || param.value"
                        icon="pi pi-trash"
                        text
                        rounded
                        size="small"
                        severity="danger"
                        @click="removeParam(index)"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </template>
          </TabPanel>

          <TabPanel header="Authorization">
            <template v-if="isParamTabVisited(1)">
            <RequestAuthEditor
              v-model:auth="localRequest.auth"
              :availableVariables="availableVariables"
            />
            </template>
          </TabPanel>

          <TabPanel header="Headers">
            <template v-if="isParamTabVisited(2)">
            <RequestHeadersEditor
              v-model:headers="localRequest.headers"
              :availableVariables="availableVariables"
            />
            </template>
          </TabPanel>

          <TabPanel header="Body">
            <template v-if="isParamTabVisited(3)">
            <RequestBodyEditor
              v-model:body="localRequest.body"
              :availableVariables="availableVariables"
            />
            </template>
          </TabPanel>

          <TabPanel header="Tests">
            <template v-if="isParamTabVisited(4)">
            <RequestTestsEditor
              v-model:statusCodeTests="statusCodeTests"
              v-model:jsonFieldTests="jsonFieldTests"
              v-model:globalVariables="globalVariables"
            />
            </template>
          </TabPanel>

          <TabPanel header="Code">
            <template v-if="isParamTabVisited(5)">
            <RequestCodePanel
              :request="localRequest"
              :settings="currentSettings"
              :active-tab="activeParamTab"
              @import="applyCurlImport"
            />
            </template>
          </TabPanel>

          <TabPanel header="Settings">
            <template v-if="isParamTabVisited(6)">
            <RequestSettingsPanel
              v-model:followRedirects="followRedirects"
              v-model:maxRedirectCount="maxRedirectCount"
              v-model:verifySsl="verifySsl"
              v-model:autoEncodeUrl="autoEncodeUrl"
              v-model:acceptEncoding="acceptEncoding"
            />
            </template>
          </TabPanel>
        </TabView>
      </div>

      <!-- Response Section -->
      <ResponseViewer
        :response="response"
        :is-loading="isLoading"
        :elapsed-seconds="elapsedSeconds"
        :test-results="testResults"
        :request="{ method: localRequest.method, url: localRequest.url, name: localRequest.name }"
        v-model:activeResponseTab="activeResponseTab"
        v-model:activeBodyViewTab="activeBodyViewTab"
        v-model:responseHeight="responseHeight"
        v-model:isResponseCollapsed="isResponseCollapsed"
        @cancel="cancelRequest"
      />
    </div>

    <!-- Save Request Dialog -->
    <SaveRequestDialog
      v-model:visible="showSaveDialog"
      :collections="props.collections"
      :initial-name="saveDialogName"
      :initial-collection="saveDialogCollection"
      :initial-folder="saveDialogFolder"
      @save="onDialogSave"
    />
  </div>
</template>

<style scoped>
:deep(.request-tabs) {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

:deep(.request-tabs .p-tabview-panels) {
  flex: 1;
  overflow: hidden;
  padding: 0;
  display: flex;
  flex-direction: column;
}

:deep(.request-tabs .p-tabview-panel) {
  padding: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

:deep(.request-tabs .p-inputtext),
:deep(.request-tabs .p-inputtextarea),
:deep(.request-tabs .p-dropdown .p-dropdown-label) {
  line-height: 1.4 !important;
}

/* 整个 HttpRequest 页面内输入框高度一致，保持比例协调 */
:deep(.http-request .p-inputtext),
:deep(.http-request .p-inputtextarea),
:deep(.http-request .p-dropdown .p-dropdown-label) {
  line-height: 1.4 !important;
}

:deep(.http-request .p-inputtext),
:deep(.http-request .p-inputtextarea) {
  min-height: 35px;
  padding-top: 0.6rem;
  padding-bottom: 0.6rem;
}

:deep(.http-request .variable-input-wrapper) {
  min-height: 35px;
}

/* Body 搜索框与响应区搜索框高度保持一致：
   响应区搜索框用紧凑尺寸（字号 13px、上下内边距 0.375rem、无 min-height），
   而 Body 搜索框在 .request-tabs 内被加成 14px 字号 + 35px min-height + 0.6rem 内边距而偏高，这里还原为 small */
:deep(.request-tabs .body-search-input.p-inputtext) {
  min-height: 0;
  padding-top: 0.375rem;
  padding-bottom: 0.375rem;
  font-size: 13px;
}

/* Checkbox 选中时背景色为黑色 */
:deep(.p-checkbox .p-checkbox-box.p-highlight) {
  background: #000000;
  border-color: #000000;
}

/* `.p-dark` 在 <html> 上，须作普通祖先；经 .http-request(本组件作用域根) 桥接，
   再用 :deep() 进入 PrimeVue 内部节点。否则 :deep(.p-dark …) 会编译成
   [data-v] .p-dark … 永不匹配。 */
.p-dark .http-request :deep(.p-checkbox .p-checkbox-box.p-highlight) {
  background: #297aa0;
  border-color: #297aa0;
}

/* Params / Headers / Body / Tests 内部输入框高度保持一致 */
:deep(.request-tabs .p-inputtext),
:deep(.request-tabs .p-inputtextarea) {
  min-height: 35px;
  padding-top: 0.6rem;
  padding-bottom: 0.6rem;
  font-size: 14px;  /* 调整HttpRequest输入框字体大小 */
}

:deep(.request-tabs .variable-input-wrapper) {
  min-height: 35px;
}

:deep(.request-tabs .p-dropdown),
:deep(.request-tabs .p-select) {
  min-height: 35px;
  height: 35px;
}

/* Select label 内边距与 InputText 一致 */
:deep(.request-tabs .p-select .p-select-label) {
  padding-top: 0.6rem !important;
  padding-bottom: 0.6rem !important;
  line-height: 1.4 !important;
}

/* URL 地址栏与 HttpRequest 页面其他输入框高度保持一致 */
:deep(.http-request .top-url-row) {
  min-height: 42px;
  align-items: stretch;
}

:deep(.http-request .top-url-row > *) {
  min-height: 42px;
  height: 42px;
  align-self: stretch;
}

:deep(.http-request .top-url-row .p-dropdown),
:deep(.http-request .top-url-row .p-inputtext),
:deep(.http-request .top-url-row .p-splitbutton),
:deep(.http-request .top-url-row .p-button),
:deep(.http-request .top-url-row .variable-input-wrapper) {
  min-height: 42px !important;
  height: 42px !important;
}

:deep(.http-request .top-url-row .p-dropdown .p-dropdown-label),
:deep(.http-request .top-url-row .p-dropdown .p-dropdown-trigger),
:deep(.http-request .top-url-row .variable-input-wrapper .p-inputtext) {
  min-height: 42px !important;
  height: 42px !important;
  padding-top: 0.55rem !important;
  padding-bottom: 0.55rem !important;
  line-height: 1.4 !important;
}

:deep(.http-request .top-url-row .p-splitbutton .p-button),
:deep(.http-request .top-url-row .p-button) {
  min-height: 42px;
  height: 42px;
  padding-top: 0.6rem;
  padding-bottom: 0.6rem;
}

:deep(.http-request .variable-input-wrapper) {
  min-height: 42px;
  height: 42px;
}

:deep(.http-request .variable-input-wrapper .p-inputtext) {
  min-height: 42px;
  height: 42px;
}

.p-dark .http-request :deep(.p-checkbox .p-checkbox-box.p-highlight .p-checkbox-icon) {
  color: #ffffff;
}

/* Form Data Type Dropdown 样式 - 嵌入到input框内部 */
:deep(.form-data-type-dropdown .p-dropdown) {
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  min-height: 100% !important;
}

:deep(.form-data-type-dropdown .p-dropdown .p-dropdown-label) {
  background: transparent !important;
  border: none !important;
  padding: 0 0.5rem !important;
  font-size: 13px !important;
  line-height: 1.25rem !important;
  color: var(--text-color) !important;
}

:deep(.form-data-type-dropdown .p-dropdown .p-dropdown-trigger) {
  background: transparent !important;
  border: none !important;
  color: var(--text-color) !important;
}

:deep(.form-data-type-dropdown .p-dropdown .p-dropdown-trigger .p-dropdown-trigger-icon) {
  color: var(--text-color-secondary) !important;
}

:deep(.form-data-type-dropdown .p-dropdown:not(.p-disabled):hover) {
  background: rgba(0, 0, 0, 0.04) !important;
}

.p-dark .http-request :deep(.form-data-type-dropdown .p-dropdown:not(.p-disabled):hover) {
  background: rgba(255, 255, 255, 0.04) !important;
}

:deep(.form-data-type-dropdown .p-dropdown.p-focus) {
  box-shadow: none !important;
  border: none !important;
}

/* Password 组件占满宽度 */
:deep(.password-full-width) {
  width: 100%;
}

:deep(.password-full-width .p-password-input) {
  width: 100%;
}

/* Radio 选中时颜色 */
:deep(.p-radiobutton .p-radiobutton-box.p-highlight) {
  background: #3b82f6;
  border-color: #3b82f6;
}

:deep(.p-radiobutton .p-radiobutton-box.p-highlight .p-radiobutton-icon) {
  background: #fca5a5;
}

.p-dark .http-request :deep(.p-radiobutton .p-radiobutton-box.p-highlight) {
  background: #3994bc;
  border-color: #3994bc;
}

.p-dark .http-request :deep(.p-radiobutton .p-radiobutton-box.p-highlight .p-radiobutton-icon) {
  background: #fca5a5;
}

/* Beautify 按钮样式 */
:deep(.beautify-btn) {
  color: #fb923c !important;
}

:deep(.beautify-btn:hover) {
  color: #f97316 !important;
  background: rgba(251, 146, 60, 0.1) !important;
}

</style>
