<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  placeholder: {
    type: String,
    default: ''
  },
  size: {
    type: String,
    default: 'normal'
  },
  availableVariables: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(['update:modelValue', 'input', 'focus', 'blur']);

const inputRef = ref(null);
const highlightRef = ref(null);
const suggestionsRef = ref(null);
const showSuggestions = ref(false);
const showParameterHint = ref(false);
const isSelecting = ref(false);
let selectionChangeHandler = null;
const parameterHintContent = ref('');
const cursorPosition = ref(0);
const currentVariablePrefix = ref('');
const selectedSuggestionIndex = ref(0); // 当前选中的建议索引

// Undo/Redo 历史栈
let undoHistory = [];
let redoHistory = [];
const isUndoRedo = ref(false);
let batchStartValue = null;
let isComposing = false;
let skipNextInput = false;
let lastInputType = null; // 'insert' | 'delete' | 'paste'

// 参数提示信息
const parameterHints = {
  '$sequence': {
    title: '$sequence Parameters',
    description: 'Auto-increment sequence with customizable settings',
    examples: [
      { syntax: '$sequence', desc: 'Default: start=1, step=1' },
      { syntax: '$sequence(100)', desc: 'Start from 100' },
      { syntax: '$sequence(start=100)', desc: 'Named param: start value' },
      { syntax: '$sequence(step=10)', desc: 'Named param: step value' },
      { syntax: '$sequence(padding=5)', desc: 'Named param: zero padding' },
      { syntax: '$sequence(name=order)', desc: 'Named param: sequence name' },
      { syntax: '$sequence(name=order, start=1000, step=10)', desc: 'Multiple params' }
    ],
    params: [
      { name: 'name', type: 'string', default: '"default"', desc: 'Sequence name' },
      { name: 'padding', type: 'number', default: '0', desc: 'Zero padding digits' },
      { name: 'start', type: 'number', default: '1', desc: 'Starting value' },
      { name: 'step', type: 'number', default: '1', desc: 'Increment step' }
    ]
  },
  '$randomInt': {
    title: '$randomInt Parameters',
    description: 'Generate random integer within specified range',
    examples: [
      { syntax: '$randomInt', desc: 'Random 0-1000 (default)' },
      { syntax: '$randomInt(1, 100)', desc: 'Random between 1 and 100' },
      { syntax: '$randomInt(min=1, max=100)', desc: 'Named params: min and max' },
      { syntax: '$randomInt(start=50, end=150)', desc: 'Named params: start and end' }
    ],
    params: [
      { name: 'start / min', type: 'number', default: '0', desc: 'Minimum value (inclusive)' },
      { name: 'end / max', type: 'number', default: '1000', desc: 'Maximum value (inclusive)' }
    ]
  },
  '$date': {
    title: '$date Parameters',
    description: 'Current date with custom format',
    examples: [
      { syntax: '$date', desc: 'Default: yyyyMMdd' },
      { syntax: '$date("yyyy/MM/dd")', desc: 'Custom format with slashes' },
      { syntax: '$date("yyyyMMdd")', desc: 'Compact format' },
      { syntax: '$date(format="yyyy-MM-dd")', desc: 'Named param: format' },
      { syntax: '$date(fmt="dd/MM/yyyy")', desc: 'Named param: fmt (alias)' }
    ],
    params: [
      { name: 'format / fmt', type: 'string', default: '"yyyy-MM-dd"', desc: 'Date format (yyyy=year, MM=month, dd=day)' }
    ]
  },
  '$time': {
    title: '$time Parameters',
    description: 'Current time with custom format',
    examples: [
      { syntax: '$time', desc: 'Default: HHmmss' },
      { syntax: '$time("HH:mm")', desc: 'Hours and minutes only' },
      { syntax: '$time(format="HH:mm:ss")', desc: 'Named param: format' },
      { syntax: '$time(fmt="HHmmss")', desc: 'Compact time format' }
    ],
    params: [
      { name: 'format / fmt', type: 'string', default: '"HH:mm:ss"', desc: 'Time format (HH=hours, mm=minutes, ss=seconds)' }
    ]
  },
  '$datetime': {
    title: '$datetime Parameters',
    description: 'Current datetime with custom format',
    examples: [
      { syntax: '$datetime', desc: 'Default: yyyyMMddHHmmss' },
      { syntax: '$datetime("yyyy-MM-dd HH:mm")', desc: 'Without seconds' },
      { syntax: '$datetime(format="yyyyMMdd_HHmmss")', desc: 'Compact with underscore' },
      { syntax: '$datetime(fmt="yyyy/MM/dd HH:mm")', desc: 'Custom format' }
    ],
    params: [
      { name: 'format / fmt', type: 'string', default: '"yyyy-MM-dd HH:mm:ss"', desc: 'Datetime format' }
    ]
  },
  '$randomAlpha': {
    title: '$randomAlpha Parameters',
    description: 'Generate random letters (mixed case)',
    examples: [
      { syntax: '$randomAlpha', desc: 'Default: 10 letters' },
      { syntax: '$randomAlpha(20)', desc: '20 random letters' },
      { syntax: '$randomAlpha(length=15)', desc: 'Named param: length' },
      { syntax: '$randomAlpha(len=8)', desc: 'Named param: len (alias)' }
    ],
    params: [
      { name: 'length / len', type: 'number', default: '10', desc: 'String length' }
    ]
  },
  '$randomNumeric': {
    title: '$randomNumeric Parameters',
    description: 'Generate random digits',
    examples: [
      { syntax: '$randomNumeric', desc: 'Default: 10 digits' },
      { syntax: '$randomNumeric(6)', desc: '6 random digits' },
      { syntax: '$randomNumeric(length=8)', desc: 'Named param: length' },
      { syntax: '$randomNumeric(len=12)', desc: 'Named param: len (alias)' }
    ],
    params: [
      { name: 'length / len', type: 'number', default: '10', desc: 'String length' }
    ]
  },
  '$randomUppercase': {
    title: '$randomUppercase Parameters',
    description: 'Generate random uppercase letters',
    examples: [
      { syntax: '$randomUppercase', desc: 'Default: 10 uppercase letters' },
      { syntax: '$randomUppercase(15)', desc: '15 uppercase letters' },
      { syntax: '$randomUppercase(length=20)', desc: 'Named param: length' },
      { syntax: '$randomUppercase(len=12)', desc: 'Named param: len (alias)' }
    ],
    params: [
      { name: 'length / len', type: 'number', default: '10', desc: 'String length' }
    ]
  },
  '$randomLowercase': {
    title: '$randomLowercase Parameters',
    description: 'Generate random lowercase letters',
    examples: [
      { syntax: '$randomLowercase', desc: 'Default: 10 lowercase letters' },
      { syntax: '$randomLowercase(12)', desc: '12 lowercase letters' },
      { syntax: '$randomLowercase(length=18)', desc: 'Named param: length' },
      { syntax: '$randomLowercase(len=8)', desc: 'Named param: len (alias)' }
    ],
    params: [
      { name: 'length / len', type: 'number', default: '10', desc: 'String length' }
    ]
  },
  '$randomAlphanumeric': {
    title: '$randomAlphanumeric Parameters',
    description: 'Generate random letters and digits',
    examples: [
      { syntax: '$randomAlphanumeric', desc: 'Default: 10 characters' },
      { syntax: '$randomAlphanumeric(16)', desc: '16 random characters' },
      { syntax: '$randomAlphanumeric(length=32)', desc: 'Named param: length' },
      { syntax: '$randomAlphanumeric(len=24)', desc: 'Named param: len (alias)' }
    ],
    params: [
      { name: 'length / len', type: 'number', default: '10', desc: 'String length' }
    ]
  },
  '$randomChinese': {
    title: '$randomChinese Parameters',
    description: 'Generate random Chinese characters with readable phrases',
    examples: [
      { syntax: '$randomChinese', desc: 'Default: 10 characters' },
      { syntax: '$randomChinese(20)', desc: '20 Chinese characters' },
      { syntax: '$randomChinese(length=15)', desc: 'Named param: length' },
      { syntax: '$randomChinese(len=25)', desc: 'Named param: len (alias)' }
    ],
    params: [
      { name: 'length / len', type: 'number', default: '10', desc: 'String length' }
    ]
  }
};

const variableSuggestions = computed(() => {
  // 定义内置变量的语法说明
  const builtInVariableSyntax = {
    '$timestamp': 'Current timestamp in milliseconds',
    '$isoTimestamp': 'Current ISO 8601 timestamp',
    '$randomInt': '$randomInt, $randomInt(start, end), or $randomInt(min=0, max=100) - Random integer',
    '$guid': 'Random UUID/GUID',
    '$date': '$date, $date("format"), or $date(format="yyyyMMdd") - Current date',
    '$time': '$time, $time("format"), or $time(format="HHmmss") - Current time',
    '$datetime': '$datetime, $datetime("format"), or $datetime(format="yyyyMMddHHmmss") - Current datetime',
    '$randomAlpha': '$randomAlpha, $randomAlpha(length), or $randomAlpha(length=10) - Random letters',
    '$randomNumeric': '$randomNumeric, $randomNumeric(length), or $randomNumeric(length=10) - Random digits',
    '$randomUppercase': '$randomUppercase, $randomUppercase(length), or $randomUppercase(length=10) - Random uppercase',
    '$randomLowercase': '$randomLowercase, $randomLowercase(length), or $randomLowercase(length=10) - Random lowercase',
    '$randomAlphanumeric': '$randomAlphanumeric, $randomAlphanumeric(length), or $randomAlphanumeric(length=10) - Random letters and digits',
    '$randomChinese': '$randomChinese, $randomChinese(length), or $randomChinese(length=10) - Random Chinese characters',
    '$sequence': '$sequence, $sequence(100), $sequence(start=100), $sequence(step=10), or $sequence(name=myseq, start=100, step=10) - Auto-increment'
  };
  
  if (!currentVariablePrefix.value) {
    // 即使没有前缀，如果用户输入了 {{，也显示所有变量
    if (showSuggestions.value) {
      const allSuggestions = Object.keys(props.availableVariables).map(key => ({
        key,
        value: props.availableVariables[key],
        syntax: builtInVariableSyntax[key] || null
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
      syntax: builtInVariableSyntax[key] || null
    }));
  
  console.log('VariableInput - filtered suggestions:', suggestions);
  return suggestions;
});

// 计算下拉框位置 - 使用Teleport时需要相对于视口定位
const suggestionsStyle = computed(() => {
  if (!inputRef.value) return { width: '100%' };

  const input = inputRef.value.$el || inputRef.value;
  const rect = input.getBoundingClientRect();

  return {
    width: `${rect.width}px`,
    left: `${rect.left}px`,
    top: `${rect.bottom + window.scrollY + 4}px`
  };
});

// 监听 availableVariables 变化
watch(() => props.availableVariables, (newVars) => {
  console.log('VariableInput - availableVariables changed:', newVars);
}, { deep: true, immediate: true });

const handleInput = (event) => {
  const value = event.target.value;

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
  checkForVariableTrigger(value, event.target.selectionStart);
};

function flushBatch() {
  if (batchStartValue !== null && batchStartValue !== (props.modelValue || '')) {
    undoHistory.push(batchStartValue);
    redoHistory = [];
    if (undoHistory.length > 50) undoHistory.shift();
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
    undoHistory.push(batchStartValue);
    redoHistory = [];
    if (undoHistory.length > 50) undoHistory.shift();
  }
  batchStartValue = null;
  lastInputType = null;
};

const handleKeyDown = (event) => {
  // Ctrl+Z: Undo
  if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
    flushBatch();
    if (undoHistory.length > 0) {
      event.preventDefault();
      isUndoRedo.value = true;
      redoHistory.push(props.modelValue || '');
      const prev = undoHistory.pop();
      emit('update:modelValue', prev);
      setTimeout(() => {
        if (inputRef.value?.$el) {
          const input = inputRef.value.$el;
          input.setSelectionRange(prev.length, prev.length);
        }
        isUndoRedo.value = false;
      }, 0);
      return;
    }
  }
  
  // Ctrl+Shift+Z or Ctrl+Y: Redo
  if ((event.ctrlKey || event.metaKey) && ((event.key === 'z' || event.key === 'Z') && event.shiftKey || event.key === 'y')) {
    if (redoHistory.length > 0) {
      event.preventDefault();
      isUndoRedo.value = true;
      undoHistory.push(props.modelValue || '');
      const next = redoHistory.pop();
      emit('update:modelValue', next);
      setTimeout(() => {
        if (inputRef.value?.$el) {
          const input = inputRef.value.$el;
          input.setSelectionRange(next.length, next.length);
        }
        isUndoRedo.value = false;
      }, 0);
      return;
    }
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
      
    case 'Escape':
      event.preventDefault();
      showSuggestions.value = false;
      break;
  }
};

const handleFocus = (event) => {
  selectionChangeHandler = () => {
    const input = inputRef.value?.$el;
    if (input) {
      isSelecting.value = input.selectionStart !== input.selectionEnd;
    }
  };
  document.addEventListener('selectionchange', selectionChangeHandler);
};

const handleBlur = (event) => {
  if (selectionChangeHandler) {
    document.removeEventListener('selectionchange', selectionChangeHandler);
    selectionChangeHandler = null;
  }
  isSelecting.value = false;
  hideSuggestions();
  emit('blur', event);
};

const checkForVariableTrigger = (value, position) => {
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

const selectVariable = (variable) => {
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
  
  // 聚焦回输入框
  setTimeout(() => {
    if (inputRef.value) {
      inputRef.value.$el.focus();
    }
  }, 0);
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
const checkVariableExists = (varName) => {
  // 内置变量函数调用形式，如 $date("format")、$randomInt(1,100)、$sequence(start=1) 等
  if (/^\$\w+\s*\(/.test(varName)) {
    return true;
  }
  return Object.prototype.hasOwnProperty.call(props.availableVariables, varName);
};

// 检查输入值中是否有不存在的变量
const escapeHtml = (str) => {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const buildHighlightedValue = (value) => {
  if (!value) return '';

  const regex = /(\{\{[^}]+\}\})/g;
  const parts = value.split(regex);

  return parts.map((part) => {
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

const hasValidVariables = computed(() => {
  if (!props.modelValue) return false;

  const regex = /\{\{([^}]+)\}\}/g;
  let match;
  let foundVariable = false;

  while ((match = regex.exec(props.modelValue)) !== null) {
    const varName = match[1].trim();
    if (!varName) continue;

    foundVariable = true;
    if (!checkVariableExists(varName)) {
      return false;
    }
  }

  return foundVariable;
});

const hasInvalidVariables = computed(() => {
  if (!props.modelValue) return false;

  console.log('[VariableInput] Checking invalid variables for:', props.modelValue);
  console.log('[VariableInput] Available variables:', props.availableVariables);
  console.log('[VariableInput] Available variables keys:', Object.keys(props.availableVariables));
  
  // 使用正则表达式匹配 {{variable}}
  const regex = /\{\{([^}]+)\}\}/g;
  let match;
  
  while ((match = regex.exec(props.modelValue)) !== null) {
    const varName = match[1].trim();
    const exists = checkVariableExists(varName);
    console.log(`[VariableInput] Variable "${varName}" exists:`, exists);
    
    if (!exists) {
      console.log('[VariableInput] Found invalid variable:', varName);
      return true; // 找到不存在的变量
    }
  }
  
  console.log('[VariableInput] No invalid variables found');
  return false;
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
      @focus="(e) => { handleFocus(e); emit('focus', e); }"
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
        class="variable-suggestions absolute z-50 bg-surface-0 dark:bg-surface-900 border border-surface-300 dark:border-surface-700 rounded shadow-lg max-h-64 overflow-y-auto"
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

    <!-- Parameter Hint Panel -->
    <div
      v-if="showParameterHint && parameterHints[parameterHintContent]"
      class="absolute z-50 mt-1 bg-surface-0 dark:bg-surface-900 border border-primary-300 dark:border-primary-700 rounded shadow-lg p-4 min-w-96 max-w-2xl"
      style="left: 0; right: auto;"
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
  with the CodeMirror autocomplete in JsonEditor, so every {{ }} variable picker
  highlights the selected row identically and stays in sync.
-->
<style>
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
