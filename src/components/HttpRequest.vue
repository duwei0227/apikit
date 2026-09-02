<script setup>
import { ref, watch, computed, inject, onMounted, onUnmounted, nextTick } from 'vue';
import VariableInput from './VariableInput.vue';
import SaveRequestDialog from './SaveRequestDialog.vue';
import ResponseViewer from './ResponseViewer.vue';
import RequestTestsEditor from './RequestTestsEditor.vue';
import RequestBodyEditor from './RequestBodyEditor.vue';
import { apiService } from '@/services/api/apiService';
import { useKeyValueRows } from '@/composables/useKeyValueRows';
import { parseCurl } from '@/utils/curl-parser';
import { generateCurlCommand } from '@/utils/curl-generator';
import { debounce } from '@/utils/debounce';
import { formatJsonPreservingNumbers, parseJsonPreservingNumbers } from '@/utils/jsonFormat';
import { removeHttpHeader, setDefaultHeader } from '@/utils/httpHeaders';
import { canSendRequestBody } from '@/utils/httpMethods';
import { buildRequestUrl, parseRequestUrl, serializeRequestUrl } from '@/utils/urlQuery';
import { useRequestsStore } from '@/stores/requests';
import { useEnvironmentsStore } from '@/stores/environments';
import { normalizeTestConfig } from '@/utils/requestTests';

const props = defineProps({
  request: {
    type: Object,
    default: () => ({
      id: null,
      name: 'Untitled Request',
      method: 'GET',
      url: '',
      params: [{ key: '', value: '', enabled: true }],
      headers: [{ key: '', value: '', enabled: true }],
      body: {
        type: 'none',
        raw: '',
        formData: [{ key: '', value: '', type: 'text', enabled: true }],
        urlencoded: [{ key: '', value: '', enabled: true }]
      },
      auth: {
        type: 'none',
        token: '',
        username: '',
        password: ''
      },
      tests: '',
      saved: false // 是否已保存
    })
  },
  isActive: {
    type: Boolean,
    default: false
  },
  environmentManager: {
    type: Object,
    default: null
  },
  collections: {
    type: Array,
    default: () => []
  },
  embedded: {
    type: Boolean,
    default: false
  },
  editableName: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['update:request', 'close', 'add-console-log', 'save-request']);

const requestsStore = useRequestsStore();

// 从 store 的 responseCache 恢复状态
const cachedState = requestsStore.getResponseCache(props.request.id);

// Tests 相关数据（编辑 UI 在 RequestTestsEditor 子组件；这里持有数据供执行/保存/恢复）
const statusCodeTests = ref([
  { enabled: true, operator: 'equals', expectedValue: '200', description: '' }
]);
const jsonFieldTests = ref([
  { enabled: false, jsonPath: '', operator: 'equals', expectedValue: '', description: '' }
]);
const globalVariables = ref([
  { enabled: false, variableName: '', valueType: 'jsonPath', jsonPath: '', customValue: '', description: '' }
]);

// 测试操作符选项已移至 @/constants/testOperators
// 测试行的增删与折叠面板 UI 已移入 RequestTestsEditor 子组件

// 从JSON路径提取值
const extractValueFromJsonPath = (jsonData, path) => {
  try {
    // 移除开头的 $. 或 $
    let cleanPath = path.replace(/^\$\.?/, '');

    // 分割路径
    const parts = cleanPath.split(/\.|\[|\]/).filter(p => p);

    let value = jsonData;
    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[part];
    }

    return value;
  } catch (error) {
    console.error('Error extracting value from JSON path:', error);
    return undefined;
  }
};

// 执行测试
const executeTests = (responseData) => {
  const results = {
    statusCode: [],
    jsonFields: [],
    globalVars: []
  };

  // 1. 状态码测试
  statusCodeTests.value.forEach((test, index) => {
    if (!test.enabled) return;

    const actualStatus = responseData.status;
    const expectedStatus = parseInt(test.expectedValue);
    let passed = false;

    switch (test.operator) {
      case 'equals':
        passed = actualStatus === expectedStatus;
        break;
      case 'notEquals':
        passed = actualStatus !== expectedStatus;
        break;
      case 'greaterThan':
        passed = actualStatus > expectedStatus;
        break;
      case 'lessThan':
        passed = actualStatus < expectedStatus;
        break;
      case 'greaterThanOrEquals':
        passed = actualStatus >= expectedStatus;
        break;
      case 'lessThanOrEquals':
        passed = actualStatus <= expectedStatus;
        break;
    }

    results.statusCode.push({
      index,
      passed,
      message: `Status code ${actualStatus} ${test.operator} ${expectedStatus}`,
      description: test.description
    });
  });

  // 2. JSON字段测试
  let jsonData = null;
  try {
    jsonData = parseJsonPreservingNumbers(responseData.rawBody);
  } catch (e) {
    console.error('Response is not valid JSON');
  }

  if (jsonData) {
    jsonFieldTests.value.forEach((test, index) => {
      if (!test.enabled || !test.jsonPath) return;

      const actualValue = extractValueFromJsonPath(jsonData, test.jsonPath);
      let passed = false;

      switch (test.operator) {
        case 'equals':
          passed = String(actualValue) === String(test.expectedValue);
          break;
        case 'notEquals':
          passed = String(actualValue) !== String(test.expectedValue);
          break;
        case 'contains':
          passed = String(actualValue).includes(test.expectedValue);
          break;
        case 'notContains':
          passed = !String(actualValue).includes(test.expectedValue);
          break;
        case 'exists':
          passed = actualValue !== undefined && actualValue !== null;
          break;
        case 'notExists':
          passed = actualValue === undefined || actualValue === null;
          break;
        case 'greaterThan':
          passed = Number(actualValue) > Number(test.expectedValue);
          break;
        case 'lessThan':
          passed = Number(actualValue) < Number(test.expectedValue);
          break;
        case 'greaterThanOrEquals':
          passed = Number(actualValue) >= Number(test.expectedValue);
          break;
        case 'lessThanOrEquals':
          passed = Number(actualValue) <= Number(test.expectedValue);
          break;
      }

      results.jsonFields.push({
        index,
        passed,
        message: `${test.jsonPath}: ${actualValue} ${test.operator} ${test.expectedValue}`,
        description: test.description,
        actualValue,
        operator: test.operator,
        expectedValue: test.expectedValue,
        jsonPath: test.jsonPath
      });
    });

    // 检查所有断言是否都通过
    const allStatusTestsPassed = results.statusCode.every(r => r.passed);
    const allJsonTestsPassed = results.jsonFields.every(r => r.passed);
    const allAssertionsPassed = allStatusTestsPassed && allJsonTestsPassed;

    console.log('[HttpRequest] All assertions passed:', allAssertionsPassed);
    console.log('[HttpRequest] Status tests passed:', allStatusTestsPassed, 'JSON tests passed:', allJsonTestsPassed);

    // 3. 设置全局变量（仅在所有断言通过时）
    if (allAssertionsPassed) {
      globalVariables.value.forEach((variable, index) => {
        if (!variable.enabled || !variable.variableName) return;

        let value;

        // 根据类型决定值的来源
        if (variable.valueType === 'customValue') {
          // 使用自定义值
          value = variable.customValue;
          console.log(`[HttpRequest] Using custom value for ${variable.variableName}:`, value);
        } else {
          // 使用JSON路径提取值
          if (!variable.jsonPath || !jsonData) {
            console.log(`[HttpRequest] Missing jsonPath or jsonData for ${variable.variableName}`);
            return;
          }
          value = extractValueFromJsonPath(jsonData, variable.jsonPath);
          console.log(`[HttpRequest] Extracted value from ${variable.jsonPath}:`, value);
        }

        if (value !== undefined && props.environmentManager) {
          console.log('[HttpRequest] environmentManager exists, attempting to set global variable');

          // environmentManager 可能直接是组件实例，也可能是 ref
          let manager = props.environmentManager;

          // 如果是 ref，通过 .value 访问
          if (manager && typeof manager === 'object' && 'value' in manager && manager.value) {
            console.log('[HttpRequest] environmentManager is a ref, accessing .value');
            manager = manager.value;
          }

          console.log('[HttpRequest] manager:', manager);
          console.log('[HttpRequest] manager.setGlobalVariable type:', typeof manager?.setGlobalVariable);

          if (manager && typeof manager.setGlobalVariable === 'function') {
            console.log(`[HttpRequest] Calling setGlobalVariable(${variable.variableName}, ${value})`);
            manager.setGlobalVariable(variable.variableName, value, true, variable.description);

            results.globalVars.push({
              index,
              success: true,
              message: `Set ${variable.variableName} = ${value}`,
              description: variable.description
            });
          } else {
            console.error('[HttpRequest] setGlobalVariable is not a function or manager is null');
          }
        } else {
          console.log('[HttpRequest] value is undefined or environmentManager is null');
        }
      });
    } else {
      console.log('[HttpRequest] Skipping global variable setting because some assertions failed');
    }
  }

  return results;
};

// 深拷贝创建完全独立的本地请求实例
const localRequest = ref(JSON.parse(JSON.stringify(props.request)));
const REQUEST_TAB_INDEX = {
  params: 0,
  body: 3,
};

const getInitialRequestTab = (request, state) => {
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
const activeResponseTab = ref(cachedState?.activeResponseTab || 0);
const activeBodyViewTab = ref(cachedState?.activeBodyViewTab || 0);
const response = ref(cachedState?.response || null);
const isLoading = ref(false);
const isEditingName = ref(false);
const elapsedSeconds = ref(0);
let elapsedTimer = null;

watch(isLoading, (loading) => {
  if (loading) {
    elapsedSeconds.value = 0;
    elapsedTimer = setInterval(() => { elapsedSeconds.value++; }, 1000);
  } else {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
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
const testResults = ref(cachedState?.testResults || null);
let currentRequestId = null; // 当前请求 ID，用于取消

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
statusCodeTests.value = JSON.parse(JSON.stringify(normalizedInitialTests.statusCodeTests));
jsonFieldTests.value = JSON.parse(JSON.stringify(normalizedInitialTests.jsonFieldTests));
globalVariables.value = JSON.parse(JSON.stringify(normalizedInitialTests.globalVariables));
localRequest.value.testsConfig = JSON.parse(JSON.stringify(normalizedInitialTests));

// 监听 props.request.name 的变化，同步更新 localRequest.name
watch(
  () => props.request.name,
  (newName) => {
    if (newName && newName !== localRequest.value.name) {
      console.log('[HttpRequest] Request name changed from parent, updating:', newName);
      localRequest.value.name = newName;
    }
  }
);

// 检查是否需要自动显示保存对话框
if (props.request._showSaveDialog && props.request._initialCollection) {
  // 延迟显示对话框，确保组件已完全挂载
  setTimeout(() => {
    // 预填充传给 SaveRequestDialog（子组件在打开时据此初始化选中项）
    saveDialogName.value = localRequest.value.name;
    saveDialogCollection.value = props.request._initialCollection;
    saveDialogFolder.value = props.request._initialFolder || null;
    showSaveDialog.value = true;

    // 立即清除临时标记，防止再次触发
    delete props.request._showSaveDialog;
    delete props.request._initialCollection;
    delete props.request._initialFolder;
  }, 100);
}

const environmentsStore = useEnvironmentsStore();

const getEnvironmentManager = () => {
  let manager = props.environmentManager;
  if (manager && manager.value) {
    manager = manager.value;
  }
  return manager;
};

// 获取可用变量 — 直接使用 store 的响应式 computed，再追加内置变量
const availableVariables = computed(() => {
  const manager = getEnvironmentManager();
  const vars = manager && typeof manager.getAllAvailableVariables === 'function'
    ? { ...manager.getAllAvailableVariables() }
    : { ...environmentsStore.getAllAvailableVariables };

  // 内置变量（用于 hasInvalidVariables 校验，值不重要）
  const builtIns = [
    '$timestamp', '$isoTimestamp', '$randomInt', '$guid',
    '$date', '$time', '$datetime',
    '$randomAlpha', '$randomNumeric', '$randomUppercase',
    '$randomLowercase', '$randomAlphanumeric', '$randomChinese', '$sequence',
  ];
  builtIns.forEach(k => { if (!(k in vars)) vars[k] = ''; });

  return vars;
});

// 监听环境变化
watch(() => {
  const manager = getEnvironmentManager();
  return manager?.currentEnvironment;
}, (newVal) => {
  console.log('[HttpRequest] Environment changed to:', newVal);
}, { immediate: true });

// 自动补全协议前缀
const normalizeUrl = (url) => {
  if (!url) return url;
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return 'http://' + trimmed;
  }
  return trimmed;
};

// 替换变量的辅助函数
const replaceVariables = (str) => {
  if (!str || typeof str !== 'string') return str;

  console.log('[HttpRequest] replaceVariables called with:', str);

  if (props.environmentManager) {
    const manager = getEnvironmentManager();

    console.log('[HttpRequest] Manager:', manager);
    console.log('[HttpRequest] Manager has replaceVariables:', typeof manager?.replaceVariables);

    if (manager && typeof manager.replaceVariables === 'function') {
      const result = manager.replaceVariables(str);
      console.log('[HttpRequest] Replaced result:', result);
      return result;
    }
  }

  console.log('[HttpRequest] No replacement, returning original:', str);
  return str;
};

const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

const authTypes = [
  { label: 'No Auth', value: 'none' },
  { label: 'Bearer Token', value: 'bearer' },
  { label: 'Basic Auth', value: 'basic' }
];

// 请求体编辑 UI（含 body 类型/JSON/form-data/urlencoded/搜索/美化）已移入 RequestBodyEditor 子组件

// 常用 HTTP Headers
const commonHeaders = [
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Connection',
  'Content-Type',
  'Cookie',
  'Host',
  'Origin',
  'Referer',
  'User-Agent',
  'X-Requested-With',
  'X-Forwarded-For',
  'X-Forwarded-Proto',
  'X-Api-Key',
  'X-Auth-Token'
];

// Header 值的预设选项
const headerValueOptions = {
  'Content-Type': [
    'application/json',
    'application/xml',
    'application/soap+xml',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'text/plain',
    'text/html',
    'text/xml',
    'application/javascript',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/gif'
  ],
  'Accept': [
    'application/json',
    'application/xml',
    'text/html',
    'text/plain',
    '*/*'
  ],
  'Accept-Encoding': [
    'gzip',
    'deflate',
    'br',
    'gzip, deflate, br'
  ],
  'Accept-Language': [
    'en-US',
    'en',
    'zh-CN',
    'zh',
    'en-US,en;q=0.9',
    'zh-CN,zh;q=0.9,en;q=0.8'
  ],
  'Cache-Control': [
    'no-cache',
    'no-store',
    'max-age=0',
    'max-age=3600',
    'public',
    'private'
  ],
  'Connection': [
    'keep-alive',
    'close'
  ]
};

const filteredHeaderKeys = ref([]);
const filteredHeaderValues = ref([]);
const activeHeaderKeyIndex = ref(-1);
const activeHeaderValueIndex = ref(-1);
const headerSuggestionsStyle = ref({});
// Index of the highlighted suggestion within the open key/value dropdown (for
// up/down keyboard navigation). Distinct from active*Index above, which is the
// header ROW whose dropdown is open.
const highlightedHeaderKeyIndex = ref(0);
const highlightedHeaderValueIndex = ref(0);
const headerKeyDropdownRef = ref(null);
const headerValueDropdownRef = ref(null);

const updateHeaderSuggestionsPosition = (event) => {
  const input = event?.target;
  if (!input || typeof input.getBoundingClientRect !== 'function') return;

  const rect = input.getBoundingClientRect();
  headerSuggestionsStyle.value = {
    width: `${rect.width}px`,
    left: `${rect.left}px`,
    top: `${rect.bottom + 4}px`
  };
};

const filterHeaderKeys = (event, index) => {
  updateHeaderSuggestionsPosition(event);
  const query = event.target.value.toLowerCase();
  if (query) {
    filteredHeaderKeys.value = commonHeaders.filter(h =>
      h.toLowerCase().includes(query)
    );
    activeHeaderKeyIndex.value = index;
    highlightedHeaderKeyIndex.value = 0;
  } else {
    filteredHeaderKeys.value = [];
    activeHeaderKeyIndex.value = -1;
  }
};

const selectHeaderKey = (header, index) => {
  localRequest.value.headers[index].key = header;
  filteredHeaderKeys.value = [];
  activeHeaderKeyIndex.value = -1;
  onHeaderChange();
};

const filterHeaderValues = (event, index) => {
  updateHeaderSuggestionsPosition(event);
  const headerKey = localRequest.value.headers[index].key;
  const query = event.target.value.toLowerCase();

  if (headerKey && headerValueOptions[headerKey]) {
    if (query) {
      filteredHeaderValues.value = headerValueOptions[headerKey].filter(v =>
        v.toLowerCase().includes(query)
      );
    } else {
      filteredHeaderValues.value = headerValueOptions[headerKey];
    }
    activeHeaderValueIndex.value = index;
    highlightedHeaderValueIndex.value = 0;
  } else {
    filteredHeaderValues.value = [];
    activeHeaderValueIndex.value = -1;
  }
};

const selectHeaderValue = (value, index) => {
  localRequest.value.headers[index].value = value;
  filteredHeaderValues.value = [];
  activeHeaderValueIndex.value = -1;
  onHeaderChange();
};

// Keep the highlighted suggestion scrolled into view during keyboard nav.
const scrollHeaderSuggestionIntoView = (dropdownRef, idx) => {
  nextTick(() => {
    dropdownRef.value?.children?.[idx]?.scrollIntoView({ block: 'nearest' });
  });
};

// Up/Down/Enter/Escape navigation for the built-in header dropdowns. Bound via
// @keydown on the VariableInput (falls through to its root, so native keydown
// bubbles here). VariableInput's own handler ignores arrows unless ITS {{ }}
// suggestions are open, so the two never fight for the same keypress.
const onHeaderKeyKeydown = (event, index) => {
  if (filteredHeaderKeys.value.length === 0 || activeHeaderKeyIndex.value < 0) return;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      highlightedHeaderKeyIndex.value = Math.min(highlightedHeaderKeyIndex.value + 1, filteredHeaderKeys.value.length - 1);
      scrollHeaderSuggestionIntoView(headerKeyDropdownRef, highlightedHeaderKeyIndex.value);
      break;
    case 'ArrowUp':
      event.preventDefault();
      highlightedHeaderKeyIndex.value = Math.max(highlightedHeaderKeyIndex.value - 1, 0);
      scrollHeaderSuggestionIntoView(headerKeyDropdownRef, highlightedHeaderKeyIndex.value);
      break;
    case 'Enter':
      if (filteredHeaderKeys.value[highlightedHeaderKeyIndex.value]) {
        event.preventDefault();
        selectHeaderKey(filteredHeaderKeys.value[highlightedHeaderKeyIndex.value], index);
      }
      break;
    case 'Escape':
      event.preventDefault();
      filteredHeaderKeys.value = [];
      activeHeaderKeyIndex.value = -1;
      break;
  }
};

const onHeaderValueKeydown = (event, index) => {
  if (filteredHeaderValues.value.length === 0 || activeHeaderValueIndex.value < 0) return;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      highlightedHeaderValueIndex.value = Math.min(highlightedHeaderValueIndex.value + 1, filteredHeaderValues.value.length - 1);
      scrollHeaderSuggestionIntoView(headerValueDropdownRef, highlightedHeaderValueIndex.value);
      break;
    case 'ArrowUp':
      event.preventDefault();
      highlightedHeaderValueIndex.value = Math.max(highlightedHeaderValueIndex.value - 1, 0);
      scrollHeaderSuggestionIntoView(headerValueDropdownRef, highlightedHeaderValueIndex.value);
      break;
    case 'Enter':
      if (filteredHeaderValues.value[highlightedHeaderValueIndex.value]) {
        event.preventDefault();
        selectHeaderValue(filteredHeaderValues.value[highlightedHeaderValueIndex.value], index);
      }
      break;
    case 'Escape':
      event.preventDefault();
      filteredHeaderValues.value = [];
      activeHeaderValueIndex.value = -1;
      break;
  }
};

const hideHeaderSuggestions = () => {
  setTimeout(() => {
    filteredHeaderKeys.value = [];
    filteredHeaderValues.value = [];
    activeHeaderKeyIndex.value = -1;
    activeHeaderValueIndex.value = -1;
  }, 200);
};

// Debounce the upward emit: it drives the parent's per-keystroke cascade
// (request.value reassignment + full re-render + hasChanges() running ~7
// JSON.stringify on the whole request). Running that synchronously on every
// keystroke overloads the input tick and races with WebView2's IME finalize,
// dropping every other committed Chinese character (the bug disappears when
// DevTools is open because it changes the timing). Sending uses localRequest
// directly, and draft saving is already debounced downstream, so deferring this
// emit is safe.
const emitRequestUpdate = debounce((val) => emit('update:request', val), 250);
watch(localRequest, (newVal) => {
  emitRequestUpdate(newVal);
}, { deep: true });

// 同步 Tests 数据到 localRequest，使其随 localRequest 一起持久化
watch([statusCodeTests, jsonFieldTests, globalVariables], () => {
  localRequest.value.testsConfig = {
    statusCodeTests: JSON.parse(JSON.stringify(statusCodeTests.value)),
    jsonFieldTests: JSON.parse(JSON.stringify(jsonFieldTests.value)),
    globalVariables: JSON.parse(JSON.stringify(globalVariables.value))
  };
}, { deep: true });

// 监听 params 变化，当 key 被删除时同步更新 URL
watch(() => localRequest.value.params, (newParams) => {
  // 如果是由 syncUrlFromParams 触发的 params 变化，则跳过（避免循环覆盖）
  if (isSyncingUrlFromParams) return;
  syncUrlFromParams();
}, { deep: true });

// 监听 URL 变化，当用户在 URL 输入框中粘贴或修改时同步到 Params
watch(() => localRequest.value.url, (newUrl) => {
  // 如果是由 syncUrlFromParams 触发的 URL 变化，则跳过（避免循环覆盖）
  if (isSyncingUrlFromParams) return;
  // 延迟执行，等待用户停止输入
  debouncedSyncParamsFromUrl();
});

// SplitButton menu items
const sendMenuItems = ref([
  {
    label: 'Send And Download',
    icon: 'pi pi-download',
    command: () => sendAndDownload()
  }
]);

// 根据 Content-Type 获取文件扩展名
const prettyPrintPartial = (text) => {
  const trimmed = text.trim();
  if (!trimmed) return text;
  let result = '';
  let indent = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) { result += ch; escape = false; continue; }
    if (ch === '\\' && inString) { result += ch; escape = true; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString) { result += ch; continue; }
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue;
    if (ch === '{' || ch === '[') {
      // peek for empty object/array
      let j = i + 1;
      while (j < trimmed.length && ' \n\r\t'.includes(trimmed[j])) j++;
      const closing = ch === '{' ? '}' : ']';
      if (j < trimmed.length && trimmed[j] === closing) {
        result += ch + closing; i = j; continue;
      }
      result += ch + '\n'; indent++; result += '  '.repeat(indent);
    } else if (ch === '}' || ch === ']') {
      indent = Math.max(0, indent - 1);
      result += '\n' + '  '.repeat(indent) + ch;
    } else if (ch === ',') {
      result += ch + '\n' + '  '.repeat(indent);
    } else if (ch === ':') {
      result += ch + ' ';
    } else {
      result += ch;
    }
  }
  return result;
};

const getExtensionFromContentType = (contentType) => {
  if (!contentType) return '';

  const mimeType = contentType.split(';')[0].trim().toLowerCase();
  const mimeToExt = {
    // 文档
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',

    // 图片
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',

    // 音视频
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'video/mp4': '.mp4',
    'video/mpeg': '.mpeg',
    'video/webm': '.webm',
    'video/ogg': '.ogv',

    // 压缩文件
    'application/zip': '.zip',
    'application/x-rar-compressed': '.rar',
    'application/x-7z-compressed': '.7z',
    'application/x-tar': '.tar',
    'application/gzip': '.gz',

    // 文本
    'text/plain': '.txt',
    'text/html': '.html',
    'text/css': '.css',
    'text/javascript': '.js',
    'text/csv': '.csv',
    'text/xml': '.xml',
    'application/json': '.json',
    'application/xml': '.xml',

    // 其他
    'application/octet-stream': '.bin'
  };

  return mimeToExt[mimeType] || '';
};

const getFilePath = (file) => file?.path || '';

// 构建 multipart form data 用于文件上传
const buildMultipartData = async (formDataItems) => {
  const fields = [];

  for (const item of formDataItems) {
    if (!item.enabled || !item.key) continue;

    if (item.type === 'file') {
      const file = item.file;
      const filePath = item.filePath || getFilePath(file);
      const filename = file?.name || item.value;
      if (!filePath && !file) continue;

      const field = {
        name: replaceVariables(item.key),
        value: '',
        filename,
        mimeType: file?.type || null
      };

      if (filePath) {
        field.filePath = filePath;
      } else {
        field.value = await fileToBase64(file);
      }

      fields.push(field);
    } else if (item.type === 'text') {
      // 文本字段
      fields.push({
        name: replaceVariables(item.key),
        value: replaceVariables(item.value),
        filename: null,
        mimeType: null
      });
    }
  }

  return { fields };
};

// 将文件转换为 base64
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // 移除 data:image/png;base64, 前缀，只保留 base64 内容
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// 极快响应（< MIN_LOADING_MS）时保证加载遮罩至少显示一段时间，
// 避免用户感觉"无变化"。值可按手感调整。
const MIN_LOADING_MS = 300;
const ensureMinLoadingDuration = async (startTime) => {
  const elapsed = Date.now() - startTime;
  if (elapsed < MIN_LOADING_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_LOADING_MS - elapsed));
  }
};

const cancelRequest = async () => {
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
          description: test.description
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

const sendRequest = async () => {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  currentRequestId = requestId;

  isLoading.value = true;
  isResponseCollapsed.value = false; // 发送请求时展开响应区域
  const startTime = Date.now();

  // 准备console log数据
  const consoleLog = {
    id: Date.now(),
    startTime,
    method: localRequest.value.method,
    url: '',
    requestHeaders: {},
    requestBody: null,
    endTime: 0,
    status: 0,
    statusText: '',
    duration: '',
    responseHeaders: {},
    responseBody: ''
  };

  let multipartData = null; // 用于文件上传

  try {
    // 构建完整的 URL（包含查询参数）- 替换变量
    console.log('[HttpRequest] Original URL:', localRequest.value.url);
    const url = buildRequestUrl(localRequest.value.url, localRequest.value.params, {
      autoEncode: autoEncodeUrl.value,
      transform: replaceVariables,
      normalizeBaseUrl: normalizeUrl,
    });
    console.log('[HttpRequest] Final URL with params:', url);

    consoleLog.url = url;

    // 构建请求头 - 替换变量
    const headers = {};
    localRequest.value.headers
      .filter(h => h.enabled && h.key)
      .forEach(h => {
        headers[replaceVariables(h.key)] = replaceVariables(h.value);
      });

    // 添加认证头 - 替换变量
    if (localRequest.value.auth.type === 'bearer' && localRequest.value.auth.token) {
      const token = replaceVariables(localRequest.value.auth.token);
      headers['Authorization'] = token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
    } else if (localRequest.value.auth.type === 'basic' && localRequest.value.auth.username) {
      const username = replaceVariables(localRequest.value.auth.username);
      const password = replaceVariables(localRequest.value.auth.password);
      const credentials = btoa(`${username}:${password}`);
      headers['Authorization'] = `Basic ${credentials}`;
    }

    // Inject Accept-Encoding if enabled and not already set by user
    if (acceptEncoding.value && !Object.keys(headers).some(k => k.toLowerCase() === 'accept-encoding')) {
      headers['Accept-Encoding'] = 'gzip, deflate, br';
    }

    // 构建请求体 - 替换变量
    let body = null;
    if (canSendRequestBody(localRequest.value.method)) {
      if (localRequest.value.body.type === 'json') {
        setDefaultHeader(headers, 'Content-Type', 'application/json');
        if (localRequest.value.body.raw) {
          body = replaceVariables(localRequest.value.body.raw);
        }
      } else if (localRequest.value.body.type === 'xml') {
        setDefaultHeader(headers, 'Content-Type', 'application/xml');
        if (localRequest.value.body.raw) {
          body = replaceVariables(localRequest.value.body.raw);
        }
      } else if (localRequest.value.body.type === 'text') {
        setDefaultHeader(headers, 'Content-Type', 'text/plain');
        if (localRequest.value.body.raw) {
          body = replaceVariables(localRequest.value.body.raw);
        }
      } else if (localRequest.value.body.type === 'binary') {
        setDefaultHeader(headers, 'Content-Type', 'application/octet-stream');
      } else if (localRequest.value.body.type === 'x-www-form-urlencoded') {
        setDefaultHeader(headers, 'Content-Type', 'application/x-www-form-urlencoded');
        const enabledData = localRequest.value.body.urlencoded.filter(r => r.enabled && r.key);
        body = enabledData
          .map(r => `${encodeURIComponent(replaceVariables(r.key))}=${encodeURIComponent(replaceVariables(r.value))}`)
          .join('&');
      } else if (localRequest.value.body.type === 'form-data') {
        // 检查是否有文件上传
        const hasFileUpload = localRequest.value.body.formData.some(
          r => r.enabled && r.key && r.type === 'file' && (r.file || r.filePath)
        );

        if (hasFileUpload) {
          // 使用 multipart form data 上传文件和文本字段
          removeHttpHeader(headers, 'Content-Type'); // 让 reqwest 自动设置 boundary
          multipartData = await buildMultipartData(localRequest.value.body.formData);
        } else {
          // 纯文本字段，简化处理
          const formDataObj = {};
          localRequest.value.body.formData
            .filter(r => r.enabled && r.key && r.type === 'text')
            .forEach(r => {
              formDataObj[replaceVariables(r.key)] = replaceVariables(r.value);
            });
          setDefaultHeader(headers, 'Content-Type', 'application/json');
          body = JSON.stringify(formDataObj);
        }
      }
    }

    consoleLog.requestHeaders = { ...headers };
    consoleLog.requestBody = body;

    // 通过 Rust command 发送请求
    const result = await apiService.sendHttpRequest({
      requestId,
      method: localRequest.value.method,
      url,
      headers,
      body: multipartData ? undefined : (body || undefined),
      bodyFilePath: canSendRequestBody(localRequest.value.method)
        && localRequest.value.body.type === 'binary' && localRequest.value.body.filePath
        ? replaceVariables(localRequest.value.body.filePath)
        : undefined,
      multipart: multipartData || undefined,
      maxRedirections: followRedirects.value ? maxRedirectCount.value : 0,
      verifySsl: verifySsl.value,
      acceptEncoding: acceptEncoding.value,
    });

    if (result.requestContentType) {
      headers['Content-Type'] = result.requestContentType;
      consoleLog.requestHeaders = { ...headers };
    }

    const endTime = Date.now();

    // 从 headers 数组中提取 content-type
    const responseHeaders = {};
    for (const [key, value] of result.headers) {
      // 同名 header 可能有多个（如 set-cookie），用逗号拼接
      if (responseHeaders[key]) {
        responseHeaders[key] += ', ' + value;
      } else {
        responseHeaders[key] = value;
      }
    }
    const contentType = responseHeaders['content-type'] || '';

    let responseText = '';
    let imageDataUrl = '';

    // 判断是否为二进制内容类型
    const isBinaryContent = contentType.startsWith('image/')
      || contentType.startsWith('audio/')
      || contentType.startsWith('video/')
      || contentType.includes('octet-stream')
      || contentType.includes('pdf')
      || contentType.includes('zip')
      || contentType.includes('gzip')
      || contentType.startsWith('font/');

    if (isBinaryContent) {
      if (contentType.startsWith('image/')) {
        imageDataUrl = `data:${contentType};base64,${result.body}`;
      }
      responseText = `[Binary: ${contentType}, ${result.bodyBytes} bytes]`;
    } else {
      // 文本内容：从 base64 解码
      const binaryStr = atob(result.body);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      responseText = new TextDecoder('utf-8').decode(bytes);
    }

    // 尝试解析为 JSON
    let responseBody = responseText;
    let isPartialJson = false;
    if (!isBinaryContent) {
      try {
        responseBody = formatJsonPreservingNumbers(responseText);
      } catch (e) {
        const isJsonContent = contentType.includes('json') ;
        if (isJsonContent) {
          const partial = prettyPrintPartial(responseText);
          if (partial !== responseText) {
            responseBody = partial;
            isPartialJson = true;
          }
        }
      }
    }

    // 计算响应大小
    const sizeBytes = result.bodyBytes;
    const sizeStr = sizeBytes < 1024
      ? `${sizeBytes}B`
      : sizeBytes < 1024 * 1024
        ? `${(sizeBytes / 1024).toFixed(2)}KB`
        : `${(sizeBytes / (1024 * 1024)).toFixed(2)}MB`;

    response.value = {
      status: result.status,
      statusText: result.statusText,
      time: `${result.durationMs}ms`,
      size: sizeStr,
      body: responseBody,
      rawBody: responseText,
      headers: responseHeaders,
      contentType: contentType,
      imageDataUrl: imageDataUrl,
      isPartialJson: isPartialJson
    };

    // 更新console log
    consoleLog.endTime = endTime;
    consoleLog.status = result.status;
    consoleLog.statusText = result.statusText;
    consoleLog.duration = `${result.durationMs}ms`;
    consoleLog.responseHeaders = responseHeaders;
    consoleLog.responseBody = responseText;

    emit('add-console-log', consoleLog);

    // 执行测试并保存结果
    if (response.value) {
      console.log('[HttpRequest] Executing tests with response:', response.value);
      console.log('[HttpRequest] globalVariables:', globalVariables.value);
      console.log('[HttpRequest] props.environmentManager:', props.environmentManager);

      testResults.value = executeTests(response.value);
      console.log('[HttpRequest] Test Results:', testResults.value);
      console.log('[HttpRequest] Global vars set:', testResults.value?.globalVars);
    }
  } catch (error) {
    const endTime = Date.now();

    // 检查是否是用户取消的请求
    if (error === 'Request cancelled' || (typeof error === 'string' && error.includes('cancelled'))) {
      console.log('Request was cancelled by user');
      return; // 用户取消，不显示错误
    }

    response.value = {
      status: 0,
      statusText: 'Error',
      time: `${endTime - startTime}ms`,
      size: '0B',
      body: `Error: ${error.message || error}`,
      rawBody: `Error: ${error.message || error}`,
      headers: {},
      contentType: '',
      imageDataUrl: ''
    };

    // 更新console log for error
    consoleLog.endTime = endTime;
    consoleLog.status = 0;
    consoleLog.statusText = 'Error';
    consoleLog.duration = `${endTime - startTime}ms`;
    consoleLog.responseBody = `Error: ${error.message || error}`;

    emit('add-console-log', consoleLog);
  } finally {
    // 保证加载遮罩至少显示 MIN_LOADING_MS，极快响应也能看到反馈
    await ensureMinLoadingDuration(startTime);
    // 若期间已发起新请求（含已取消），不要覆盖其加载状态
    if (currentRequestId === requestId) {
      isLoading.value = false;
      currentRequestId = null;
    }
  }
};

const sendAndDownload = async () => {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  currentRequestId = requestId;

  isLoading.value = true;
  isResponseCollapsed.value = false;
  const startTime = Date.now();

  let multipartData = null; // 用于文件上传

  try {
    // 构建完整的 URL（包含查询参数）- 替换变量
    const url = buildRequestUrl(localRequest.value.url, localRequest.value.params, {
      autoEncode: autoEncodeUrl.value,
      transform: replaceVariables,
      normalizeBaseUrl: normalizeUrl,
    });

    // 构建请求头 - 替换变量
    const headers = {};
    localRequest.value.headers
      .filter(h => h.enabled && h.key)
      .forEach(h => {
        headers[replaceVariables(h.key)] = replaceVariables(h.value);
      });

    // 添加认证头 - 替换变量
    if (localRequest.value.auth.type === 'bearer' && localRequest.value.auth.token) {
      const token = replaceVariables(localRequest.value.auth.token);
      headers['Authorization'] = token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
    } else if (localRequest.value.auth.type === 'basic' && localRequest.value.auth.username) {
      const username = replaceVariables(localRequest.value.auth.username);
      const password = replaceVariables(localRequest.value.auth.password);
      const credentials = btoa(`${username}:${password}`);
      headers['Authorization'] = `Basic ${credentials}`;
    }

    // Inject Accept-Encoding if enabled and not already set by user
    if (acceptEncoding.value && !Object.keys(headers).some(k => k.toLowerCase() === 'accept-encoding')) {
      headers['Accept-Encoding'] = 'gzip, deflate, br';
    }

    // 构建请求体 - 替换变量
    let body = null;
    if (canSendRequestBody(localRequest.value.method)) {
      if (localRequest.value.body.type === 'json') {
        setDefaultHeader(headers, 'Content-Type', 'application/json');
        if (localRequest.value.body.raw) {
          body = replaceVariables(localRequest.value.body.raw);
        }
      } else if (localRequest.value.body.type === 'xml') {
        setDefaultHeader(headers, 'Content-Type', 'application/xml');
        if (localRequest.value.body.raw) {
          body = replaceVariables(localRequest.value.body.raw);
        }
      } else if (localRequest.value.body.type === 'text') {
        setDefaultHeader(headers, 'Content-Type', 'text/plain');
        if (localRequest.value.body.raw) {
          body = replaceVariables(localRequest.value.body.raw);
        }
      } else if (localRequest.value.body.type === 'binary') {
        setDefaultHeader(headers, 'Content-Type', 'application/octet-stream');
      } else if (localRequest.value.body.type === 'x-www-form-urlencoded') {
        setDefaultHeader(headers, 'Content-Type', 'application/x-www-form-urlencoded');
        const enabledData = localRequest.value.body.urlencoded.filter(r => r.enabled && r.key);
        body = enabledData
          .map(r => `${encodeURIComponent(replaceVariables(r.key))}=${encodeURIComponent(replaceVariables(r.value))}`)
          .join('&');
      } else if (localRequest.value.body.type === 'form-data') {
        // 检查是否有文件上传
        const hasFileUpload = localRequest.value.body.formData.some(
          r => r.enabled && r.key && r.type === 'file' && (r.file || r.filePath)
        );

        if (hasFileUpload) {
          // 使用 multipart form data 上传文件和文本字段
          removeHttpHeader(headers, 'Content-Type'); // 让 reqwest 自动设置 boundary
          multipartData = await buildMultipartData(localRequest.value.body.formData);
        } else {
          // 纯文本字段，简化处理
          const formDataObj = {};
          localRequest.value.body.formData
            .filter(r => r.enabled && r.key && r.type === 'text')
            .forEach(r => {
              formDataObj[replaceVariables(r.key)] = replaceVariables(r.value);
            });
          setDefaultHeader(headers, 'Content-Type', 'application/json');
          body = JSON.stringify(formDataObj);
        }
      }
    }

    // 通过 Rust command 发送请求
    const result = await apiService.sendHttpRequest({
      requestId,
      method: localRequest.value.method,
      url,
      headers,
      body: multipartData ? undefined : (body || undefined),
      bodyFilePath: canSendRequestBody(localRequest.value.method)
        && localRequest.value.body.type === 'binary' && localRequest.value.body.filePath
        ? replaceVariables(localRequest.value.body.filePath)
        : undefined,
      multipart: multipartData || undefined,
      maxRedirections: followRedirects.value ? maxRedirectCount.value : 0,
      verifySsl: verifySsl.value,
      acceptEncoding: acceptEncoding.value,
    });

    const endTime = Date.now();

    // 从 headers 数组中提取
    const responseHeaders = {};
    for (const [key, value] of result.headers) {
      if (responseHeaders[key]) {
        responseHeaders[key] += ', ' + value;
      } else {
        responseHeaders[key] = value;
      }
    }
    const contentType = responseHeaders['content-type'] || '';

    // 将 body 转为 Uint8Array 用于文件写入
    let uint8Array;
    if (result.isBase64) {
      const binaryStr = atob(result.body);
      uint8Array = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        uint8Array[i] = binaryStr.charCodeAt(i);
      }
    } else {
      const encoder = new TextEncoder();
      uint8Array = encoder.encode(result.body);
    }

    // 动态导入 Tauri 插件
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');

    // 从 Content-Disposition 或 URL 中提取文件名
    let suggestedFileName = 'download';
    const contentDisposition = responseHeaders['content-disposition'] || '';

    if (contentDisposition) {
      // 尝试多种 Content-Disposition 格式
      // 格式1: filename="example.pdf"
      // 格式2: filename=example.pdf
      // 格式3: filename*=UTF-8''example.pdf
      const fileNameMatch = contentDisposition.match(/filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']*)['"]?/i);
      if (fileNameMatch && fileNameMatch[1]) {
        suggestedFileName = decodeURIComponent(fileNameMatch[1].trim());
      }
    }

    // 如果 Content-Disposition 没有提供文件名，从 URL 中提取
    if (suggestedFileName === 'download') {
      try {
        const urlObj = new URL(url);
        // 移除查询参数，只保留路径
        const urlPath = urlObj.pathname;
        const urlFileName = urlPath.substring(urlPath.lastIndexOf('/') + 1);

        // 如果 URL 路径有文件名（包含扩展名）
        if (urlFileName && urlFileName.includes('.')) {
          suggestedFileName = decodeURIComponent(urlFileName);
        } else if (urlFileName) {
          // 如果有路径但没有扩展名，根据 Content-Type 添加扩展名
          suggestedFileName = decodeURIComponent(urlFileName);
          const extension = getExtensionFromContentType(contentType);
          if (extension && !suggestedFileName.includes('.')) {
            suggestedFileName += extension;
          }
        } else {
          // URL 路径为空，使用 Content-Type 生成文件名
          const extension = getExtensionFromContentType(contentType);
          suggestedFileName = `download${extension}`;
        }
      } catch (e) {
        console.error('Error parsing URL:', e);
        // 使用 Content-Type 生成默认文件名
        const extension = getExtensionFromContentType(contentType);
        suggestedFileName = `download${extension}`;
      }
    }

    console.log('Suggested file name:', suggestedFileName);
    console.log('Content-Type:', contentType);
    console.log('Content-Disposition:', contentDisposition);

    // 打开保存对话框
    const filePath = await save({
      defaultPath: suggestedFileName,
      filters: []
    });

    if (filePath) {
      // 写入文件
      await writeFile(filePath, uint8Array);

      // 显示成功消息
      if (window.$toast) {
        window.$toast.add({
          severity: 'success',
          summary: 'Download Complete',
          detail: `File saved to ${filePath}`,
          life: 3000
        });
      }

      // 更新响应显示
      const sizeBytes = result.bodyBytes;
      const sizeStr = sizeBytes < 1024
        ? `${sizeBytes}B`
        : sizeBytes < 1024 * 1024
          ? `${(sizeBytes / 1024).toFixed(2)}KB`
          : `${(sizeBytes / (1024 * 1024)).toFixed(2)}MB`;

      response.value = {
        status: result.status,
        statusText: result.statusText,
        time: `${result.durationMs}ms`,
        size: sizeStr,
        body: `File downloaded successfully to:\n${filePath}`,
        rawBody: `File downloaded successfully to:\n${filePath}`,
        headers: responseHeaders,
        contentType: contentType,
        imageDataUrl: ''
      };
    } else {
      // 用户取消了保存
      if (window.$toast) {
        window.$toast.add({
          severity: 'info',
          summary: 'Download Cancelled',
          detail: 'File download was cancelled',
          life: 2000
        });
      }
    }
  } catch (error) {
    const endTime = Date.now();

    // 检查是否是用户取消的请求
    if (error === 'Request cancelled' || (typeof error === 'string' && error.includes('cancelled'))) {
      console.log('Download request was cancelled by user');
      return; // 用户取消，不显示错误
    }

    response.value = {
      status: 0,
      statusText: 'Error',
      time: `${endTime - startTime}ms`,
      size: '0B',
      body: `Error: ${error.message || error}`,
      rawBody: `Error: ${error.message || error}`,
      headers: {},
      contentType: '',
      imageDataUrl: ''
    };

    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Download Failed',
        detail: error.message || 'Failed to download file',
        life: 3000
      });
    }
  } finally {
    // 保证加载遮罩至少显示 MIN_LOADING_MS，极快响应也能看到反馈
    await ensureMinLoadingDuration(startTime);
    // 若期间已发起新请求（含已取消），不要覆盖其加载状态
    if (currentRequestId === requestId) {
      isLoading.value = false;
      currentRequestId = null;
    }
  }
};

// Query params: empty-table removal resets the single row; onChange also re-syncs the URL.
const { add: addParam, remove: removeParam, onChange: onParamChange } = useKeyValueRows({
  getRows: () => localRequest.value.params,
  createRow: () => ({ key: '', value: '', enabled: true }),
  removeStrategy: 'replaceLast',
  onAfterChange: () => syncUrlFromParams(),
});

// ==================== URL 与 Params 双向同步 ====================

// 当 Params 变化时，同步更新 URL
let isSyncingUrlFromParams = false; // 防止由 params 同步触发的 URL 变化被重复解析
const syncUrlFromParams = () => {
  const parsedUrl = parseRequestUrl(localRequest.value.url);
  const newUrl = serializeRequestUrl(parsedUrl.baseUrl, localRequest.value.params, {
    autoEncode: false,
    fragment: parsedUrl.fragment,
  });

  // 如果新 URL 与当前 URL 不同，则更新
  if (newUrl !== localRequest.value.url) {
    isSyncingUrlFromParams = true;
    localRequest.value.url = newUrl;
    // 重置标志，允许后续的 URL 变化被处理
    setTimeout(() => {
      isSyncingUrlFromParams = false;
    }, 0);
  }
};

// 当 URL 变化时，解析并更新 Params
let isSyncingUrl = false; // 防止循环同步
const syncParamsFromUrl = () => {
  if (isSyncingUrl) return;
  isSyncingUrl = true;
  isSyncingUrlFromParams = true; // 防止 params watcher 反向覆盖 URL

  try {
    const url = localRequest.value.url;
    const parsedUrl = parseRequestUrl(url);
    const parsedParams = parsedUrl.params;

    if (parsedParams.length > 0) {
      // 用解析出的参数完全替换旧 params
      localRequest.value.params = [...parsedParams];

      // 确保最后一行为空行
      const hasEmptyRow = localRequest.value.params.some(p => !p.key && !p.value);
      if (!hasEmptyRow) {
        localRequest.value.params.push({ key: '', value: '', enabled: true });
      }
    } else {
      // URL 中已无 query 参数，清空 params 表
      localRequest.value.params = [{ key: '', value: '', enabled: true }];
    }
  } finally {
    setTimeout(() => {
      isSyncingUrl = false;
      isSyncingUrlFromParams = false;
      // Only rebuild URL from params when the input is not focused;
      // while typing, preserve the user's partial input (e.g. a bare "?").
      if (!isUrlInputFocused.value) {
        syncUrlFromParams();
      }
    }, 0);
  }
};

// 监听 URL 变化的防抖版本（用于粘贴等场景）
let urlWatchTimeout = null;
const debouncedSyncParamsFromUrl = () => {
  if (urlWatchTimeout) {
    clearTimeout(urlWatchTimeout);
  }
  urlWatchTimeout = setTimeout(() => {
    syncParamsFromUrl();
  }, 300);
};

const { add: addHeader, remove: removeHeader, onChange: onHeaderChange } = useKeyValueRows({
  getRows: () => localRequest.value.headers,
  createRow: () => ({ key: '', value: '', enabled: true }),
});

// 响应搜索/高亮/滚动、resize、折叠、响应相关 computed（isImageResponse/responseLanguage/
// shouldUseCodeEditor/testResultsSummary）、getOperatorLabel 等均已移入 ResponseViewer 子组件

// cURL 生成和导入相关
const curlInput = ref('');
const activeCodeTab = ref(0); // 0: Export, 1: Import

// 保存相关
const showSaveDialog = ref(false);
const collections = ref([]); // 从父组件获取的collections数据
// 保存对话框的预填充数据（传给 SaveRequestDialog 子组件）
const saveDialogName = ref('');
const saveDialogCollection = ref(null);
const saveDialogFolder = ref(null);

// 检查请求名称是否在同一目录下重复
const isRequestNameDuplicate = (collectionId, folderId, requestName, excludeRequestId = null) => {
  const collection = props.collections.find(c => c.id === collectionId);
  if (!collection) return false;

  // 获取目标目录下的所有请求
  let requests = [];
  if (folderId) {
    // 在指定 folder 中查找
    const findFolder = (folders, targetId) => {
      for (const folder of folders) {
        if (folder.id === targetId) return folder;
        if (folder.folders && folder.folders.length > 0) {
          const found = findFolder(folder.folders, targetId);
          if (found) return found;
        }
      }
      return null;
    };
    const folder = findFolder(collection.folders || [], folderId);
    requests = folder?.requests || [];
  } else {
    // 在 collection 根目录下查找
    requests = collection.requests || [];
  }

  // 检查是否有同名请求（排除当前请求自己）
  return requests.some(req =>
    req.name.toLowerCase() === requestName.toLowerCase() &&
    req.id !== excludeRequestId
  );
};

const generateCurl = (variableResolver = (value) => value) => generateCurlCommand(
  localRequest.value,
  {
    followRedirects: followRedirects.value,
    maxRedirectCount: maxRedirectCount.value,
    verifySsl: verifySsl.value,
    autoEncodeUrl: autoEncodeUrl.value,
    acceptEncoding: acceptEncoding.value,
  },
  variableResolver,
);

const createCurlPreviewResolver = () => {
  const manager = getEnvironmentManager();
  if (manager && typeof manager.createVariableResolver === 'function') {
    return manager.createVariableResolver({ consumeSequences: false });
  }

  // 环境管理器尚未挂载时仍解析 store 中已有的环境/全局变量。
  const variables = { ...environmentsStore.getAllAvailableVariables };
  return (value) => String(value ?? '').replace(/\{\{([^}]+)\}\}/g, (match, variableName) => {
    const key = variableName.trim();
    return variables[key] !== undefined ? variables[key] : match;
  });
};

// computed 本身就是一次稳定快照；请求、设置、环境或页签变化后才会重新生成。
const curlPreview = computed(() => {
  void activeParamTab.value;
  void activeCodeTab.value;
  return generateCurl(createCurlPreviewResolver());
});

const copyCurl = async () => {
  try {
    await navigator.clipboard.writeText(curlPreview.value);
    // 显示成功提示
    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Copied',
        detail: 'cURL command copied to clipboard',
        life: 2000
      });
    }
  } catch (error) {
    console.error('Failed to copy:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to copy to clipboard',
        life: 3000
      });
    }
  }
};

const importCurl = () => {
  if (!curlInput.value.trim()) return;

  try {
    const parsed = parseCurl(curlInput.value);

    // 回填解析结果到 localRequest
    localRequest.value.method = parsed.method;
    localRequest.value.headers = parsed.headers;
    localRequest.value.auth = parsed.auth;
    localRequest.value.body = parsed.body;
    localRequest.value.tests = '';
    followRedirects.value = parsed.settings.followRedirects;
    maxRedirectCount.value = parsed.settings.maxRedirectCount;
    verifySsl.value = parsed.settings.verifySsl;
    autoEncodeUrl.value = parsed.settings.autoEncodeUrl;
    acceptEncoding.value = parsed.settings.acceptEncoding;

    if (parsed.warnings.length > 0 && window.$toast) {
      window.$toast.add({
        severity: 'warn',
        summary: 'Imported with warnings',
        detail: parsed.warnings.map(warning => warning.message).join(' '),
        life: 5000
      });
    }

    // 解析 URL 中的 query 参数到 Params，URL 保留完整内容
    const parsedParams = parseRequestUrl(parsed.url).params;
    if (parsedParams.length > 0) {
      localRequest.value.params = [...parsedParams, { key: '', value: '', enabled: true }];
      localRequest.value.url = parsed.url;
    } else {
      localRequest.value.params = [{ key: '', value: '', enabled: true }];
      localRequest.value.url = parsed.url;
    }

    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Imported',
        detail: 'cURL command imported successfully',
        life: 2000
      });
    }
  } catch (error) {
    console.error('Failed to parse cURL:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to parse cURL command. Please check the format.',
        life: 3000
      });
    }
  }
};

// 保存相关方法
const handleSaveClick = () => {
  // 如果请求还没有分配 collection，显示对话框让用户选择
  if (!localRequest.value.collectionId) {
    openSaveDialog();
  } else {
    // 已经有 collection，直接保存
    saveRequestDirectly();
  }
};

const openSaveDialog = () => {
  saveDialogName.value = localRequest.value.name;
  saveDialogCollection.value = null;
  saveDialogFolder.value = null;
  showSaveDialog.value = true;
};

const saveRequestDirectly = () => {
  // 直接保存到已有的 collection/folder
  const collection = props.collections.find(c => c.id === localRequest.value.collectionId);

  if (!collection) {
    console.error('Collection not found:', localRequest.value.collectionId);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Collection not found',
        life: 3000
      });
    }
    return;
  }

  // 查找 folder（如果有）
  let folder = null;
  if (localRequest.value.folderId) {
    const findFolder = (folders, folderId) => {
      for (const f of folders) {
        if (f.id === folderId) return f;
        if (f.folders && f.folders.length > 0) {
          const found = findFolder(f.folders, folderId);
          if (found) return found;
        }
      }
      return null;
    };
    folder = findFolder(collection.folders || [], localRequest.value.folderId);
  }

  const requestToSave = {
    id: localRequest.value.id,
    name: localRequest.value.name,
    method: localRequest.value.method,
    url: localRequest.value.url,
    params: localRequest.value.params.filter(p => p.key || p.value),
    headers: localRequest.value.headers.filter(h => h.key || h.value),
    body: { ...localRequest.value.body },
    auth: { ...localRequest.value.auth },
    tests: localRequest.value.tests,
    testsConfig: {
      statusCodeTests: JSON.parse(JSON.stringify(statusCodeTests.value)),
      jsonFieldTests: JSON.parse(JSON.stringify(jsonFieldTests.value)),
      globalVariables: JSON.parse(JSON.stringify(globalVariables.value))
    },
    settings: { ...localRequest.value.settings },
    collectionId: localRequest.value.collectionId,
    folderId: localRequest.value.folderId,
    createdAt: localRequest.value.createdAt,
    updatedAt: new Date().toISOString()
  };

  const saveData = {
    request: requestToSave,
    collection: collection,
    folder: folder
  };

  // 发出保存事件（不移动位置，只更新内容）
  emit('save-request', saveData);
};

// 由 SaveRequestDialog 的 @save 事件触发，payload 为 { name, collection, folder }
const onDialogSave = ({ name, collection, folder }) => {
  // 检查名称是否重复
  const targetFolderId = folder?.id || null;
  if (isRequestNameDuplicate(collection.id, targetFolderId, name, localRequest.value.id)) {
    if (window.$toast) {
      window.$toast.add({
        severity: 'warn',
        summary: 'Duplicate Name',
        detail: 'A request with this name already exists in the same location',
        life: 3000
      });
    }
    return;
  }

  const requestToSave = {
    id: localRequest.value.id || Date.now(),
    name,
    method: localRequest.value.method,
    url: localRequest.value.url,
    params: localRequest.value.params.filter(p => p.key || p.value),
    headers: localRequest.value.headers.filter(h => h.key || h.value),
    body: { ...localRequest.value.body },
    auth: { ...localRequest.value.auth },
    tests: localRequest.value.tests,
    testsConfig: {
      statusCodeTests: JSON.parse(JSON.stringify(statusCodeTests.value)),
      jsonFieldTests: JSON.parse(JSON.stringify(jsonFieldTests.value)),
      globalVariables: JSON.parse(JSON.stringify(globalVariables.value))
    },
    settings: { ...localRequest.value.settings },
    collectionId: localRequest.value.collectionId,  // 保留旧位置信息
    folderId: localRequest.value.folderId,          // 保留旧位置信息
    createdAt: localRequest.value.createdAt,
    updatedAt: new Date().toISOString()
  };

  const saveData = {
    request: requestToSave,
    collection,
    folder
  };

  // 更新本地请求状态
  localRequest.value.name = name;
  localRequest.value.saved = true;
  localRequest.value.id = requestToSave.id;
  // 更新 collectionId 和 folderId
  localRequest.value.collectionId = collection.id;
  localRequest.value.folderId = folder?.id || null;

  // 发出保存事件（成功提示由上层 MainContent.handleSaveRequest 在实际持久化后统一弹出）
  emit('save-request', saveData);

  // 关闭对话框
  showSaveDialog.value = false;
};

// 保存位置选择（树构建、节点选择、路径显示）已移入 SaveRequestDialog 子组件

// Keyboard shortcut handler for Ctrl+S
const handleKeyDown = (event) => {
  // Only handle Ctrl+S if this is the active request
  if (!props.isActive) return;

  // Check for Ctrl+S (or Cmd+S on Mac)
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault(); // Prevent browser's default save dialog
    handleSaveClick();
  }
};

// Add keyboard event listener on mount
onMounted(() => {
  console.log('[HttpRequest] MOUNTED - requestId:', localRequest.value.id);
  window.addEventListener('keydown', handleKeyDown);
  
  // 初始化时如果 params 有数据但 URL 没有 query 参数，同步一次
  const hasParams = localRequest.value.params.some(p => p.key);
  const hasQuery = localRequest.value.url && localRequest.value.url.includes('?');
  if (hasParams && !hasQuery) {
    syncUrlFromParams();
  }
});

// Remove keyboard event listener on unmount
onUnmounted(() => {
  console.log('[HttpRequest] UNMOUNTED - requestId:', localRequest.value.id);
  window.removeEventListener('keydown', handleKeyDown);
  clearInterval(elapsedTimer);
});

// 暴露方法供父组件调用
defineExpose({
  openSaveDialog,
  getCurrentRequest: () => JSON.parse(JSON.stringify(localRequest.value))
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
          class="text-sm font-medium border-0 p-0 focus:ring-0 flex-1"
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
        <TabView v-model:activeIndex="activeParamTab" class="request-tabs" lazy>
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
            <div class="p-4 overflow-y-auto">
              <div class="mb-3">
                <h4 class="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Query Params</h4>
              </div>

              <!-- Table Header -->
              <div class="flex gap-2 mb-2 text-sm font-bold text-surface-700 dark:text-surface-300 px-2">
                <div style="width: 40px;"></div>
                <div class="flex-1">KEY</div>
                <div class="flex-1">VALUE</div>
                <div style="width: 40px;"></div>
              </div>

              <!-- Table Rows -->
              <div class="space-y-1">
                <div
                  v-for="(param, index) in localRequest.params"
                  :key="index"
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
          </TabPanel>

          <TabPanel header="Authorization">
            <div class="p-4 overflow-y-auto">
              <div class="mb-4">
                <label class="block text-sm font-medium mb-2">Type</label>
                <Dropdown
                  v-model="localRequest.auth.type"
                  :options="authTypes"
                  optionLabel="label"
                  optionValue="value"
                  class="w-full"
                />
              </div>

              <!-- Bearer Token -->
              <div v-if="localRequest.auth.type === 'bearer'" class="space-y-4">
                <div>
                  <label class="block text-sm font-medium mb-2">Token</label>
                  <VariableInput
                    v-model="localRequest.auth.token"
                    placeholder="Enter bearer token"
                    :availableVariables="availableVariables"
                  />
                </div>
              </div>

              <!-- Basic Auth -->
              <div v-if="localRequest.auth.type === 'basic'" class="space-y-4">
                <div>
                  <label class="block text-sm font-medium mb-2">Username</label>
                  <VariableInput
                    v-model="localRequest.auth.username"
                    placeholder="Enter username"
                    :availableVariables="availableVariables"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium mb-2">Password</label>
                  <Password
                    v-model="localRequest.auth.password"
                    placeholder="Enter password"
                    :feedback="false"
                    toggleMask
                    inputClass="w-full"
                    class="w-full password-full-width"
                  />
                </div>
              </div>

              <!-- No Auth -->
              <div v-if="localRequest.auth.type === 'none'" class="text-sm text-surface-500 dark:text-surface-400">
                This request does not use any authorization.
              </div>
            </div>
          </TabPanel>

          <TabPanel header="Headers">
            <div class="p-4 overflow-y-auto">
              <div class="mb-3">
                <h4 class="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Headers</h4>
              </div>

              <!-- Table Header -->
              <div class="flex gap-2 mb-2 text-sm font-bold text-surface-700 dark:text-surface-300 px-2">
                <div style="width: 40px;"></div>
                <div class="flex-1">KEY</div>
                <div class="flex-1">VALUE</div>
                <div style="width: 40px;"></div>
              </div>

              <!-- Table Rows -->
              <div class="space-y-1">
                <div
                  v-for="(header, index) in localRequest.headers"
                  :key="index"
                  class="flex gap-2 items-center"
                >
                  <div class="flex justify-center" style="width: 40px;">
                    <Checkbox v-model="header.enabled" :binary="true" />
                  </div>
                  <div class="flex-1 relative">
                    <VariableInput
                      v-model="header.key"
                      placeholder="Key"
                      size="small"
                      :availableVariables="availableVariables"
                      @input="(e) => { onHeaderChange(); filterHeaderKeys(e, index); }"
                      @focus="(e) => filterHeaderKeys(e, index)"
                      @keydown="(e) => onHeaderKeyKeydown(e, index)"
                      @blur="hideHeaderSuggestions"
                    />
                  </div>
                  <div class="flex-1 relative">
                    <VariableInput
                      v-model="header.value"
                      placeholder="Value"
                      size="small"
                      :availableVariables="availableVariables"
                      @input="(e) => { onHeaderChange(); filterHeaderValues(e, index); }"
                      @focus="(e) => filterHeaderValues(e, index)"
                      @keydown="(e) => onHeaderValueKeydown(e, index)"
                      @blur="hideHeaderSuggestions"
                    />
                  </div>
                  <div class="flex justify-center" style="width: 40px;">
                    <Button
                      v-if="localRequest.headers.length > 1 || header.key || header.value"
                      icon="pi pi-trash"
                      text
                      rounded
                      size="small"
                      severity="danger"
                      @click="removeHeader(index)"
                    />
                  </div>
                </div>
              </div>
              <Teleport to="body">
                <div
                  v-if="filteredHeaderKeys.length > 0 && activeHeaderKeyIndex >= 0"
                  ref="headerKeyDropdownRef"
                  class="header-suggestions-dropdown"
                  :style="headerSuggestionsStyle"
                >
                  <div
                    v-for="(suggestion, suggestionIndex) in filteredHeaderKeys"
                    :key="suggestion"
                    @mousedown="selectHeaderKey(suggestion, activeHeaderKeyIndex)"
                    @mouseenter="highlightedHeaderKeyIndex = suggestionIndex"
                    :class="[
                      'header-suggestion-item',
                      suggestionIndex === highlightedHeaderKeyIndex ? 'header-suggestion-item-active' : ''
                    ]"
                  >
                    {{ suggestion }}
                  </div>
                </div>
                <div
                  v-if="filteredHeaderValues.length > 0 && activeHeaderValueIndex >= 0"
                  ref="headerValueDropdownRef"
                  class="header-suggestions-dropdown"
                  :style="headerSuggestionsStyle"
                >
                  <div
                    v-for="(suggestion, suggestionIndex) in filteredHeaderValues"
                    :key="suggestion"
                    @mousedown="selectHeaderValue(suggestion, activeHeaderValueIndex)"
                    @mouseenter="highlightedHeaderValueIndex = suggestionIndex"
                    :class="[
                      'header-suggestion-item',
                      suggestionIndex === highlightedHeaderValueIndex ? 'header-suggestion-item-active' : ''
                    ]"
                  >
                    {{ suggestion }}
                  </div>
                </div>
              </Teleport>
            </div>
          </TabPanel>

          <TabPanel header="Body">
            <RequestBodyEditor
              v-model:body="localRequest.body"
              :availableVariables="availableVariables"
            />
          </TabPanel>

          <TabPanel header="Tests">
            <RequestTestsEditor
              v-model:statusCodeTests="statusCodeTests"
              v-model:jsonFieldTests="jsonFieldTests"
              v-model:globalVariables="globalVariables"
            />
          </TabPanel>

          <TabPanel header="Code">
            <div class="p-4 overflow-y-auto">
              <TabView v-model:activeIndex="activeCodeTab">
                <TabPanel header="Export">
                  <div class="space-y-3 pt-3">
                    <div class="flex justify-between items-center">
                      <h4 class="text-sm font-medium text-surface-700 dark:text-surface-300">cURL Command</h4>
                      <Button
                        label="Copy"
                        icon="pi pi-copy"
                        size="small"
                        @click="copyCurl"
                      />
                    </div>
                    <pre class="p-4 bg-surface-100 dark:bg-surface-900 rounded text-xs font-mono whitespace-pre-wrap overflow-x-auto border border-surface-200 dark:border-surface-700 max-h-96">{{ curlPreview }}</pre>
                  </div>
                </TabPanel>

                <TabPanel header="Import">
                  <div class="space-y-3 pt-3">
                    <div class="flex justify-between items-center">
                      <h4 class="text-sm font-medium text-surface-700 dark:text-surface-300">Paste cURL Command</h4>
                      <Button
                        label="Import"
                        icon="pi pi-download"
                        size="small"
                        @click="importCurl"
                        :disabled="!curlInput.trim()"
                      />
                    </div>
                    <Textarea
                      v-model="curlInput"
                      rows="10"
                      class="w-full font-mono text-xs"
                      placeholder="curl -X GET 'https://api.example.com/users' -H 'Authorization: Bearer token'"
                    />
                  </div>
                </TabPanel>
              </TabView>
            </div>
          </TabPanel>

          <TabPanel header="Settings">
            <div class="p-4 overflow-y-auto">
              <div class="space-y-4">
                <div class="flex items-center justify-between py-2">
                  <div>
                    <div class="text-sm font-medium text-surface-700 dark:text-surface-300">Automatically follow redirects</div>
                    <div class="text-xs text-surface-500 dark:text-surface-400 mt-1">When enabled, HTTP redirects (3xx) will be followed automatically</div>
                  </div>
                  <div class="flex items-center gap-2">
                    <ToggleSwitch v-model="followRedirects" />
                    <span class="text-xs font-medium" :class="followRedirects ? 'text-green-600 dark:text-green-400' : 'text-surface-400'">{{ followRedirects ? 'ON' : 'OFF' }}</span>
                  </div>
                </div>
                <div class="flex items-center justify-between py-2">
                  <div>
                    <div class="text-sm font-medium text-surface-700 dark:text-surface-300">Max redirects</div>
                    <div class="text-xs text-surface-500 dark:text-surface-400 mt-1">Maximum number of redirects to follow (1-50)</div>
                  </div>
                  <InputNumber v-model="maxRedirectCount" :min="1" :max="50" :step="1" showButtons class="w-24" size="small" inputClass="w-12 text-center" />
                </div>
                <div class="flex items-center justify-between py-2">
                  <div>
                    <div class="text-sm font-medium text-surface-700 dark:text-surface-300">Enable SSL certificate verification</div>
                    <div class="text-xs text-surface-500 dark:text-surface-400 mt-1">When disabled, accepts self-signed and invalid SSL certificates</div>
                  </div>
                  <div class="flex items-center gap-2">
                    <ToggleSwitch v-model="verifySsl" />
                    <span class="text-xs font-medium" :class="verifySsl ? 'text-green-600 dark:text-green-400' : 'text-surface-400'">{{ verifySsl ? 'ON' : 'OFF' }}</span>
                  </div>
                </div>
                <div class="flex items-center justify-between py-2">
                  <div>
                    <div class="text-sm font-medium text-surface-700 dark:text-surface-300">Encode URL automatically</div>
                    <div class="text-xs text-surface-500 dark:text-surface-400 mt-1">Automatically encode special characters in URL when sending requests</div>
                  </div>
                  <div class="flex items-center gap-2">
                    <ToggleSwitch v-model="autoEncodeUrl" />
                    <span class="text-xs font-medium" :class="autoEncodeUrl ? 'text-green-600 dark:text-green-400' : 'text-surface-400'">{{ autoEncodeUrl ? 'ON' : 'OFF' }}</span>
                  </div>
                </div>
                <div class="flex items-center justify-between py-2">
                  <div>
                    <div class="text-sm font-medium text-surface-700 dark:text-surface-300">Accept-Encoding: gzip, deflate, br</div>
                    <div class="text-xs text-surface-500 dark:text-surface-400 mt-1">Send compressed encoding header; Rust will decompress the response automatically</div>
                  </div>
                  <div class="flex items-center gap-2">
                    <ToggleSwitch v-model="acceptEncoding" />
                    <span class="text-xs font-medium" :class="acceptEncoding ? 'text-green-600 dark:text-green-400' : 'text-surface-400'">{{ acceptEncoding ? 'ON' : 'OFF' }}</span>
                  </div>
                </div>
              </div>
            </div>
          </TabPanel>
        </TabView>
      </div>

      <!-- Response Section -->
      <ResponseViewer
        :response="response"
        :is-loading="isLoading"
        :elapsed-seconds="elapsedSeconds"
        :test-results="testResults"
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
  background: #ffffff;
  border-color: #ffffff;
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

.header-suggestions-dropdown {
  position: fixed;
  z-index: 50;
  max-height: 16rem;
  overflow-y: auto;
  background: var(--p-surface-0, #ffffff);
  border: 1px solid var(--p-surface-300, #cbd5e1);
  border-radius: 0.375rem;
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
}

.header-suggestion-item {
  min-height: 40px;
  padding: 0.5rem 0.75rem;
  display: flex;
  align-items: center;
  font-size: 13px;
  line-height: 1.5rem;
  color: var(--p-text-color, #0f172a);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.header-suggestion-item:hover {
  background: var(--p-surface-200, #e2e8f0);
}

/* Keyboard-selected item — shares the bright blue --ac-selected-* accent with
   the {{ }} pickers. The variables switch per theme (style.css), so this single
   rule covers both light and dark; !important keeps it above the dark text rule. */
.header-suggestion-item-active {
  background: var(--ac-selected-bg, #2563eb) !important;
  color: var(--ac-selected-label-color, #ffffff) !important;
}

/* NOTE: `.p-dark` (on <html>) is an ANCESTOR, not a descendant, so :deep(.p-dark)
   compiled to `[data-v] .p-dark …` and never matched — the dropdown stayed white
   in dark mode. Plain `.p-dark <scoped> ` compiles to `.p-dark <scoped>[data-v]`,
   which correctly targets the scoped element under html.p-dark. */
.p-dark .header-suggestions-dropdown {
  background: var(--p-surface-900, #0f172a);
  border-color: var(--p-surface-700, #334155);
}

.p-dark .header-suggestion-item {
  color: var(--p-surface-50, #f8fafc);
}

.p-dark .header-suggestion-item:hover {
  background: var(--p-surface-800, #1e293b);
}

/* Tests 模块: Dropdown / Select 外层容器高度与 InputText 对齐 */
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
  color: #000000;
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
  background: #60a5fa;
  border-color: #60a5fa;
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
