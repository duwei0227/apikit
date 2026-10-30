<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
// Ace 用隐藏的 <textarea> 接收输入，输入法组字由浏览器原生处理。Windows 上 WebView2 的
// contenteditable 与输入法配合有问题（首字丢失、中文标点要按两次），所以这里不用
// 基于 contenteditable 的编辑器。
import { ace, applyBaseOptions, setReadOnly, createTemplateMode, isDarkMode, themeFor, type AceEditor, type SearchMatch } from '@/editor/ace';
import {
  PARAMETER_HINTS as parameterHints,
  buildVariableCompletions,
  completionCursorOffset,
  completionInsertText,
  findOpenTemplate,
  findParameterHint,
  findTemplateVariableAt,
  type VariableCompletion,
} from '@/utils/templateVariables';
import { placePopup, popupStyle, type PopupAnchor, type PopupPosition } from '@/utils/popupPosition';

const props = withDefaults(defineProps<{
  modelValue?: string;
  placeholder?: string;
  readOnly?: boolean;
  language?: 'json' | 'xml' | 'text';
  /** 可用变量：名称 → 当前值 */
  availableVariables?: Record<string, string>;
  searchMatches?: SearchMatch[];
  currentMatchIndex?: number;
}>(), {
  modelValue: '',
  placeholder: '',
  readOnly: false,
  language: 'json',
  availableVariables: () => ({}),
  searchMatches: () => [],
  currentMatchIndex: -1
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'ctrl-f': [selectedText: string];
}>();

const Range = ace.require('ace/range').Range;

// 拦截 Ctrl+F（capture 阶段，在编辑器处理之前触发），交给 ApiKit 自己的搜索框
const onContainerKeydown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
    event.preventDefault();
    event.stopPropagation();
    emit('ctrl-f', getSelectedText());
  }
};

// 获取编辑器当前选中的文本（用于 Ctrl+F 时默认填充搜索框）
const getSelectedText = () => (editor ? editor.getSelectedText() : '');

const editorContainer = ref<HTMLElement | null>(null);
const parameterHintPanel = ref<HTMLElement | null>(null);
let editor: AceEditor | null = null;
let applyingExternal = false; // 程序设置内容时不回传
let composing = false; // 输入法组字中
let themeObserver: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;

const showParameterHint = ref(false);
const parameterHintContent = ref('');
const hintPosition = ref<PopupPosition>({ top: 0, left: 0 });

const isKnownVariable = (name: string) => name in props.availableVariables;
const createMode = () => createTemplateMode(props.language === 'xml' || props.language === 'text' ? props.language : 'json', isKnownVariable);

// 某个位置所在行的窗口坐标，作为浮层的锚点
const lineAnchor = (editor: AceEditor, row: number, column: number): PopupAnchor => {
  const coords = editor.renderer.textToScreenCoordinates(row, column);
  return { top: coords.pageY, bottom: coords.pageY + editor.renderer.lineHeight, left: coords.pageX };
};

// 浮层挂在 body 上（position: fixed），渲染后按实际尺寸放到锚点下方或上方，不超出窗口。
// 测量前要先去掉上次的高度限制（maxHeight 为空），否则量到的是被限制后的高度
const placeOverPage = (el: HTMLElement | null, anchor: PopupAnchor): PopupPosition => {
  const rect = el?.getBoundingClientRect();
  if (!rect) return { top: anchor.bottom + 4, left: anchor.left };
  const { top, left, maxHeight } = placePopup(anchor, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight });
  return { top, left, maxHeight };
};

// ── 函数参数提示（{{$sequence( 等） ─────────────────────────────────────────
const updateParameterHint = () => {
  if (!editor) return;
  const cursor = editor.getCursorPosition();
  const cursorIndex = editor.session.getDocument().positionToIndex(cursor, 0);
  const funcName = findParameterHint(editor.getValue(), cursorIndex);
  if (funcName) {
    const anchor = lineAnchor(editor, cursor.row, cursor.column);
    parameterHintContent.value = funcName;
    hintPosition.value = showParameterHint.value
      ? { top: hintPosition.value.top, left: hintPosition.value.left }
      : { top: anchor.bottom + 4, left: anchor.left };
    showParameterHint.value = true;
    nextTick(() => {
      hintPosition.value = placeOverPage(parameterHintPanel.value, anchor);
    });
  } else {
    showParameterHint.value = false;
  }
};

// ── 变量自动完成 ─────────────────────────────────────────────────────────────
// 只在 {{ 之后、用户输入时打开；输入法组字期间不打开，组字结束后再判断。
interface CompletionState extends PopupPosition {
  visible: boolean;
  items: VariableCompletion[];
  index: number;
}
const completion = ref<CompletionState>({ visible: false, items: [], index: 0, top: 0, left: 0 });
let completionStart: { row: number; column: number } | null = null; // {{ 的位置
const completionList = ref<HTMLElement | null>(null);

const hideCompletion = () => {
  if (completion.value.visible) completion.value = { ...completion.value, visible: false };
  completionStart = null;
};

const updateCompletion = () => {
  if (!editor || props.readOnly || composing || !editor.selection.isEmpty()) {
    hideCompletion();
    return;
  }
  const cursor = editor.getCursorPosition();
  const line = editor.session.getLine(cursor.row);
  const open = findOpenTemplate(line.slice(0, cursor.column));
  const items = open ? buildVariableCompletions(props.availableVariables, open.prefix) : [];
  if (!open || items.length === 0) {
    hideCompletion();
    return;
  }
  completionStart = { row: cursor.row, column: open.openIndex };
  const anchor = lineAnchor(editor, cursor.row, open.openIndex);
  const wasVisible = completion.value.visible;
  const keepIndex = wasVisible ? Math.min(completion.value.index, items.length - 1) : 0;
  completion.value = {
    visible: true,
    items,
    index: keepIndex,
    top: wasVisible ? completion.value.top : anchor.bottom + 4,
    left: wasVisible ? completion.value.left : anchor.left
  };
  nextTick(() => {
    if (!completion.value.visible) return;
    completion.value = { ...completion.value, ...placeOverPage(completionList.value, anchor) };
  });
};

const acceptCompletion = (item: VariableCompletion | undefined) => {
  if (!editor || !completionStart || !item) return;
  const cursor = editor.getCursorPosition();
  const after = editor.session.getLine(cursor.row).slice(cursor.column);
  const text = completionInsertText(item.name, after);
  const start = completionStart;
  editor.session.replace(new Range(start.row, start.column, cursor.row, cursor.column), text);
  editor.moveCursorTo(start.row, start.column + completionCursorOffset(item.name));
  hideCompletion();
  editor.focus();
};

const moveCompletion = (delta: number) => {
  const count = completion.value.items.length;
  const index = (completion.value.index + delta + count) % count;
  completion.value = { ...completion.value, index };
  nextTick(() => completionList.value?.children[index]?.scrollIntoView({ block: 'nearest' }));
};

// 补全列表打开时接管上下键、回车、Tab 和 Esc；只有参数提示时 Esc 关闭提示。
// 由 Ace 处理的按键不再冒泡，Esc 不会同时关闭所在的对话框。
const completionKeyHandler = {
  handleKeyboard(_data: unknown, hashId: number, keyString: string) {
    if (hashId === 0 && keyString === 'esc' && !completion.value.visible && showParameterHint.value) {
      showParameterHint.value = false;
      return { command: 'null' };
    }
    if (!completion.value.visible || hashId === -1) return undefined;
    if (hashId !== 0) return undefined;
    switch (keyString) {
      case 'down': moveCompletion(1); break;
      case 'up': moveCompletion(-1); break;
      case 'return':
      case 'tab': acceptCompletion(completion.value.items[completion.value.index]); break;
      case 'esc': hideCompletion(); break;
      default: return undefined;
    }
    return { command: 'null' };
  }
};

// ── 搜索高亮 ─────────────────────────────────────────────────────────────────
let searchMarkerIds: number[] = [];
const updateSearchHighlights = () => {
  if (!editor) return;
  const session = editor.session;
  searchMarkerIds.forEach(id => session.removeMarker(id));
  searchMarkerIds = [];

  const doc = session.getDocument();
  const rangeOf = (match: SearchMatch) => {
    const from = doc.indexToPosition(match.index, 0);
    const to = doc.indexToPosition(match.index + match.length, 0);
    return new Range(from.row, from.column, to.row, to.column);
  };
  props.searchMatches.forEach((match, idx) => {
    const cls = idx === props.currentMatchIndex ? 'ak-search-match-current' : 'ak-search-match';
    searchMarkerIds.push(session.addMarker(rangeOf(match), cls, 'text', false));
  });
  const current = props.searchMatches[props.currentMatchIndex];
  if (props.currentMatchIndex >= 0 && current) {
    const range = rangeOf(current);
    editor.selection.setSelectionRange(range);
    editor.renderer.scrollSelectionIntoView(range.start, range.end, 0.5);
  }
};

// ── 变量悬浮提示 ─────────────────────────────────────────────────────────────
let hoverTipEl: HTMLDivElement | null = null;
let hoverRaf: number | null = null;
const hideHoverTip = () => {
  if (hoverTipEl) {
    hoverTipEl.remove();
    hoverTipEl = null;
  }
};
const onEditorMouseMove = (e: MouseEvent) => {
  if (hoverRaf) cancelAnimationFrame(hoverRaf);
  hoverRaf = requestAnimationFrame(() => {
    if (!editor) return;
    const pos = editor.renderer.screenToTextCoordinates(e.clientX, e.clientY);
    const line = editor.session.getLine(pos.row);
    const found = line == null ? null : findTemplateVariableAt(line, pos.column);
    const value = found ? props.availableVariables[found.base] : undefined;
    if (!found || value === undefined) { hideHoverTip(); return; }

    if (!hoverTipEl) {
      hoverTipEl = document.createElement('div');
      hoverTipEl.className = 'ak-var-hover-tip';
      document.body.appendChild(hoverTipEl);
    }
    hoverTipEl.innerHTML =
      `<span class="cm-var-tip-name"></span><span class="cm-var-tip-sep"> = </span><span class="cm-var-tip-value"></span>`;
    hoverTipEl.querySelector('.cm-var-tip-name')!.textContent = found.base;
    hoverTipEl.querySelector('.cm-var-tip-value')!.textContent = value;
    hoverTipEl.style.left = e.clientX + 'px';
    hoverTipEl.style.top = (e.clientY - 8) + 'px';
  });
};

const onCompositionStart = () => {
  composing = true;
  hideCompletion();
};
const onCompositionEnd = () => {
  composing = false;
  // 组字结果写入文档之后再判断是否打开补全
  setTimeout(updateCompletion, 0);
};

onMounted(() => {
  const container = editorContainer.value!;
  const instance = ace.edit(container, {
    value: props.modelValue || '',
    placeholder: props.placeholder,
    theme: themeFor(isDarkMode())
  });
  applyBaseOptions(instance);
  setReadOnly(instance, props.readOnly);
  instance.session.setMode(createMode());
  instance.session.getUndoManager().reset();
  instance.clearSelection();
  instance.moveCursorTo(0, 0);
  instance.keyBinding.addKeyboardHandler(completionKeyHandler);
  editor = instance;

  // v-model：用户编辑 → emit（程序设置内容不回传）
  instance.session.on('change', (delta) => {
    if (applyingExternal) return;
    emit('update:modelValue', instance.getValue());
    // 输入后判断是否打开补全
    if (delta.action === 'insert' && !composing) setTimeout(updateCompletion, 0);
  });
  instance.selection.on('changeCursor', () => {
    updateParameterHint();
    if (completion.value.visible) updateCompletion();
  });
  // 浮层挂在 body 上，不随页签隐藏：编辑器失焦时收起
  instance.on('blur', () => {
    showParameterHint.value = false;
    setTimeout(hideCompletion, 150);
  });

  const textarea = instance.textInput.getElement();
  textarea.addEventListener('compositionstart', onCompositionStart);
  textarea.addEventListener('compositionend', onCompositionEnd);

  instance.container.addEventListener('mousemove', onEditorMouseMove);
  instance.container.addEventListener('mouseleave', hideHoverTip);
  // 滚动时浮层跟随光标重新定位（在底部输入时编辑器会自动滚动，不能直接收起）
  instance.session.on('changeScrollTop', () => {
    hideHoverTip();
    if (completion.value.visible) updateCompletion();
    if (showParameterHint.value) updateParameterHint();
  });

  // 明暗模式切换
  themeObserver = new MutationObserver(() => instance.setTheme(themeFor(isDarkMode())));
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  // JsonEditor 常挂在未激活的页签里（display:none），显示后重新布局
  resizeObserver = new ResizeObserver(() => instance.resize());
  resizeObserver.observe(container);

  updateSearchHighlights();
});

onBeforeUnmount(() => {
  themeObserver?.disconnect();
  resizeObserver?.disconnect();
  hideHoverTip();
  if (editor) {
    const textarea = editor.textInput.getElement();
    textarea.removeEventListener('compositionstart', onCompositionStart);
    textarea.removeEventListener('compositionend', onCompositionEnd);
    editor.destroy();
    editor = null;
  }
});

// readOnly 变化
watch(() => props.readOnly, (val) => { if (editor) setReadOnly(editor, val); });

watch(() => props.language, () => {
  if (editor) editor.session.setMode(createMode());
});

// 搜索匹配变化：更新高亮
watch(() => [props.searchMatches, props.currentMatchIndex], updateSearchHighlights, { deep: true });

// 可用变量变化：重新着色（自动完成/悬浮在使用时读取最新值）
watch(() => props.availableVariables, () => {
  if (!editor) return;
  editor.session.bgTokenizer.start(0);
  editor.renderer.updateFull();
}, { deep: true });

// 外部值变化：同步进编辑器。用文档替换而不是 session.setValue：后者会清空撤销历史，
// Beautify 等外部就地修改后就无法撤回。保留光标位置，且不回传。
watch(() => props.modelValue, (newVal) => {
  const val = newVal ?? '';
  if (editor && val !== editor.getValue()) {
    applyingExternal = true;
    const cursor = editor.getCursorPosition();
    editor.session.getDocument().setValue(val);
    editor.clearSelection();
    editor.moveCursorToPosition(cursor);
    applyingExternal = false;
  }
});

// 暴露给父组件（RequestBodyEditor）：当焦点在工具栏按钮等编辑器之外时，
// 由父级的 keydown 捕获后转发到这里执行撤回/恢复，并把焦点带回编辑器。
const undo = () => {
  if (editor && !props.readOnly) {
    editor.undo();
    editor.focus();
  }
};
const redo = () => {
  if (editor && !props.readOnly) {
    editor.redo();
    editor.focus();
  }
};
const focus = () => { if (editor) editor.focus(); };
// 把光标移到指定位置（行列号从 1 开始）并滚动到可见，用于定位请求体的语法错误
const revealPosition = (line: number, column: number) => {
  if (!editor) return;
  editor.gotoLine(line, column - 1, false);
  editor.scrollToLine(line - 1, true, false, () => {});
  editor.focus();
};

defineExpose({ undo, redo, focus, revealPosition });
</script>

<template>
  <div class="json-editor-wrapper relative">
    <div
      ref="editorContainer"
      class="json-editor-container border border-surface-300 dark:border-surface-700 rounded"
      @keydown.capture="onContainerKeydown"
    ></div>

    <!-- Parameter Hint Panel（挂到 body，避免被编辑区域裁剪） -->
    <Teleport to="body">
    <div
      v-if="showParameterHint && parameterHints[parameterHintContent]"
      ref="parameterHintPanel"
      class="ak-param-hint fixed bg-surface-0 dark:bg-surface-900 border border-primary-300 dark:border-primary-700 rounded shadow-lg p-4 min-w-96 max-w-2xl max-h-(--ak-popup-max-height) overflow-y-auto"
      :style="popupStyle(hintPosition)"
    >
      <div class="flex flex-col gap-3">
        <!-- Title -->
        <div class="flex items-center gap-2 border-b border-surface-200 dark:border-surface-700 pb-2">
          <i class="pi pi-info-circle text-primary"></i>
          <span class="font-semibold text-surface-900 dark:text-surface-50">
            {{ parameterHints[parameterHintContent].title }}
          </span>
        </div>

        <!-- Description -->
        <div v-if="parameterHints[parameterHintContent].description" class="text-sm text-surface-600 dark:text-surface-400">
          {{ parameterHints[parameterHintContent].description }}
        </div>

        <!-- Parameters Table -->
        <div v-if="parameterHints[parameterHintContent].params" class="text-xs">
          <div class="font-semibold text-surface-700 dark:text-surface-300 mb-2">Parameters:</div>
          <table class="w-full">
            <thead>
              <tr class="border-b border-surface-200 dark:border-surface-700">
                <th class="text-left py-1 px-2 text-surface-600 dark:text-surface-400">Name</th>
                <th class="text-left py-1 px-2 text-surface-600 dark:text-surface-400">Type</th>
                <th class="text-left py-1 px-2 text-surface-600 dark:text-surface-400">Default</th>
                <th class="text-left py-1 px-2 text-surface-600 dark:text-surface-400">Description</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="param in parameterHints[parameterHintContent].params"
                :key="param.name"
                class="border-b border-surface-100 dark:border-surface-800"
              >
                <td class="py-1 px-2 font-mono text-primary">{{ param.name }}</td>
                <td class="py-1 px-2 text-surface-500 dark:text-surface-400">{{ param.type }}</td>
                <td class="py-1 px-2 font-mono text-surface-500 dark:text-surface-400">{{ param.default }}</td>
                <td class="py-1 px-2 text-surface-600 dark:text-surface-400">{{ param.desc }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Examples -->
        <div v-if="parameterHints[parameterHintContent].examples" class="text-xs">
          <div class="font-semibold text-surface-700 dark:text-surface-300 mb-2">Examples:</div>
          <div class="space-y-1">
            <div
              v-for="(example, idx) in parameterHints[parameterHintContent].examples"
              :key="idx"
              class="flex items-start gap-2 p-2 bg-surface-50 dark:bg-surface-800 rounded"
            >
              <code class="text-primary font-mono shrink-0">{{ example.syntax }}</code>
              <span class="text-surface-500 dark:text-surface-400">- {{ example.desc }}</span>
            </div>
          </div>
        </div>

        <div class="text-xs text-surface-500 dark:text-surface-400 italic pt-2 border-t border-surface-200 dark:border-surface-700">
          Press Esc to close this hint
        </div>
      </div>
    </div>
    </Teleport>

    <!-- 变量自动完成列表（挂到 body，避免被编辑区域裁剪） -->
    <Teleport to="body">
      <ul
        v-if="completion.visible"
        ref="completionList"
        class="ak-hints"
        :style="popupStyle(completion)"
      >
        <li
          v-for="(item, idx) in completion.items"
          :key="item.name"
          class="ak-hint"
          :class="{ 'ak-hint-active': idx === completion.index }"
          @mousedown.prevent="acceptCompletion(item)"
          @mouseenter="completion.index = idx"
        >
          <div class="ak-hint-label">{{ item.name }}</div>
          <div class="ak-hint-detail">{{ item.detail }}</div>
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.json-editor-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.json-editor-container {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  line-height: 22px;
}
</style>

<!--
  The autocomplete list and the hover tooltip are rendered OUTSIDE this component's
  scoped DOM (both are appended to document.body), so these rules must be global.
-->
<style>
/* ── Autocomplete dropdown ──────────────────────────────────────────────── */
.ak-param-hint {
  z-index: var(--ak-floating-z, 2000);
}

.ak-hints {
  z-index: var(--ak-floating-z, 2000);
  position: fixed;
  list-style: none;
  margin: 0;
  padding: 0;
  background-color: var(--p-surface-0, #fff);
  border: 1px solid var(--p-surface-300, #cbd5e1);
  border-radius: 6px;
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  min-width: 320px;
  max-height: min(20em, var(--ak-popup-max-height, 20em));
  overflow-y: auto;
  font-family: 'JetBrains Mono Variable', 'JetBrains Mono', Consolas, 'Courier New', monospace;
}

.p-dark .ak-hints {
  background-color: var(--p-surface-800, #202122);
  border-color: var(--p-surface-700, #334155);
}

.ak-hint {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 8px 12px;
  gap: 3px;
  cursor: pointer;
  color: inherit;
  white-space: normal;
}

.ak-hint-active {
  background-color: var(--ac-selected-bg, #2563eb) !important;
}

.ak-hint-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--p-primary-color, #3b82f6);
}

.ak-hint-active .ak-hint-label {
  color: var(--ac-selected-label-color, #ffffff) !important;
}

.ak-hint-detail {
  font-size: 12px;
  color: var(--p-text-muted-color, #64748b);
  white-space: normal;
  word-break: break-word;
  max-width: 480px;
  line-height: 1.4;
}

.ak-hint-active .ak-hint-detail {
  color: var(--ac-selected-detail-color, #dbeafe) !important;
}

/* ── Variable hover tooltip (custom, body-level) ────────────────────────── */
.ak-var-hover-tip {
  position: fixed;
  transform: translateY(-100%);
  z-index: var(--ak-floating-z, 2000);
  background: var(--p-surface-0, #fff);
  border: 1px solid var(--p-surface-300, #cbd5e1);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.12);
  pointer-events: none;
  white-space: nowrap;
}

.p-dark .ak-var-hover-tip {
  background: var(--p-surface-800, #202122);
  border-color: var(--p-surface-700, #334155);
}

.cm-var-tip-name {
  color: #d97706;
  font-weight: 600;
}

.cm-var-tip-sep {
  color: var(--p-text-muted-color, #64748b);
}

.cm-var-tip-value {
  color: var(--p-text-color, #1e293b);
  font-style: italic;
}

.p-dark .cm-var-tip-value {
  color: var(--p-surface-100, #f1f5f9);
}
</style>
