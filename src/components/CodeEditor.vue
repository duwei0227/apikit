<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { ace, applyBaseOptions, setReadOnly, createViewerMode, isDarkMode, themeFor, type AceEditor, type SearchMatch } from '@/editor/ace';

const props = withDefaults(defineProps<{
  modelValue?: string;
  language?: 'json' | 'xml' | 'html' | 'urlencoded' | 'text';
  readOnly?: boolean;
  autoHeight?: boolean;
  searchMatches?: SearchMatch[];
  currentMatchIndex?: number;
}>(), {
  modelValue: '',
  language: 'json',
  readOnly: false,
  autoHeight: false,
  searchMatches: () => [],
  currentMatchIndex: -1
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'ctrl-f': [selectedText: string];
}>();

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
let editor: AceEditor | null = null;
let applyingExternal = false; // 程序设置内容时不回传
let themeObserver: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;

// ── 搜索高亮 ─────────────────────────────────────────────────────────────────
const Range = ace.require('ace/range').Range;
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

  // 选中并滚动到当前匹配项
  const current = props.searchMatches[props.currentMatchIndex];
  if (props.currentMatchIndex >= 0 && current) {
    const range = rangeOf(current);
    editor.selection.setSelectionRange(range);
    editor.renderer.scrollSelectionIntoView(range.start, range.end, 0.5);
    if (props.autoHeight) editor.container.scrollIntoView({ block: 'nearest' });
  }
};

const setLanguage = () => {
  if (editor) editor.session.setMode(createViewerMode(props.language));
};

onMounted(() => {
  const container = editorContainer.value!;
  const instance = ace.edit(container, {
    value: props.modelValue || '',
    theme: themeFor(isDarkMode()),
    // 自适应高度：编辑器随内容变高，滚动交给外层
    ...(props.autoHeight ? { maxLines: Infinity, minLines: 1 } : {})
  });
  editor = instance;
  applyBaseOptions(instance);
  setReadOnly(instance, props.readOnly);
  setLanguage();
  instance.clearSelection();

  instance.session.on('change', () => {
    if (applyingExternal || props.readOnly) return;
    emit('update:modelValue', instance.getValue());
  });

  // 明暗模式切换
  themeObserver = new MutationObserver(() => instance.setTheme(themeFor(isDarkMode())));
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  // 挂在隐藏页签中时以 0 尺寸渲染，显示后重新布局
  resizeObserver = new ResizeObserver(() => instance.resize());
  resizeObserver.observe(container);

  updateSearchHighlights();
});

onBeforeUnmount(() => {
  themeObserver?.disconnect();
  resizeObserver?.disconnect();
  editor?.destroy();
  editor = null;
});

// 外部内容变化：整体替换，不进入撤销历史
watch(() => props.modelValue, (newVal) => {
  const val = newVal ?? '';
  if (editor && val !== editor.getValue()) {
    applyingExternal = true;
    editor.session.setValue(val);
    applyingExternal = false;
    updateSearchHighlights();
  }
});

watch(() => props.language, () => {
  setLanguage();
  updateSearchHighlights();
});

watch(() => props.readOnly, (val) => { if (editor) setReadOnly(editor, val); });

watch(() => [props.searchMatches, props.currentMatchIndex], updateSearchHighlights, { deep: true });
</script>

<template>
  <div
    class="code-editor-container border border-surface-300 dark:border-surface-700 rounded"
    :class="{ 'code-editor-container-auto-height': autoHeight }"
    @keydown.capture="onContainerKeydown"
  >
    <div ref="editorContainer" class="code-editor-ace"></div>
  </div>
</template>

<style scoped>
.code-editor-container {
  min-height: 300px;
  overflow: hidden;
  /* 用 flex 让编辑器撑满容器：容器自身没有显式高度时 height: 100% 不生效 */
  display: flex;
  flex-direction: column;
}

.code-editor-ace {
  flex: 1;
  min-height: 0;
  line-height: 22px;
}

.code-editor-container-auto-height {
  min-height: 0;
  display: block;
}

.code-editor-container-auto-height .code-editor-ace {
  flex: none;
}

/* 浅色查看器沿用原来的 GitHub Light 配色：属性名蓝色、标签名深绿、null 红色 */
:deep(.ace-apikit-light .ace_entity.ace_other.ace_attribute-name:not(.ace_decl-attribute-name)) { color: #005cc5; }
:deep(.ace-apikit-light .ace_meta.ace_tag.ace_tag-name) { color: #116329; }
:deep(.ace-apikit-light .ace_constant.ace_language.ace_null) { color: #d73a49; }
</style>
