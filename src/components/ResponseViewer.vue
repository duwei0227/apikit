<script setup lang="ts">
import { defineAsyncComponent, ref, computed, watch } from 'vue';
import AsyncPanelLoader from './AsyncPanelLoader.vue';
import { getOperatorLabel } from '@/constants/testOperators';
import StreamResponseView from './StreamResponseView.vue';
import SaveToMockDialog from './SaveToMockDialog.vue';
import { formatDuration } from '@/utils/streamResponse';
import { htmlPreviewAllowsScripts } from '@/constants/htmlPreview';
import { findTextMatches, type TextMatch } from '@/utils/textSearch';
import type { GlobalVariableTestResult, HttpMethod, HttpResponseView, RequestTestResults } from '@/types/models';

const allowPreviewScripts = htmlPreviewAllowsScripts();

const CodeEditor = defineAsyncComponent({
  loader: () => import('./CodeEditor.vue'),
  loadingComponent: AsyncPanelLoader,
  delay: 0,
});

// Read-only response data owned by the parent.
const props = withDefaults(defineProps<{
  response?: HttpResponseView | null;
  isLoading?: boolean;
  elapsedSeconds?: number;
  testResults?: RequestTestResults | null;
  /** 发出这个响应的请求；有值时显示「Save to Mock」 */
  request?: { method: HttpMethod; url: string; name: string } | null;
}>(), {
  response: null,
  isLoading: false,
  elapsedSeconds: 0,
  testResults: null,
  request: null,
});

const showSaveToMock = ref(false);

defineEmits<{ cancel: [] }>();

// Persisted UI state — two-way bound so the parent can cache/restore it.
const activeResponseTab = defineModel('activeResponseTab', { type: Number, default: 0 });
const activeBodyViewTab = defineModel('activeBodyViewTab', { type: Number, default: 0 });
const responseHeight = defineModel('responseHeight', { type: Number, default: 500 });
const isResponseCollapsed = defineModel('isResponseCollapsed', { type: Boolean, default: false });

const isResizing = ref(false);

// 超大响应只渲染前一部分，避免编辑器卡顿；复制、保存、断言仍使用完整内容
const LARGE_RESPONSE_CHARS = 5 * 1024 * 1024;
const PREVIEW_RESPONSE_CHARS = 1024 * 1024;
const isLargeResponse = computed(() => (props.response?.rawBody?.length || 0) > LARGE_RESPONSE_CHARS);
const previewText = (text: string | undefined) => {
  const value = text ?? '';
  return isLargeResponse.value ? value.slice(0, PREVIEW_RESPONSE_CHARS) : value;
};
const displayBody = computed(() => previewText(props.response?.body));
const displayRawBody = computed(() => previewText(props.response?.rawBody));

const saveFullResponse = async () => {
  const response = props.response;
  if (!response) return;
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const contentType = response.contentType || '';
    const extension = contentType.includes('json') ? 'json'
      : contentType.includes('xml') ? 'xml'
        : contentType.includes('html') ? 'html'
          : 'txt';
    const filePath = await save({ defaultPath: `response.${extension}` });
    if (!filePath) return;
    await writeTextFile(filePath, response.rawBody);
    window.$toast?.add({ severity: 'success', summary: 'Saved', detail: 'Response saved to file', life: 2000 });
  } catch (error) {
    console.error('Failed to save response:', error);
    window.$toast?.add({ severity: 'error', summary: 'Error', detail: 'Failed to save the response', life: 3000 });
  }
};

const copyResponseBody = async () => {
  if (!props.response) return;
  try {
    await navigator.clipboard.writeText(props.response.body);
    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Copied',
        detail: 'Response body copied to clipboard',
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

const copyRawResponseBody = async () => {
  if (!props.response) return;
  try {
    await navigator.clipboard.writeText(props.response.rawBody);
    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Copied',
        detail: 'Raw response copied to clipboard',
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

// 搜索相关（Response）
const showSearchBox = ref(false);
const searchQuery = ref('');
const searchCaseSensitive = ref(false);
const searchRegex = ref(false);
const searchMatches = ref<TextMatch[]>([]);
const currentMatchIndex = ref(-1);

// 每个打开的请求各有一个搜索框，按实例引用（不能在整个文档中查找）
const searchInputRef = ref<{ $el: HTMLInputElement } | null>(null);

const toggleSearchBox = () => {
  showSearchBox.value = !showSearchBox.value;
  if (showSearchBox.value) {
    // 打开搜索框时，聚焦输入框
    setTimeout(() => {
      const searchInput = searchInputRef.value?.$el;
      if (searchInput) searchInput.focus();
    }, 100);
  } else {
    // 关闭搜索框时，清除搜索
    clearSearch();
  }
};

// 打开搜索框（Ctrl+F 触发）- 若已打开则只聚焦；有选中内容时默认填充
const openSearchBox = (selectedText = '') => {
  if (!showSearchBox.value) {
    showSearchBox.value = true;
  }
  if (selectedText) {
    searchQuery.value = selectedText;
  }
  setTimeout(() => {
    const searchInput = searchInputRef.value?.$el;
    if (searchInput) {
      searchInput.focus();
      if (selectedText) searchInput.select?.();
    }
  }, 100);
};

const performSearch = () => {
  if (!props.response || !searchQuery.value) {
    searchMatches.value = [];
    currentMatchIndex.value = -1;
    return;
  }

  // 根据当前视图选择搜索内容
  const content = activeBodyViewTab.value === 0 ? displayBody.value : displayRawBody.value;

  try {
    searchMatches.value = findTextMatches(content, searchQuery.value, {
      caseSensitive: searchCaseSensitive.value,
      regex: searchRegex.value,
    });
    if (searchMatches.value.length > 0) {
      currentMatchIndex.value = 0;
      scrollToMatch(0);
    } else {
      currentMatchIndex.value = -1;
    }
  } catch (error) {
    console.error('Search error:', error);
    searchMatches.value = [];
    currentMatchIndex.value = -1;
  }
};

const clearSearch = () => {
  searchQuery.value = '';
  searchMatches.value = [];
  currentMatchIndex.value = -1;
};

const nextMatch = () => {
  if (searchMatches.value.length === 0) return;
  currentMatchIndex.value = (currentMatchIndex.value + 1) % searchMatches.value.length;
  scrollToMatch(currentMatchIndex.value);
};

const prevMatch = () => {
  if (searchMatches.value.length === 0) return;
  currentMatchIndex.value = currentMatchIndex.value <= 0
    ? searchMatches.value.length - 1
    : currentMatchIndex.value - 1;
  scrollToMatch(currentMatchIndex.value);
};

const scrollToMatch = (index: number) => {
  // 这个函数会在下一个 tick 中执行，确保 DOM 已更新
  setTimeout(() => {
    const matchElement = document.querySelector(`.search-match-${index}`);
    if (matchElement) {
      matchElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
};

const highlightedResponseBody = computed(() => {
  if (!props.response || searchMatches.value.length === 0) {
    return activeBodyViewTab.value === 0 ? displayBody.value : displayRawBody.value;
  }

  const content = activeBodyViewTab.value === 0 ? displayBody.value : displayRawBody.value;
  let result = '';
  let lastIndex = 0;

  searchMatches.value.forEach((match, idx) => {
    // 添加匹配前的文本
    result += escapeHtml(content.substring(lastIndex, match.index));

    // 添加高亮的匹配文本
    const isCurrentMatch = idx === currentMatchIndex.value;
    const highlightClass = isCurrentMatch
      ? 'bg-orange-400 dark:bg-orange-600 text-white search-match-' + idx
      : 'bg-yellow-200 dark:bg-yellow-700 search-match-' + idx;
    result += `<span class="${highlightClass}">${escapeHtml(match.text)}</span>`;

    lastIndex = match.index + match.length;
  });

  // 添加剩余的文本
  result += escapeHtml(content.substring(lastIndex));

  return result;
});

const escapeHtml = (text: string) => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

// 监听搜索参数变化
watch([searchQuery, searchCaseSensitive, searchRegex], () => {
  if (searchQuery.value) {
    performSearch();
  } else {
    clearSearch();
  }
});

// 监听 activeBodyViewTab 变化，重新搜索
watch(activeBodyViewTab, () => {
  if (searchQuery.value) {
    performSearch();
  }
});

const startResize = (event: MouseEvent) => {
  isResizing.value = true;
  const startY = event.clientY;
  const startHeight = responseHeight.value;

  const onMouseMove = (e: MouseEvent) => {
    const deltaY = startY - e.clientY;
    const newHeight = Math.max(200, Math.min(600, startHeight + deltaY));
    responseHeight.value = newHeight;
  };

  const onMouseUp = () => {
    isResizing.value = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
};

const toggleResponseCollapse = () => {
  isResponseCollapsed.value = !isResponseCollapsed.value;
};

const isImageResponse = computed(() => {
  if (!props.response) return false;
  const contentType = props.response.contentType.toLowerCase();
  return contentType.includes('image/');
});

const responseLanguage = computed(() => {
  if (!props.response) return 'text';
  const contentType = props.response.contentType.toLowerCase();

  if (contentType.includes('json')) return 'json';
  if (contentType.includes('xml')) return 'xml';
  if (contentType.includes('html')) return 'html';

  // 尝试从内容判断
  const body = props.response.rawBody.trim();
  if (body.startsWith('<?xml') || body.startsWith('<') && body.includes('</')) {
    if (body.toLowerCase().includes('<!doctype html') || body.toLowerCase().includes('<html')) {
      return 'html';
    }
    return 'xml';
  }

  return 'text';
});

const shouldUseCodeEditor = computed(() => {
  return ['json', 'xml', 'html'].includes(responseLanguage.value);
});

// 提取变量的结果：set 为已设置，skipped 为断言未通过而跳过，failed 为取不到值
// （旧版本缓存的结果没有 status，按 success 判断）
const isVariableSet = (result: GlobalVariableTestResult) => result.status ? result.status === 'set' : result.success !== false;
const variableResultName = (result: GlobalVariableTestResult) => result.variableName || result.message.split(' = ')[0].replace('Set ', '');
const variableResultValue = (result: GlobalVariableTestResult) => result.value ?? result.message.split(' = ')[1];

// 测试结果统计
const testResultsSummary = computed(() => {
  if (!props.testResults) return null;

  const statusTests = props.testResults.statusCode || [];
  const jsonTests = props.testResults.jsonFields || [];
  const globalVars = props.testResults.globalVars || [];

  const totalTests = statusTests.length + jsonTests.length;
  const passedTests = statusTests.filter(t => t.passed).length + jsonTests.filter(t => t.passed).length;
  const failedTests = totalTests - passedTests;

  return {
    total: totalTests,
    passed: passedTests,
    failed: failedTests,
    globalVarsSet: globalVars.filter(isVariableSet).length,
    hasTests: totalTests > 0
  };
});

const selectAllPreContent = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
    event.preventDefault();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(event.currentTarget as Node);
    selection.removeAllRanges();
    selection.addRange(range);
  } else if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
    event.preventDefault();
    openSearchBox();
  }
};
</script>

<template>
  <!-- Response Section -->
  <div
    class="border-t border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-950 flex flex-col relative shrink-0"
    :style="{ height: isResponseCollapsed ? '40px' : `${responseHeight}px` }"
    :aria-busy="isLoading"
  >
    <!-- Keep the response blocked while allowing the higher z-index Console to remain usable. -->
    <div
      v-if="isLoading && !isResponseCollapsed && !response?.stream?.active"
      class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 bg-surface-0/50 dark:bg-surface-900/50 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-label="Sending HTTP request"
    >
      <i class="pi pi-spin pi-spinner text-6xl text-primary" aria-hidden="true"></i>
      <span class="text-2xl font-semibold text-surface-900 dark:text-surface-50">Sending Request...</span>
      <span class="text-sm text-surface-400 dark:text-surface-500 tabular-nums">
        {{ elapsedSeconds }}s elapsed
      </span>
      <Button
        label="Cancel"
        icon="pi pi-times"
        severity="danger"
        size="large"
        @click="$emit('cancel')"
      />
    </div>

    <!-- Resize Handle (only when expanded) -->
    <div
      v-if="!isResponseCollapsed"
      @mousedown="startResize"
      class="h-1 bg-surface-200 dark:bg-surface-700 hover:bg-primary cursor-ns-resize transition"
      :class="{ 'bg-primary': isResizing }"
    ></div>

    <!-- Collapsed Bar -->
    <div
      v-if="isResponseCollapsed"
      @click="toggleResponseCollapse"
      class="h-full px-4 flex items-center justify-between cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-800 transition"
    >
      <div class="flex items-center gap-2 text-sm">
        <span class="font-medium text-surface-500 dark:text-surface-400">Response</span>
      </div>
      <div class="flex items-center gap-3 text-meta">
        <template v-if="response">
          <span
            class="px-2 py-0.5 rounded font-semibold"
            :class="response.status >= 200 && response.status < 300
              ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30'
              : 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30'"
          >
            Status: {{ response.status }} {{ response.statusText }}
          </span>
          <span class="text-surface-500 dark:text-surface-400">Time: {{ response.time }}</span>
          <span class="text-surface-500 dark:text-surface-400">Size: {{ response.size }}</span>
        </template>
        <i class="pi pi-chevron-up text-xs text-surface-400"></i>
      </div>
    </div>

    <!-- Expanded Content -->
    <div v-if="!isResponseCollapsed" class="flex-1 overflow-hidden flex flex-col">
      <!-- Empty State -->
      <div v-if="!response" class="flex-1 flex flex-col">
        <div class="flex items-center justify-between px-4 py-2 border-b border-surface-200 dark:border-surface-700">
          <span class="text-sm font-medium text-surface-500 dark:text-surface-400">Response</span>
          <Button
            icon="pi pi-chevron-down"
            text
            rounded
            size="small"
            severity="secondary"
            title="Collapse response"
            aria-label="Collapse response"
            @click="toggleResponseCollapse"
          />
        </div>
        <div class="flex-1 flex items-center justify-center">
          <div class="text-center text-surface-400 dark:text-surface-500">
            <i class="pi pi-send text-4xl mb-3"></i>
            <p class="text-sm">Send a request to see the response</p>
          </div>
        </div>
      </div>

      <!-- Response Tabs -->
      <div v-else class="flex-1 flex flex-col overflow-hidden response-with-status">
        <div class="response-status-bar">
          <span
            class="px-2 py-0.5 rounded font-semibold"
            :class="response.status >= 200 && response.status < 300
              ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30'
              : 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30'"
          >
            Status: {{ response.status }} {{ response.statusText }}
          </span>
          <template v-if="response.stream">
            <span
              v-if="response.stream.active"
              class="px-2 py-0.5 rounded font-semibold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30"
            >
              <i class="pi pi-spin pi-spinner text-xs mr-1"></i>Streaming
            </span>
            <span
              v-else-if="response.stream.interrupted"
              class="px-2 py-0.5 rounded font-semibold text-yellow-800 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30"
              :title="response.stream.interrupted === 'stopped' ? 'You stopped this stream' : response.stream.interrupted"
            >
              {{ response.stream.interrupted === 'stopped' ? 'Stopped' : 'Interrupted' }}
            </span>
            <span class="text-surface-500 dark:text-surface-400">First event: {{ formatDuration(response.stream.firstEventMs) }}</span>
          </template>
          <span class="text-surface-500 dark:text-surface-400">Time: {{ response.time }}</span>
          <span v-if="response.stream" class="text-surface-500 dark:text-surface-400">Events: {{ response.stream.eventCount }}</span>
          <span class="text-surface-500 dark:text-surface-400">Size: {{ response.size }}</span>
          <Button
            v-if="request && !response.stream && !isImageResponse"
            label="Save to Mock"
            icon="pi pi-server"
            size="small"
            text
            title="Save this response to a mock service"
            @click="showSaveToMock = true"
          />
          <Button
            v-if="response.stream?.active"
            label="Stop"
            icon="pi pi-stop"
            severity="danger"
            size="small"
            outlined
            @click="$emit('cancel')"
          />
          <Button
            icon="pi pi-chevron-down"
            text
            rounded
            size="small"
            severity="secondary"
            title="Collapse response"
            aria-label="Collapse response"
            @click="toggleResponseCollapse"
          />
        </div>
        <TabView v-model:activeIndex="activeResponseTab" class="response-tabs flex-1">
        <TabPanel>
          <template #header><span>Body</span></template>
          <StreamResponseView v-if="response.stream" :stream="response.stream" :allow-preview-scripts="allowPreviewScripts" />
          <div v-else class="flex flex-col h-full">
            <!-- Body View Tabs -->
            <div class="flex items-center justify-between bg-surface-0 dark:bg-surface-950">
              <Tabs v-model:value="activeBodyViewTab">
                <TabList>
                  <Tab :value="0">Pretty</Tab>
                  <Tab :value="1">Raw</Tab>
                </TabList>
              </Tabs>

              <div class="flex items-center gap-2 mr-2">
                <!-- Search Button -->
                <Button
                  v-if="!isImageResponse"
                  icon="pi pi-search"
                  size="small"
                  text
                  :class="{ 'text-primary': showSearchBox }"
                  title="Search in response"
                  @click="toggleSearchBox"
                />

                <!-- Copy Button -->
                <Button
                  v-if="!isImageResponse"
                  icon="pi pi-copy"
                  size="small"
                  text
                  :title="activeBodyViewTab === 0 ? 'Copy Response' : 'Copy Raw Response'"
                  @click="activeBodyViewTab === 0 ? copyResponseBody() : copyRawResponseBody()"
                />
              </div>
            </div>

            <!-- Search Box -->
            <div v-if="showSearchBox && !isImageResponse" class="p-2 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900">
              <div class="flex items-center gap-2">
                <InputText
                  v-model="searchQuery"
                  placeholder="Search..."
                  size="small"
                  ref="searchInputRef"
                  class="flex-1 response-search-input"
                  @keyup.enter="performSearch"
                  @keyup.esc="toggleSearchBox"
                />

                <!-- Case Sensitive Toggle -->
                <Button
                  label="Aa"
                  size="small"
                  :severity="searchCaseSensitive ? 'primary' : 'secondary'"
                  :outlined="!searchCaseSensitive"
                  :class="{ 'search-toggle-active': searchCaseSensitive }"
                  title="Match case"
                  @click="searchCaseSensitive = !searchCaseSensitive"
                />

                <!-- Regex Toggle -->
                <Button
                  label=".*"
                  size="small"
                  :severity="searchRegex ? 'primary' : 'secondary'"
                  :outlined="!searchRegex"
                  :class="{ 'search-toggle-active': searchRegex }"
                  title="Use regular expression"
                  @click="searchRegex = !searchRegex"
                />

                <!-- Match Counter -->
                <span v-if="searchMatches.length > 0" class="text-xs text-surface-600 dark:text-surface-400 whitespace-nowrap">
                  {{ currentMatchIndex + 1 }} / {{ searchMatches.length }}
                </span>
                <span v-else-if="searchQuery" class="text-xs text-surface-600 dark:text-surface-400">
                  No matches
                </span>

                <!-- Navigation Buttons -->
                <Button
                  icon="pi pi-chevron-up"
                  size="small"
                  text
                  :disabled="searchMatches.length === 0"
                  title="Previous match"
                  @click="prevMatch"
                />
                <Button
                  icon="pi pi-chevron-down"
                  size="small"
                  text
                  :disabled="searchMatches.length === 0"
                  title="Next match"
                  @click="nextMatch"
                />

                <!-- Close Button -->
                <Button
                  icon="pi pi-times"
                  size="small"
                  text
                  severity="secondary"
                  title="Close search"
                  @click="toggleSearchBox"
                />
              </div>
            </div>

            <!-- Large response notice -->
            <div
              v-if="isLargeResponse"
              class="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded px-3 py-2 text-xs border border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400"
            >
              <i class="pi pi-exclamation-triangle text-sm" />
              <span class="flex-1 min-w-0">Response is {{ response.size }}. Showing the first 1 MB.</span>
              <Button label="Copy Full Body" size="small" text @click="copyRawResponseBody" />
              <Button label="Save to File…" size="small" text @click="saveFullResponse" />
            </div>

            <!-- Pretty View -->
            <div v-if="activeBodyViewTab === 0" class="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col">
              <!-- Partial JSON warning -->
              <div
                v-if="response?.isPartialJson"
                class="mb-3 flex items-center gap-2 rounded px-3 py-2 text-xs border border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400"
              >
                <i class="pi pi-exclamation-triangle text-sm" />
                Partial JSON — response may be truncated. Switch to Raw tab to see original.
              </div>
              <!-- Image Response -->
              <div v-if="isImageResponse" class="flex items-center justify-center">
                <img
                  :src="response.imageDataUrl"
                  :alt="response.contentType"
                  class="max-w-full max-h-full object-contain"
                  style="max-height: 500px;"
                />
              </div>
              <!-- Code Response (JSON/XML/HTML) - 始终使用 CodeEditor，支持搜索高亮 -->
              <CodeEditor
                v-else-if="shouldUseCodeEditor"
                class="flex-1"
                :modelValue="displayBody"
                :language="responseLanguage"
                :readOnly="true"
                :searchMatches="searchMatches"
                :currentMatchIndex="currentMatchIndex"
                @ctrl-f="openSearchBox"
              />
              <!-- Text Response with search highlighting -->
              <pre v-else-if="searchMatches.length > 0" class="response-pre whitespace-pre-wrap" tabindex="0" @keydown="selectAllPreContent" v-html="highlightedResponseBody"></pre>
              <!-- Text Response without search -->
              <pre v-else class="response-pre whitespace-pre-wrap" tabindex="0" @keydown="selectAllPreContent">{{ displayBody }}</pre>
            </div>

            <!-- Raw View -->
            <div v-else class="flex-1 overflow-y-auto p-4">
              <!-- Text with search highlighting -->
              <pre v-if="searchMatches.length > 0" class="response-pre whitespace-pre-wrap" tabindex="0" @keydown="selectAllPreContent" v-html="highlightedResponseBody"></pre>
              <!-- Text without search -->
              <pre v-else class="response-pre whitespace-pre-wrap" tabindex="0" @keydown="selectAllPreContent">{{ displayRawBody }}</pre>
            </div>
          </div>
        </TabPanel>

        <TabPanel>
          <template #header><span>Headers</span></template>
          <div class="p-4 overflow-y-auto">
            <!-- Headers Table -->
            <div class="grid grid-cols-2 gap-x-2 gap-y-0 font-mono">
              <div class="text-base font-bold text-surface-700 dark:text-surface-300 pb-1.5 border-b border-surface-200 dark:border-surface-700">
                KEY
              </div>
              <div class="text-base font-bold text-surface-700 dark:text-surface-300 pb-1.5 border-b border-surface-200 dark:border-surface-700">
                VALUE
              </div>
              <template v-for="(value, key) in response.headers" :key="key">
                <div class="text-base py-1.5 text-surface-700 dark:text-surface-300 border-b border-surface-100 dark:border-surface-800">
                  {{ key }}
                </div>
                <div class="text-base py-1.5 text-surface-600 dark:text-surface-400 border-b border-surface-100 dark:border-surface-800 break-all">
                  {{ value }}
                </div>
              </template>
            </div>
          </div>
        </TabPanel>

        <TabPanel>
          <template #header>
            <span class="inline-flex items-center gap-2" style="line-height: 1;">
              <span>Test Results</span>
              <Badge
                v-if="testResultsSummary && testResultsSummary.hasTests"
                :value="`${testResultsSummary.passed}/${testResultsSummary.total}`"
                :severity="testResultsSummary.failed === 0 ? 'success' : 'danger'"
              />
            </span>
          </template>

          <div class="h-full overflow-y-auto">
            <div class="p-4 pb-20">
              <!-- No Tests -->
              <div v-if="!testResultsSummary || !testResultsSummary.hasTests" class="text-center text-surface-400 dark:text-surface-500 py-8">
                <i class="pi pi-info-circle text-4xl mb-3"></i>
                <p class="text-sm">No tests configured. Go to the Tests tab to add assertions.</p>
              </div>

              <!-- Test Results -->
              <div v-else class="space-y-4">
                <!-- Summary -->
                <div class="flex items-center gap-4 p-3 bg-surface-100 dark:bg-surface-800 rounded">
                  <div class="flex items-center gap-2">
                    <i class="pi pi-check-circle text-green-600 dark:text-green-400"></i>
                    <span class="text-sm font-medium">Passed: {{ testResultsSummary.passed }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <i class="pi pi-times-circle text-red-600 dark:text-red-400"></i>
                    <span class="text-sm font-medium">Failed: {{ testResultsSummary.failed }}</span>
                  </div>
                  <div v-if="testResultsSummary.globalVarsSet > 0" class="flex items-center gap-2">
                    <i class="pi pi-globe text-blue-600 dark:text-blue-400"></i>
                    <span class="text-sm font-medium">Variables Set: {{ testResultsSummary.globalVarsSet }}</span>
                  </div>
                </div>

                <!-- Status Code Tests -->
                <div v-if="(testResults?.statusCode.length ?? 0) > 0">
                  <h4 class="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3 flex items-center gap-2">
                    <i class="pi pi-check-circle"></i>
                    Status Code Assertions
                  </h4>
                  <div class="space-y-2">
                    <div
                      v-for="(result, index) in testResults?.statusCode"
                      :key="index"
                      class="flex items-start gap-3 p-3 rounded border"
                      :class="result.passed
                        ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800'
                        : 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'"
                    >
                      <i
                        :class="result.passed ? 'pi pi-check text-green-600 dark:text-green-400' : 'pi pi-times text-red-600 dark:text-red-400'"
                        class="mt-0.5 shrink-0"
                      ></i>
                      <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium mb-1" :class="result.passed ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'">
                          {{ result.message }}
                        </div>
                        <div v-if="result.description" class="text-xs text-surface-600 dark:text-surface-400">
                          {{ result.description }}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- JSON Field Tests -->
                <div v-if="(testResults?.jsonFields.length ?? 0) > 0">
                  <h4 class="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3 flex items-center gap-2">
                    <i class="pi pi-code"></i>
                    JSON Field Assertions
                  </h4>
                  <div class="space-y-3">
                    <div
                      v-for="(result, index) in testResults?.jsonFields"
                      :key="index"
                      class="p-3 rounded border"
                      :class="result.passed
                        ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800'
                        : 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'"
                    >
                      <div class="flex items-start gap-3">
                        <i
                          :class="result.passed ? 'pi pi-check text-green-600 dark:text-green-400' : 'pi pi-times text-red-600 dark:text-red-400'"
                          class="mt-0.5 shrink-0"
                        ></i>
                        <div class="flex-1 min-w-0">
                          <div class="text-xs font-semibold text-surface-500 dark:text-surface-400 mb-1">
                            JSON Path
                          </div>
                          <div class="font-mono text-sm mb-2 break-all" :class="result.passed ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'">
                            {{ result.jsonPath }}
                          </div>

                          <div class="grid grid-cols-4 gap-3 text-xs">
                            <div>
                              <div class="font-semibold text-surface-500 dark:text-surface-400 mb-1">Actual Value</div>
                              <div class="font-mono p-2 bg-surface-100 dark:bg-surface-900 rounded break-all">
                                {{ result.actualValue !== undefined ? result.actualValue : 'undefined' }}
                              </div>
                            </div>
                            <div>
                              <div class="font-semibold text-surface-500 dark:text-surface-400 mb-1">Operator</div>
                              <div class="font-mono p-2 bg-surface-100 dark:bg-surface-900 rounded text-center">
                                {{ getOperatorLabel(result.operator) }}
                              </div>
                            </div>
                            <div>
                              <div class="font-semibold text-surface-500 dark:text-surface-400 mb-1">Expected Value</div>
                              <div class="font-mono p-2 bg-surface-100 dark:bg-surface-900 rounded break-all">
                                {{ result.expectedValue }}
                              </div>
                            </div>
                            <div v-if="result.description">
                              <div class="font-semibold text-surface-500 dark:text-surface-400 mb-1">Description</div>
                              <div class="p-2 bg-surface-100 dark:bg-surface-900 rounded break-all">
                                {{ result.description }}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Global Variables -->
                <div v-if="(testResults?.globalVars.length ?? 0) > 0">
                  <h4 class="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3 flex items-center gap-2">
                    <i class="pi pi-globe"></i>
                    Global Variables
                  </h4>
                  <div class="border border-surface-200 dark:border-surface-700 rounded overflow-hidden">
                    <table class="w-full text-sm">
                      <thead class="bg-surface-50 dark:bg-surface-800">
                        <tr>
                          <th class="text-left px-4 py-2 font-semibold text-surface-700 dark:text-surface-300 border-b border-surface-200 dark:border-surface-700">
                            Status
                          </th>
                          <th class="text-left px-4 py-2 font-semibold text-surface-700 dark:text-surface-300 border-b border-surface-200 dark:border-surface-700">
                            Variable Name
                          </th>
                          <th class="text-left px-4 py-2 font-semibold text-surface-700 dark:text-surface-300 border-b border-surface-200 dark:border-surface-700">
                            Value
                          </th>
                          <th class="text-left px-4 py-2 font-semibold text-surface-700 dark:text-surface-300 border-b border-surface-200 dark:border-surface-700">
                            Description
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="(result, index) in testResults?.globalVars"
                          :key="index"
                          class="border-b border-surface-200 dark:border-surface-700 last:border-b-0 hover:bg-surface-50 dark:hover:bg-surface-800/50"
                        >
                          <td class="px-4 py-3">
                            <i v-if="isVariableSet(result)" class="pi pi-check text-blue-600 dark:text-blue-400" title="Set"></i>
                            <i v-else-if="result.status === 'skipped'" class="pi pi-minus-circle text-surface-400" title="Skipped"></i>
                            <i v-else class="pi pi-times text-red-600 dark:text-red-400" title="Failed"></i>
                          </td>
                          <td class="px-4 py-3 font-mono font-medium" :class="isVariableSet(result) ? 'text-blue-700 dark:text-blue-300' : 'text-surface-500 dark:text-surface-400'">
                            {{ variableResultName(result) }}
                          </td>
                          <td v-if="isVariableSet(result)" class="px-4 py-3 font-mono text-surface-900 dark:text-surface-100">
                            {{ variableResultValue(result) }}
                          </td>
                          <td v-else class="px-4 py-3 text-xs" :class="result.status === 'skipped' ? 'text-surface-500 dark:text-surface-400' : 'text-red-600 dark:text-red-400'">
                            {{ result.message }}
                          </td>
                          <td class="px-4 py-3 text-surface-600 dark:text-surface-400">
                            {{ result.description || '-' }}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabPanel>
      </TabView>
      </div>
    </div>
    <SaveToMockDialog
      v-if="request && response && showSaveToMock"
      v-model:visible="showSaveToMock"
      :response="response"
      :method="request.method"
      :url="request.url"
      :request-name="request.name"
    />
  </div>
</template>

<style scoped>
:deep(.response-tabs) {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

:deep(.response-tabs .p-tab) {
  padding: 0.35rem 1rem;
  font-size: 13px;
  display: flex;
  align-items: center;
}

:deep(.response-tabs .p-tab .p-badge) {
  font-size: 10px;
  min-width: 1rem;
  height: 1rem;
  line-height: 1rem;
  padding: 0 0.25rem;
}

:deep(.response-tabs .p-tablist::after) {
  display: none !important;
}

:deep(.response-tabs .p-tablist) {
  border-bottom: none !important;
}

:deep(.response-tabs .p-tabview-nav) {
  border-bottom: none !important;
}

:deep(.response-tabs .p-tabview-nav-container) {
  border-bottom: none !important;
}

:deep(.response-tabs .p-tabview-header) {
  border-bottom: none !important;
}

:deep(.response-tabs .p-tabs-nav) {
  border-bottom: none !important;
}

.response-with-status {
  position: relative;
}

.response-status-bar {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  height: 33px;
  padding: 0 0.75rem;
  font-size: 12px;
  line-height: 16px;
}

:deep(.response-tabs .p-tabview-panels) {
  flex: 1;
  overflow-y: auto;
  padding: 0;
  background: transparent;
}

:deep(.response-tabs .p-tabview-panel) {
  padding: 0;
  height: 100%;
}

/* Search toggle button active state */
.search-toggle-active {
  font-weight: 700 !important;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5) !important;
}

:deep(.search-toggle-active.p-button) {
  background: #3b82f6 !important;
  border-color: #3b82f6 !important;
  color: white !important;
}

/* `.p-dark` 是 <html> 上的祖先：须放在 :deep() 外作普通祖先。按钮根带有作用域
   属性，故按钮本身无需 :deep()。原 :deep(.p-dark …) 会编译成 [data-v] .p-dark … 失效。 */
.p-dark .search-toggle-active.p-button {
  background: #297aa0 !important;
  border-color: #297aa0 !important;
  color: #ffffff !important;
}

/* Response Raw 字体大小 */
.response-pre {
  font-size: 14px;
  line-height: 22px;
}
</style>
