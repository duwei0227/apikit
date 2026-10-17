<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { placePopup } from '@/utils/popupPosition';
import { BUILT_IN_VARIABLE_SYNTAX, PARAMETER_HINTS as parameterHints, completionCursorOffset } from '@/utils/templateVariables';

const props = withDefaults(defineProps<{
  modelValue?: string;
  placeholder?: string;
  size?: 'small' | 'large' | 'normal';
  /** 可用变量：名称 → 当前值 */
  availableVariables?: Record<string, string>;
}>(), {
  modelValue: '',
  placeholder: '',
  size: 'normal',
  availableVariables: () => ({})
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  input: [event: Event];
  focus: [event: FocusEvent];
  blur: [event: FocusEvent];
}>();

interface VariableSuggestion {
  key: string;
  value: string;
  syntax: string | null;
}

// PrimeVue InputText 组件实例，$el 是其中的 <input>
const inputRef = ref<{ $el: HTMLInputElement } | null>(null);
const highlightRef = ref<HTMLElement | null>(null);
const suggestionsRef = ref<HTMLElement | null>(null);
const showSuggestions = ref(false);
const showParameterHint = ref(false);
const isSelecting = ref(false);
let selectionChangeHandler: (() => void) | null = null;
const parameterHintContent = ref('');
const cursorPosition = ref(0);
const currentVariablePrefix = ref('');
const selectedSuggestionIndex = ref(0); // 当前选中的建议索引

// Undo/Redo 历史栈（只受编辑操作影响，不随时间过期）
const MAX_UNDO_DEPTH = 200;
let undoHistory: string[] = [];
let redoHistory: string[] = [];
const isUndoRedo = ref(false);
let batchStartValue: string | null = null;
let isComposing = false;
let skipNextInput = false;
let lastInputType: 'insert' | 'delete' | null = null;

const variableSuggestions = computed<VariableSuggestion[]>(() => {
  
  if (!currentVariablePrefix.value) {
    // 即使没有前缀，如果用户输入了 {{，也显示所有变量
    if (showSuggestions.value) {
      const allSuggestions = Object.keys(props.availableVariables).map(key => ({
        key,
        value: props.availableVariables[key],
        syntax: BUILT_IN_VARIABLE_SYNTAX[key] || null
      }));
      return allSuggestions;
    }
    return [];
  }
  
  const prefix = currentVariablePrefix.value.toLowerCase();
  const suggestions = Object.keys(props.availableVariables)
    .filter(key => key.toLowerCase().includes(prefix))
    .map(key => ({
      key,
      value: props.availableVariables[key],
      syntax: BUILT_IN_VARIABLE_SYNTAX[key] || null
    }));
  
  return suggestions;
});

// 下拉框和参数提示都挂在 body 上（position: fixed），不会被所在区域裁剪；
// 渲染后按实际尺寸放到输入框下方，下方放不下且上方更宽裕时放到上方，左右不超出窗口
const suggestionsPos = ref({ top: 0, left: 0, width: 0 });
const parameterHintPos = ref({ top: 0, left: 0 });
const parameterHintRef = ref<HTMLElement | null>(null);

const inputRect = () => {
  return inputRef.value?.$el.getBoundingClientRect() ?? null;
};

const placeNearInput = (el: HTMLElement, rect: DOMRect) => {
  const size = el.getBoundingClientRect();
  return placePopup(rect, { width: size.width, height: size.height }, { width: window.innerWidth, height: window.innerHeight });
};

const placeSuggestions = () => {
  const rect = inputRect();
  if (!rect) return;
  suggestionsPos.value = { top: rect.bottom + 4, left: rect.left, width: rect.width };
  nextTick(() => {
    if (!suggestionsRef.value) return;
    const { top, left } = placeNearInput(suggestionsRef.value, rect);
    suggestionsPos.value = { top, left, width: rect.width };
  });
};

const placeParameterHint = () => {
  const rect = inputRect();
  if (!rect) return;
  parameterHintPos.value = { top: rect.bottom + 4, left: rect.left };
  nextTick(() => {
    if (!parameterHintRef.value) return;
    parameterHintPos.value = placeNearInput(parameterHintRef.value, rect);
  });
};

const suggestionsStyle = computed(() => ({
  width: `${suggestionsPos.value.width}px`,
  left: `${suggestionsPos.value.left}px`,
  top: `${suggestionsPos.value.top}px`
}));

watch(() => [showSuggestions.value, variableSuggestions.value.length], ([show]) => {
  if (show) placeSuggestions();
});

watch(() => [showParameterHint.value, parameterHintContent.value], ([show]) => {
  if (show) placeParameterHint();
});

const handleInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const value = target.value;

  if (!isUndoRedo.value && !isComposing && !skipNextInput) {
    const prev = props.modelValue || '';
    const diff = value.length - prev.length;

    if (batchStartValue === null) {
      batchStartValue = prev;
    }

    // 断批条件：
    // 1. 粘贴或批量操作（变化超过1个字符）
    // 2. 从输入切换到删除，或反过来
    // 3. 输入了空格或标点（单词边界）
    const isPaste = Math.abs(diff) > 1;
    const isDelete = diff < 0;
    const isInsert = diff > 0;
    const typeChanged = (lastInputType === 'delete' && isInsert) || (lastInputType === 'insert' && isDelete);
    const lastChar = isInsert ? value.charAt(value.length - 1) : '';
    const isWordBoundary = /[\s,.:;!?/\\=&+\-()[\]{}'"<>]/.test(lastChar);

    if (isPaste) {
      // 粘贴：先 flush 之前的批次，再把粘贴前的值作为新 undo 点
      flushBatch();
      batchStartValue = prev;
      flushBatch();
    } else if (typeChanged) {
      flushBatch();
      batchStartValue = prev;
    } else if (isWordBoundary && isInsert) {
      flushBatch();
      batchStartValue = prev;
    }

    lastInputType = isDelete ? 'delete' : 'insert';
  }
  skipNextInput = false;

  emit('update:modelValue', value);
  emit('input', event);
  checkForVariableTrigger(value, target.selectionStart ?? value.length);
};

function pushUndo(value: string) {
  undoHistory.push(value);
  redoHistory = [];
  if (undoHistory.length > MAX_UNDO_DEPTH) undoHistory.shift();
}

function flushBatch() {
  if (batchStartValue !== null && batchStartValue !== (props.modelValue || '')) {
    pushUndo(batchStartValue);
  }
  batchStartValue = null;
  lastInputType = null;
}

const onCompositionStart = () => {
  isComposing = true;
  // flush 之前的英文批次
  flushBatch();
  // 记录 IME 开始前的值
  batchStartValue = props.modelValue || '';
};

const onCompositionEnd = () => {
  isComposing = false;
  skipNextInput = true;
  // flush IME 这一批（batchStartValue 是 compositionstart 时记录的）
  // 但只有当值确实变了才 flush
  const currentVal = props.modelValue || '';
  if (batchStartValue !== null && batchStartValue !== currentVal) {
    pushUndo(batchStartValue);
  }
  batchStartValue = null;
  lastInputType = null;
};

const handleKeyDown = (event: KeyboardEvent) => {
  // Ctrl+Z 撤销；Ctrl+Shift+Z / Ctrl+Y 重做。
  // 始终由自身历史栈处理并阻止默认行为：浏览器原生撤销栈与 v-model 程序化赋值不同步，
  // 混用会恢复出错误的值，或把一次撤销记成新的编辑。
  const isModifier = (event.ctrlKey || event.metaKey) && !event.altKey;
  const key = (event.key || '').toLowerCase();
  const isUndoKey = isModifier && key === 'z' && !event.shiftKey;
  const isRedoKey = isModifier && ((key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey));
  if (isUndoKey || isRedoKey) {
    event.preventDefault();
    if (isComposing) return;
    // 先结算正在进行的输入批次：撤销时它成为可撤销的一步；
    // 重做前若有新输入，则按常规编辑语义清空重做栈，避免重做覆盖刚输入的内容
    flushBatch();
    const from = isUndoKey ? undoHistory : redoHistory;
    const to = isUndoKey ? redoHistory : undoHistory;
    const target = from.pop();
    if (target === undefined) return;
    isUndoRedo.value = true;
    to.push(props.modelValue || '');
    emit('update:modelValue', target);
    setTimeout(() => {
      if (inputRef.value?.$el) {
        const input = inputRef.value.$el;
        input.setSelectionRange(target.length, target.length);
      }
      isUndoRedo.value = false;
    }, 0);
    return;
  }

  // Esc 只关闭浮层：阻止冒泡，避免同时关闭所在的对话框
  if (event.key === 'Escape' && (showSuggestions.value || showParameterHint.value)) {
    event.preventDefault();
    event.stopPropagation();
    showSuggestions.value = false;
    showParameterHint.value = false;
    return;
  }

  // 只在显示建议时处理键盘事件
  if (!showSuggestions.value || variableSuggestions.value.length === 0) {
    return;
  }
  
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      selectedSuggestionIndex.value = Math.min(
        selectedSuggestionIndex.value + 1,
        variableSuggestions.value.length - 1
      );
      break;
      
    case 'ArrowUp':
      event.preventDefault();
      selectedSuggestionIndex.value = Math.max(selectedSuggestionIndex.value - 1, 0);
      break;
      
    case 'Enter':
    case 'Tab':
      if (variableSuggestions.value[selectedSuggestionIndex.value]) {
        event.preventDefault();
        selectVariable(variableSuggestions.value[selectedSuggestionIndex.value]);
      }
      break;
  }
};

const handleFocus = () => {
  selectionChangeHandler = () => {
    const input = inputRef.value?.$el;
    if (input) {
      isSelecting.value = input.selectionStart !== input.selectionEnd;
    }
  };
  document.addEventListener('selectionchange', selectionChangeHandler);
};

const handleBlur = (event: FocusEvent) => {
  if (selectionChangeHandler) {
    document.removeEventListener('selectionchange', selectionChangeHandler);
    selectionChangeHandler = null;
  }
  isSelecting.value = false;
  hideSuggestions();
  emit('blur', event);
};

const checkForVariableTrigger = (value: string, position: number) => {
  cursorPosition.value = position;
  
  // 查找光标前最近的 {{
  const beforeCursor = value.substring(0, position);
  const lastOpenBrace = beforeCursor.lastIndexOf('{{');
  const lastCloseBrace = beforeCursor.lastIndexOf('}}');
  
  // 如果找到 {{ 且在最后一个 }} 之后，说明正在输入变量
  if (lastOpenBrace !== -1 && lastOpenBrace > lastCloseBrace) {
    const variableText = beforeCursor.substring(lastOpenBrace + 2);
    currentVariablePrefix.value = variableText;
    
    // 检查是否正在输入函数参数（包含左括号）
    const functionMatch = variableText.match(/^(\$\w+)\s*\(/);
    if (functionMatch) {
      const funcName = functionMatch[1];
      if (parameterHints[funcName]) {
        // 显示参数提示
        showParameterHint.value = true;
        parameterHintContent.value = funcName;
        showSuggestions.value = false;
      } else {
        showParameterHint.value = false;
        showSuggestions.value = true;
      }
    } else {
      // 显示变量建议
      showParameterHint.value = false;
      showSuggestions.value = true;
    }
    
    selectedSuggestionIndex.value = 0; // 重置选中索引
  } else {
    showSuggestions.value = false;
    showParameterHint.value = false;
    currentVariablePrefix.value = '';
    selectedSuggestionIndex.value = 0;
  }
};

const selectVariable = (variable: VariableSuggestion) => {
  const value = props.modelValue;
  const beforeCursor = value.substring(0, cursorPosition.value);

  const lastOpenBrace = beforeCursor.lastIndexOf('{{');
  if (lastOpenBrace === -1) return;

  const afterCursor = value.substring(cursorPosition.value);
  const closeBraceIndex = afterCursor.indexOf('}}');
  let replacementEnd = cursorPosition.value;
  if (closeBraceIndex !== -1) {
    replacementEnd = cursorPosition.value + closeBraceIndex + 2;
  } else if (afterCursor.startsWith('}')) {
    replacementEnd = cursorPosition.value + 1;
  }
  const newValue = value.substring(0, lastOpenBrace + 2)
    + variable.key
    + '}}'
    + value.substring(replacementEnd);
  
  emit('update:modelValue', newValue);
  showSuggestions.value = false;
  currentVariablePrefix.value = '';
  selectedSuggestionIndex.value = 0;
  
  // 聚焦回输入框，光标放在插入的变量处（以 . 结尾的项停在 . 之后）。
  // 在新值渲染后、下一次按键前设置；之后已经输入了内容时不再移动光标
  const cursor = lastOpenBrace + completionCursorOffset(variable.key);
  nextTick(() => {
    const input = inputRef.value?.$el;
    if (!input || input.value !== newValue) return;
    input.focus();
    input.setSelectionRange(cursor, cursor);
  });
};

const hideSuggestions = () => {
  setTimeout(() => {
    showSuggestions.value = false;
    showParameterHint.value = false;
    selectedSuggestionIndex.value = 0;
  }, 200);
};

// 是否包含任何 {{...}} 变量
const hasAnyVariables = computed(() => {
  return !!(props.modelValue && /\{\{[^}]+\}\}/.test(props.modelValue));
});

// 将 input 的字体/padding 同步到 highlight overlay（颜色由 CSS 继承，不从 input 读取）
const syncOverlay = () => {
  const input = inputRef.value?.$el;
  const overlay = highlightRef.value;
  if (!input || !overlay) return;

  const cs = window.getComputedStyle(input);
  const bw = parseFloat(cs.borderTopWidth) || 1;
  overlay.style.top = `${bw}px`;
  overlay.style.left = `${bw}px`;
  overlay.style.right = `${bw}px`;
  overlay.style.bottom = `${bw}px`;
  overlay.style.paddingTop = cs.paddingTop;
  overlay.style.paddingBottom = cs.paddingBottom;
  overlay.style.paddingLeft = cs.paddingLeft;
  overlay.style.paddingRight = cs.paddingRight;
  overlay.style.fontSize = cs.fontSize;
  overlay.style.fontFamily = cs.fontFamily;
  overlay.style.fontWeight = cs.fontWeight;
  overlay.style.lineHeight = cs.lineHeight;
  overlay.style.letterSpacing = cs.letterSpacing;
};

// 同步 input 横向滚动到 overlay
const syncScroll = () => {
  const input = inputRef.value?.$el;
  if (input && highlightRef.value) {
    highlightRef.value.scrollLeft = input.scrollLeft;
  }
};

// 当 overlay 通过 v-if 创建时同步样式
watch(highlightRef, (el) => {
  if (el) requestAnimationFrame(syncOverlay);
});

// 键盘导航时将选中项滚动进可视区
watch(selectedSuggestionIndex, (idx) => {
  nextTick(() => {
    const item = suggestionsRef.value?.children[idx];
    item?.scrollIntoView({ block: 'nearest' });
  });
});

onMounted(() => {
  nextTick(() => {
    const input = inputRef.value?.$el;
    if (input) input.addEventListener('scroll', syncScroll);
    // 用 rAF 确保浏览器完成布局/样式计算后再同步 overlay
    requestAnimationFrame(syncOverlay);
  });
});

onUnmounted(() => {
  const input = inputRef.value?.$el;
  if (input) input.removeEventListener('scroll', syncScroll);
  if (selectionChangeHandler) {
    document.removeEventListener('selectionchange', selectionChangeHandler);
    selectionChangeHandler = null;
  }
});

// 检查变量是否存在
const checkVariableExists = (varName: string) => {
  // 内置变量函数调用形式，如 $date("format")、$randomInt(1,100)、$sequence(start=1) 等
  if (/^\$\w+\s*\(/.test(varName)) {
    return true;
  }
  return Object.prototype.hasOwnProperty.call(props.availableVariables, varName);
};

// 检查输入值中是否有不存在的变量
const escapeHtml = (str: string) => {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const buildHighlightedValue = (value: string) => {
  if (!value) return '';

  const regex = /(\{\{[^}]+\}\})/g;
  const parts = value.split(regex);

  return parts.map((part: string) => {
    if (!part) return '';
    if (part.startsWith('{{') && part.endsWith('}}')) {
      const varName = part.slice(2, -2).trim();
      const exists = checkVariableExists(varName);
      const className = exists ? 'variable-part-valid' : 'variable-part-invalid';
      return `<span class="${className}">${escapeHtml(part)}</span>`;
    }
    return escapeHtml(part);
  }).join('');
};

const highlightedHtml = computed(() => {
  if (!props.modelValue) return '';
  return buildHighlightedValue(props.modelValue);
});
</script>

<template>
  <div class="variable-input-wrapper relative">
    <InputText
      ref="inputRef"
      :modelValue="modelValue"
      :placeholder="placeholder"
      :size="size"
      :class="['w-full', { 'var-transparent': hasAnyVariables && !isSelecting }]"
      @input="handleInput"
      @keydown="handleKeyDown"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
      @focus="(e: FocusEvent) => { handleFocus(); emit('focus', e); }"
      @blur="handleBlur"
    />
    <!-- 变量高亮 overlay，叠加在 input 之上，pointer-events:none 保证 input 仍可交互 -->
    <div
      v-if="hasAnyVariables && !isSelecting"
      ref="highlightRef"
      class="var-highlight-layer"
      aria-hidden="true"
      v-html="highlightedHtml"
    />
    <!-- Variable Suggestions Dropdown - Teleport to body to escape overflow constraints -->
    <Teleport to="body">
      <div
        v-if="showSuggestions && variableSuggestions.length > 0"
        ref="suggestionsRef"
        class="variable-suggestions ak-floating fixed bg-surface-0 dark:bg-surface-900 border border-surface-300 dark:border-surface-700 rounded shadow-lg max-h-64 overflow-y-auto"
        :style="suggestionsStyle"
      >
      <div
        v-for="(variable, index) in variableSuggestions"
        :key="variable.key"
        :class="[
          'px-3 py-2 cursor-pointer transition',
          index === selectedSuggestionIndex
            ? 'variable-suggestion-active'
            : 'hover:bg-surface-100 dark:hover:bg-surface-800'
        ]"
        @mousedown="selectVariable(variable)"
        @mouseenter="selectedSuggestionIndex = index"
      >
        <div class="flex flex-col gap-1">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-primary">{{ variable.key }}</span>
            <span 
              v-if="!variable.syntax"
              class="text-xs text-surface-500 dark:text-surface-400 ml-2 truncate max-w-xs"
            >
              {{ variable.value }}
            </span>
          </div>
          <div v-if="variable.syntax" class="text-xs text-surface-600 dark:text-surface-400">
            {{ variable.syntax }}
          </div>
        </div>
      </div>
    </div>
    </Teleport>

    <!-- Parameter Hint Panel（挂到 body，避免被所在区域裁剪） -->
    <Teleport to="body">
    <div
      v-if="showParameterHint && parameterHints[parameterHintContent]"
      ref="parameterHintRef"
      class="ak-floating ak-variable-param-hint fixed bg-surface-0 dark:bg-surface-900 border border-primary-300 dark:border-primary-700 rounded shadow-lg p-4 min-w-96 max-w-2xl"
      :style="{ top: parameterHintPos.top + 'px', left: parameterHintPos.left + 'px' }"
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
              <code class="text-primary font-mono flex-shrink-0">{{ example.syntax }}</code>
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
  </div>
</template>

<style scoped>
.variable-input-wrapper {
  position: relative;
}

/* Overlay: 绝对定位，覆盖在 input 上方，不拦截鼠标事件 */
.var-highlight-layer {
  position: absolute;
  overflow: hidden;
  pointer-events: none;
  white-space: pre;
  background: transparent;
  /* top/left/right/bottom/padding/font 均由 syncOverlay() 通过 JS 动态设置 */
}

/* 当有变量时隐藏 input 的文本，caret 用 CSS 系统色自动适配深/浅模式 */
:deep(.var-transparent.p-inputtext) {
  color: transparent !important;
  caret-color: FieldText !important;
}

/* 已匹配的变量 → 琥珀黄（amber），与红色有明显色相差距 */
:deep(.variable-part-valid) {
  color: #d97706;
}

/* 未匹配的变量 → 深红 */
:deep(.variable-part-invalid) {
  color: #dc2626;
}
</style>

<!--
  The suggestions dropdown is <Teleport to="body">, so its selected-item style
  must be global (scoped :deep can't reach a body-level node). It shares the
  --ac-selected-* accent variables (defined per light/dark scheme in style.css)
  with the autocomplete list in JsonEditor, so every {{ }} variable picker
  highlights the selected row identically and stays in sync.
-->
<style>
.ak-floating {
  z-index: var(--ak-floating-z, 2000);
}

.variable-suggestion-active {
  background-color: var(--ac-selected-bg, #2563eb) !important;
}

/* All text → light detail color, then lift the variable name to the label color
   (higher specificity wins among the !important rules). */
.variable-suggestion-active,
.variable-suggestion-active * {
  color: var(--ac-selected-detail-color, #dbeafe) !important;
}

.variable-suggestion-active .text-primary {
  color: var(--ac-selected-label-color, #ffffff) !important;
}
</style>
