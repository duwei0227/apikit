<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue';
import { formatDuration, isThinkingOpen, type StreamEvent, type StreamView } from '@/utils/streamResponse';
import { detectAnswer, formatJsonAnswer } from '@/utils/answerRender';
import AsyncPanelLoader from './AsyncPanelLoader.vue';
import MarkdownView from './MarkdownView.vue';
import HtmlPreview from './HtmlPreview.vue';

const CodeEditor = defineAsyncComponent({
  loader: () => import('./CodeEditor.vue'),
  loadingComponent: AsyncPanelLoader,
  delay: 0,
});

// 流式响应（SSE / 逐行 JSON）的 Body 区域：Text 拼好的回答、Events 逐个事件、Raw 原始文本
const props = withDefaults(defineProps<{
  stream: StreamView;
  /** HTML 预览是否提供手动运行脚本的按钮 */
  allowPreviewScripts?: boolean;
}>(), {
  allowPreviewScripts: false,
});

type StreamViewMode = 'text' | 'events' | 'raw';

const EVENT_PAGE_SIZE = 300;

// 没有手动选过视图时：认得出回答文本就看 Text，否则看 Events
const pickedView = ref<StreamViewMode | null>(null);
const activeView = computed<StreamViewMode>(() => {
  if (pickedView.value) return pickedView.value;
  return props.stream.eventCount > 0 && !props.stream.recognized ? 'events' : 'text';
});

// 自定义格式的结果事件（例如 token 是思考过程，result、fill 是结果），按事件分块显示
const resultBlocks = computed(() => {
  // 依赖 revision：results 数组是原地追加的
  void props.stream.revision;
  return (props.stream.results ?? []).map(result => ({
    ...result,
    json: result.value !== undefined ? JSON.stringify(result.value, null, 2) : '',
  }));
});
const hasResults = computed(() => resultBlocks.value.length > 0);

// 思考内容：接收思考时展开，回答开始输出后折叠；手动点过之后按手动的来
const manualThinking = ref<boolean | null>(null);
// 思考内容仍在输出，例如自定义格式在结果事件之后继续输出的文本
const thinkingLive = computed(() => props.stream.active && Boolean(props.stream.thinkingLatest));
const showThinking = computed(() => isThinkingOpen({
  manual: manualThinking.value,
  hasThinking: Boolean(props.stream.thinking),
  hasText: Boolean(props.stream.text) || hasResults.value,
  active: props.stream.active,
  thinkingLatest: props.stream.thinkingLatest,
}));
// 下方已有结果块时，思考内容限制高度并在框内滚动，结果和最新的思考文本同时可见
const thinkingBox = ref<HTMLElement | null>(null);
const toggleThinking = () => {
  manualThinking.value = !showThinking.value;
};

// 回答的展示方式：按内容识别成 Markdown / JSON / HTML / SVG / XML
const textMode = ref<'rendered' | 'source'>('rendered');
const answer = computed(() => detectAnswer(props.stream.text, props.stream.active));
const answerLabel = computed(() => ({ markdown: 'Markdown', json: 'JSON', html: 'HTML', svg: 'SVG', xml: 'XML' })[answer.value.kind]);
const formattedAnswer = computed(() => (
  answer.value.kind === 'json' ? formatJsonAnswer(answer.value.content) : answer.value.content
));
const followOutput = ref(true);
const scrollContainer = ref<HTMLElement | null>(null);
const expandedEvents = ref(new Set<number>());
const eventLimit = ref(EVENT_PAGE_SIZE);
const showSearch = ref(false);
const searchQuery = ref('');

// 连续发送时组件会复用：新的响应（新的事件数组）不沿用上一次手动展开 / 折叠的状态
watch(() => props.stream.events, () => {
  manualThinking.value = null;
  expandedEvents.value = new Set();
});

const views: Array<{ id: StreamViewMode; label: string }> = [
  { id: 'text', label: 'Text' },
  { id: 'events', label: 'Events' },
  { id: 'raw', label: 'Raw' },
];

const normalizedQuery = computed(() => (showSearch.value ? searchQuery.value.trim().toLowerCase() : ''));
// 搜索在原文上高亮，打开搜索时回答按原文显示
const showRendered = computed(() => (
  textMode.value === 'rendered' && !showSearch.value && (Boolean(props.stream.text) || hasResults.value)
));

const filteredEvents = computed(() => {
  // 依赖 revision：events 数组是原地追加的
  void props.stream.revision;
  const query = normalizedQuery.value;
  if (!query) return props.stream.events;
  return props.stream.events.filter(event => (
    event.event.toLowerCase().includes(query) || event.data.toLowerCase().includes(query)
  ));
});

// 接收过程中显示最新的一页，结束后从头显示
const visibleEvents = computed(() => {
  const events = filteredEvents.value;
  if (events.length <= eventLimit.value) return events;
  return props.stream.active ? events.slice(events.length - eventLimit.value) : events.slice(0, eventLimit.value);
});
const hiddenEventCount = computed(() => filteredEvents.value.length - visibleEvents.value.length);

const toggleEvent = (index: number) => {
  const next = new Set(expandedEvents.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  expandedEvents.value = next;
};

const formatEventData = (event: StreamEvent) => (event.json !== undefined ? JSON.stringify(event.json, null, 2) : event.data);

// 把文本按搜索词切成片段，命中的片段高亮
const splitMatches = (text: string, query: string) => {
  if (!query || !text) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const segments: Array<{ text: string; match: boolean }> = [];
  let position = 0;
  for (;;) {
    const found = lower.indexOf(query, position);
    if (found === -1) break;
    if (found > position) segments.push({ text: text.slice(position, found), match: false });
    segments.push({ text: text.slice(found, found + query.length), match: true });
    position = found + query.length;
  }
  if (position < text.length) segments.push({ text: text.slice(position), match: false });
  return segments;
};

const textSegments = computed(() => splitMatches(props.stream.text, normalizedQuery.value));
const rawSegments = computed(() => splitMatches(props.stream.raw, normalizedQuery.value));
const resultSegments = computed(() => resultBlocks.value.map(result => ({
  text: splitMatches(result.text, normalizedQuery.value),
  json: splitMatches(result.json, normalizedQuery.value),
})));
const matchCount = computed(() => {
  if (!normalizedQuery.value) return 0;
  if (activeView.value === 'events') return filteredEvents.value.length;
  const segments = activeView.value === 'raw'
    ? rawSegments.value
    : hasResults.value
      ? resultSegments.value.flatMap(result => [...result.text, ...result.json])
      : textSegments.value;
  return segments.filter(segment => segment.match).length;
});

const tokenSummary = computed(() => {
  const { inputTokens, outputTokens } = props.stream.usage || {};
  if (inputTokens === undefined && outputTokens === undefined) return '';
  return `${inputTokens ?? '-'} in / ${outputTokens ?? '-'} out`;
});

const onScroll = () => {
  const element = scrollContainer.value;
  if (!element || !props.stream.active) return;
  followOutput.value = element.scrollTop + element.clientHeight >= element.scrollHeight - 24;
};

const scrollToLatest = () => {
  const element = scrollContainer.value;
  if (element) element.scrollTop = element.scrollHeight;
  if (thinkingLive.value && thinkingBox.value) thinkingBox.value.scrollTop = thinkingBox.value.scrollHeight;
};

const toggleFollow = () => {
  followOutput.value = !followOutput.value;
  if (followOutput.value) scrollToLatest();
};

watch(() => [props.stream.revision, activeView.value], () => {
  if (props.stream.active && followOutput.value) nextTick(scrollToLatest);
});

const copyCurrentView = async () => {
  const resultText = () => resultBlocks.value
    .flatMap(result => [result.text, result.json].filter(Boolean))
    .join('\n\n');
  const content = activeView.value === 'text'
    ? (hasResults.value ? resultText() : props.stream.text)
    : activeView.value === 'raw'
      ? props.stream.raw
      : JSON.stringify(props.stream.events.map(event => (event.json !== undefined ? event.json : event.data)), null, 2);
  try {
    await navigator.clipboard.writeText(content);
    window.$toast?.add({ severity: 'success', summary: 'Copied', detail: 'Copied to clipboard', life: 2000 });
  } catch {
    window.$toast?.add({ severity: 'error', summary: 'Error', detail: 'Failed to copy to clipboard', life: 3000 });
  }
};
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- View tabs -->
    <div class="flex items-center justify-between bg-surface-0 dark:bg-surface-950">
      <div class="flex">
        <button
          v-for="view in views"
          :key="view.id"
          @click="pickedView = view.id"
          :class="[
            'px-4 py-2 text-sm font-medium transition',
            activeView === view.id
              ? 'text-primary border-b-2 border-primary'
              : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-50'
          ]"
        >
          {{ view.label }}
        </button>
      </div>

      <div class="flex items-center gap-3 mr-2 text-xs text-surface-500 dark:text-surface-400">
        <template v-if="activeView === 'text' && (stream.text || hasResults)">
          <span v-if="!hasResults" class="px-2 py-0.5 rounded font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30">{{ answerLabel }}</span>
          <span class="stream-mode-switch" :title="showSearch ? 'Search works on the source text' : ''">
            <button :class="{ 'is-active': showRendered }" :disabled="showSearch" @click="textMode = 'rendered'">Rendered</button>
            <button :class="{ 'is-active': !showRendered }" :disabled="showSearch" @click="textMode = 'source'">Source</button>
          </span>
        </template>
        <template v-if="!stream.active">
          <span v-if="stream.finishReason">Finish: {{ stream.finishReason }}</span>
          <span v-if="tokenSummary">Tokens: {{ tokenSummary }}</span>
        </template>
        <button
          v-if="stream.active"
          class="flex items-center gap-1 px-2 py-1 rounded transition hover:bg-surface-100 dark:hover:bg-surface-800"
          :class="{ 'text-primary': followOutput }"
          :title="followOutput ? 'Stop following new output' : 'Follow new output'"
          @click="toggleFollow"
        >
          <i class="pi pi-arrow-down text-xs"></i>
          <span>Follow output</span>
        </button>
        <Button
          icon="pi pi-search"
          size="small"
          text
          :class="{ 'text-primary': showSearch }"
          :title="activeView === 'events' ? 'Filter events' : 'Search'"
          @click="showSearch = !showSearch"
        />
        <Button icon="pi pi-copy" size="small" text :title="`Copy ${activeView}`" @click="copyCurrentView" />
      </div>
    </div>

    <!-- Search -->
    <div
      v-if="showSearch"
      class="flex items-center gap-2 p-2 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900"
    >
      <InputText
        v-model="searchQuery"
        size="small"
        class="flex-1"
        :placeholder="activeView === 'events' ? 'Filter by event or data' : 'Search'"
      />
      <span v-if="normalizedQuery" class="text-xs text-surface-600 dark:text-surface-400 whitespace-nowrap">
        {{ matchCount }} {{ activeView === 'events' ? 'events' : 'matches' }}
      </span>
    </div>

    <div ref="scrollContainer" class="flex-1 min-h-0 overflow-y-auto" @scroll="onScroll">
      <!-- Text -->
      <div v-if="activeView === 'text'" class="p-4 flex flex-col gap-3">
        <div
          v-if="stream.eventCount > 0 && !stream.recognized"
          class="rounded px-3 py-2 text-xs border border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-400"
        >
          No answer text found in this stream. Open Events to see what was received.
        </div>
        <div v-else-if="stream.eventCount === 0" class="text-sm text-surface-400 dark:text-surface-500">
          {{ stream.active ? 'Waiting for the first event…' : 'The stream ended without any events.' }}
        </div>

        <div v-if="stream.thinking" class="rounded border border-surface-200 dark:border-surface-700">
          <button
            class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-900 transition"
            @click="toggleThinking"
          >
            <i :class="['pi text-xs', showThinking ? 'pi-chevron-down' : 'pi-chevron-right']"></i>
            <span class="font-medium">Thinking</span>
            <span>
              {{ stream.thinkingMs !== null && stream.thinkingMs !== undefined ? `· ${formatDuration(stream.thinkingMs)} ` : '' }}· {{ stream.thinking.length }} chars
            </span>
          </button>
          <pre
            v-if="showThinking"
            ref="thinkingBox"
            :class="['stream-text stream-thinking px-3 pb-3 text-surface-600 dark:text-surface-400', { 'stream-thinking-capped': thinkingLive && hasResults }]"
          >{{ stream.thinking }}<span
            v-if="thinkingLive"
            class="stream-cursor"
            aria-hidden="true"
          ></span></pre>
        </div>

        <!-- Result events of a custom format -->
        <template v-if="hasResults">
          <div
            v-for="(result, position) in resultBlocks"
            :key="result.index"
            class="rounded border border-surface-200 dark:border-surface-700"
          >
            <div class="px-3 py-1.5 text-xs font-mono font-medium text-surface-600 dark:text-surface-400 border-b border-surface-200 dark:border-surface-700">
              {{ result.event }}
            </div>
            <div class="p-3 flex flex-col gap-2">
              <template v-if="showRendered">
                <MarkdownView v-if="result.text" :source="result.text" :allow-scripts="allowPreviewScripts" />
                <CodeEditor v-if="result.json" :modelValue="result.json" language="json" :readOnly="true" :autoHeight="true" />
              </template>
              <template v-else>
                <pre v-if="result.text" class="stream-text"><template
                  v-for="(segment, index) in resultSegments[position]?.text"
                  :key="index"
                ><mark v-if="segment.match" class="stream-match">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></pre>
                <pre v-if="result.json" class="stream-raw"><template
                  v-for="(segment, index) in resultSegments[position]?.json"
                  :key="index"
                ><mark v-if="segment.match" class="stream-match">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></pre>
              </template>
            </div>
          </div>
        </template>

        <!-- Rendered answer -->
        <template v-else-if="showRendered">
          <HtmlPreview
            v-if="answer.kind === 'html' || answer.kind === 'svg'"
            :html="answer.content"
            :live="stream.active"
            :allow-scripts="allowPreviewScripts"
          />
          <CodeEditor
            v-else-if="answer.kind === 'json' || answer.kind === 'xml'"
            :modelValue="formattedAnswer"
            :language="answer.kind"
            :readOnly="true"
            :autoHeight="true"
          />
          <MarkdownView v-else :source="stream.text" :allow-scripts="allowPreviewScripts" />
        </template>

        <pre v-else-if="stream.text || stream.active" class="stream-text"><template
          v-for="(segment, index) in textSegments"
          :key="index"
        ><mark v-if="segment.match" class="stream-match">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template><span
          v-if="stream.active && stream.eventCount > 0 && (stream.text || !stream.thinking)"
          class="stream-cursor"
          aria-hidden="true"
        ></span></pre>
      </div>

      <!-- Events -->
      <div v-else-if="activeView === 'events'" class="text-xs">
        <div class="stream-event-row sticky top-0 z-10 bg-surface-50 dark:bg-surface-900 text-surface-500 dark:text-surface-400">
          <span>#</span><span>Time</span><span>Event</span><span>Data</span>
        </div>
        <button
          v-if="hiddenEventCount > 0 && stream.active"
          class="w-full px-4 py-1.5 text-left text-primary hover:bg-surface-50 dark:hover:bg-surface-900"
          @click="eventLimit += EVENT_PAGE_SIZE"
        >
          Show {{ Math.min(hiddenEventCount, EVENT_PAGE_SIZE) }} earlier events ({{ hiddenEventCount }} hidden)
        </button>
        <template v-for="event in visibleEvents" :key="event.index">
          <div
            class="stream-event-row cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-900"
            :class="{ 'bg-surface-100 dark:bg-surface-800': expandedEvents.has(event.index) }"
            @click="toggleEvent(event.index)"
          >
            <span class="text-surface-500 dark:text-surface-400 tabular-nums">{{ event.index }}</span>
            <span class="text-surface-500 dark:text-surface-400 tabular-nums">+{{ formatDuration(event.timeMs) }}</span>
            <span class="font-mono truncate">{{ event.event }}</span>
            <span class="font-mono truncate text-surface-600 dark:text-surface-400">{{ event.data }}</span>
          </div>
          <pre
            v-if="expandedEvents.has(event.index)"
            class="stream-event-detail"
          >{{ formatEventData(event) }}</pre>
        </template>
        <button
          v-if="hiddenEventCount > 0 && !stream.active"
          class="w-full px-4 py-1.5 text-left text-primary hover:bg-surface-50 dark:hover:bg-surface-900"
          @click="eventLimit += EVENT_PAGE_SIZE"
        >
          Show {{ Math.min(hiddenEventCount, EVENT_PAGE_SIZE) }} more events ({{ hiddenEventCount }} hidden)
        </button>
        <div v-if="filteredEvents.length === 0" class="px-4 py-6 text-center text-surface-400 dark:text-surface-500">
          {{ normalizedQuery ? 'No events match the filter.' : (stream.active ? 'Waiting for the first event…' : 'No events received.') }}
        </div>
      </div>

      <!-- Raw -->
      <div v-else class="p-4">
        <pre class="stream-raw"><template
          v-for="(segment, index) in rawSegments"
          :key="index"
        ><mark v-if="segment.match" class="stream-match">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stream-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 0.875rem;
  line-height: 1.7;
}

.stream-thinking {
  font-size: 0.8125rem;
  line-height: 1.6;
}

.stream-thinking-capped {
  max-height: 40vh;
  overflow-y: auto;
}

.stream-mode-switch {
  display: inline-flex;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  overflow: hidden;
}

.stream-mode-switch button {
  padding: 0.1rem 0.55rem;
  cursor: pointer;
}

.stream-mode-switch button:disabled {
  cursor: default;
}

.stream-mode-switch button.is-active {
  background: var(--p-content-hover-background);
  color: var(--p-text-color);
  font-weight: 500;
}

.stream-raw {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 0.75rem;
  line-height: 1.6;
}

.stream-cursor {
  display: inline-block;
  width: 7px;
  height: 1em;
  margin-left: 2px;
  vertical-align: -2px;
  background: var(--p-primary-color);
  animation: stream-cursor-blink 1s steps(2, start) infinite;
}

@keyframes stream-cursor-blink {
  to { visibility: hidden; }
}

.stream-match {
  background: #fde68a;
  color: #1f2937;
}

.stream-event-row {
  display: grid;
  grid-template-columns: 3rem 5rem 12rem minmax(0, 1fr);
  gap: 0.5rem;
  align-items: center;
  padding: 0.3rem 1rem;
  border-bottom: 1px solid var(--p-content-border-color);
}

.stream-event-detail {
  margin: 0;
  padding: 0.5rem 1rem 0.75rem 9rem;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.75rem;
  line-height: 1.6;
  border-bottom: 1px solid var(--p-content-border-color);
  background: var(--p-content-hover-background);
}
</style>
