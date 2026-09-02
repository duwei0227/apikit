<script setup>
import { ref, onMounted, watch } from 'vue';
import { EditorView, basicSetup } from 'codemirror';
import { Decoration } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { html } from '@codemirror/lang-html';
import { StreamLanguage } from '@codemirror/language';
import { dracula } from '@uiw/codemirror-theme-dracula';
import { githubLight } from '@uiw/codemirror-theme-github';
import { EditorState, StateEffect, StateField, Compartment, Transaction } from '@codemirror/state';

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  language: {
    type: String,
    default: 'json', // json, xml, html, text
    validator: (value) => ['json', 'xml', 'html', 'urlencoded', 'text'].includes(value)
  },
  readOnly: {
    type: Boolean,
    default: false
  },
  autoHeight: {
    type: Boolean,
    default: false
  },
  searchMatches: {
    type: Array,
    default: () => []
  },
  currentMatchIndex: {
    type: Number,
    default: -1
  }
});

const emit = defineEmits(['update:modelValue', 'ctrl-f']);

const onContainerKeydown = (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
    event.preventDefault();
    event.stopPropagation();
    emit('ctrl-f', getSelectedText());
  }
};

// 获取编辑器当前选中的文本（用于 Ctrl+F 时默认填充搜索框）
const getSelectedText = () => {
  if (!editorView) return '';
  const sel = editorView.state.selection.main;
  if (sel.empty) return '';
  return editorView.state.sliceDoc(sel.from, sel.to);
};

// Compartments allow reconfiguring extensions without destroying the EditorView,
// preserving the undo/redo history stack.
const themeCompartment = new Compartment();
const langCompartment = new Compartment();

const editorContainer = ref(null);
let editorView = null;

const isDark = ref(false);

const urlEncodedLanguage = StreamLanguage.define({
  startState: () => ({ expectingKey: true }),
  token(stream, state) {
    if (stream.eat('&')) {
      state.expectingKey = true;
      return 'separator';
    }

    if (state.expectingKey) {
      if (stream.eat('=')) {
        state.expectingKey = false;
        return 'operator';
      }
      stream.eatWhile(/[^=&]/);
      state.expectingKey = false;
      return 'propertyName';
    }

    if (stream.eat('=')) return 'operator';

    stream.eatWhile(/[^&]/);
    return 'string';
  }
});

const checkTheme = () => {
  isDark.value = document.documentElement.classList.contains('p-dark');
};

const getLanguageExtension = () => {
  switch (props.language) {
    case 'json':
      return json();
    case 'xml':
      return xml();
    case 'html':
      return html();
    case 'urlencoded':
      return urlEncodedLanguage;
    default:
      return [];
  }
};

// 搜索高亮相关
const setSearchHighlights = StateEffect.define();

const searchHighlightField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(highlights, tr) {
    for (let effect of tr.effects) {
      if (effect.is(setSearchHighlights)) {
        return effect.value;
      }
    }
    return highlights;
  },
  provide: f => EditorView.decorations.from(f)
});

const highlightTheme = EditorView.baseTheme({
  '.cm-searchMatch': {
    backgroundColor: '#fef08a !important',
    color: '#000 !important'
  },
  '.cm-searchMatch-current': {
    backgroundColor: '#fb923c !important',
    color: '#fff !important',
    fontWeight: 'bold !important'
  },
  '.p-dark .cm-searchMatch': {
    backgroundColor: '#a16207 !important',
    color: '#fff !important'
  },
  '.p-dark .cm-searchMatch-current': {
    backgroundColor: '#ea580c !important',
    color: '#fff !important',
    fontWeight: 'bold !important'
  }
});

const updateSearchHighlights = () => {
  if (!editorView) return;
  
  const decorations = [];
  
  props.searchMatches.forEach((match, idx) => {
    const isCurrent = idx === props.currentMatchIndex;
    const deco = Decoration.mark({
      class: isCurrent ? 'cm-searchMatch-current' : 'cm-searchMatch'
    }).range(match.index, match.index + match.length);
    decorations.push(deco);
  });
  
  const decorationSet = Decoration.set(decorations.sort((a, b) => a.from - b.from));
  
  editorView.dispatch({
    effects: setSearchHighlights.of(decorationSet)
  });
  
  // 滚动到当前匹配项
  if (props.currentMatchIndex >= 0 && props.searchMatches[props.currentMatchIndex]) {
    const match = props.searchMatches[props.currentMatchIndex];
    editorView.dispatch({
      selection: { anchor: match.index, head: match.index + match.length },
      scrollIntoView: true
    });
  }
};

const fontTheme = EditorView.theme({
  '&': {
    fontSize: '14px',
    fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', Consolas, 'Courier New', monospace"
  },
  '.cm-content': { lineHeight: '22px', padding: '8px 0' },
  '.cm-line': { lineHeight: '22px', padding: '0 8px' },
  '&.cm-focused': { outline: 'none' }
});

onMounted(() => {
  checkTheme();

  const observer = new MutationObserver(checkTheme);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  });

  const extensions = [
    basicSetup,
    langCompartment.of(getLanguageExtension()),
    EditorState.readOnly.of(props.readOnly),
    searchHighlightField,
    highlightTheme,
    themeCompartment.of(isDark.value ? dracula : githubLight),
    fontTheme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !props.readOnly) {
        emit('update:modelValue', update.state.doc.toString());
      }
    })
  ];

  editorView = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions
    }),
    parent: editorContainer.value
  });

  // 主题变化：只更新 themeCompartment，保留 undo history
  watch(isDark, (newVal) => {
    if (editorView) {
      editorView.dispatch({
        effects: themeCompartment.reconfigure(newVal ? dracula : githubLight)
      });
      updateSearchHighlights();
    }
  });

  // 监听搜索匹配变化
  watch(() => [props.searchMatches, props.currentMatchIndex], () => {
    updateSearchHighlights();
  }, { deep: true });
});

watch(() => props.modelValue, (newVal) => {
  if (editorView && newVal !== editorView.state.doc.toString()) {
    // External/programmatic update — must not pollute the undo stack.
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: newVal
      },
      annotations: Transaction.addToHistory.of(false)
    });
  }
});

// 语言变化：只更新 langCompartment，保留 undo history
watch(() => props.language, () => {
  if (editorView) {
    editorView.dispatch({
      effects: langCompartment.reconfigure(getLanguageExtension())
    });
    updateSearchHighlights();
  }
});
</script>

<template>
  <div
    ref="editorContainer"
    class="code-editor-container border border-surface-300 dark:border-surface-700 rounded"
    :class="{ 'code-editor-container-auto-height': autoHeight }"
    @keydown.capture="onContainerKeydown"
  ></div>
</template>

<style scoped>
.code-editor-container {
  min-height: 300px;
  overflow: auto;
}

:deep(.cm-editor) {
  height: 100%;
}

:deep(.cm-scroller) {
  overflow: auto;
}

.code-editor-container-auto-height {
  min-height: 0;
  overflow: visible;
}

.code-editor-container-auto-height :deep(.cm-editor) {
  height: auto;
}

.code-editor-container-auto-height :deep(.cm-scroller) {
  overflow-x: auto;
}
</style>
