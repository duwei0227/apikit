<script setup>
import { ref, onMounted, watch, onUnmounted, nextTick } from 'vue';
// CodeMirror 5 (aliased as `codemirror5` in package.json so it coexists with the
// CodeMirror 6 used by CodeEditor.vue). CM5 uses a hidden <textarea> for input
// (inputStyle:"textarea"), so IME/composition is handled natively by the browser —
// this avoids the CM6 contenteditable IME bug that drops every other Chinese
// character on Windows/WebView2.
import CodeMirror from 'codemirror5';
import 'codemirror5/lib/codemirror.css';
import 'codemirror5/mode/javascript/javascript.js';
import 'codemirror5/mode/xml/xml.js';
import 'codemirror5/addon/hint/show-hint.js';
import 'codemirror5/addon/hint/show-hint.css';
import 'codemirror5/addon/display/placeholder.js';
import 'codemirror5/addon/edit/matchbrackets.js';
// basicSetup(CM6)默认自带的基础能力，CM5 需手动引入对应 addon：
import 'codemirror5/addon/edit/closebrackets.js';   // 自动闭合 {} [] "" 等
import 'codemirror5/addon/edit/closetag.js';        // 自动闭合 XML 标签
import 'codemirror5/addon/edit/matchtags.js';       // 高亮匹配 XML 标签
import 'codemirror5/addon/fold/foldgutter.js';      // 代码折叠（折叠槽）
import 'codemirror5/addon/fold/foldgutter.css';
import 'codemirror5/addon/fold/brace-fold.js';      // 按 {} [] 折叠 JSON
import 'codemirror5/addon/fold/xml-fold.js';        // 按 XML 元素折叠
import 'codemirror5/addon/selection/active-line.js'; // 当前行高亮
import 'codemirror5/theme/dracula.css';
import { findXmlTagPairAtCursor } from '../utils/xmlEditing';

// ── 容错 JSON 模式（jsonWithVars）────────────────────────────────────────────
// 包装内置 javascript(json) 模式，把未加引号的 {{xxx}} 当作单个不透明 token 处理。
// 直接交给内层会把 `{{` `}}` 当成对象起止符，破坏其括号/取值状态机，导致：
//   1) 回车换行后 mode.indent() 返回 0（缩进丢失）；
//   2) 其后的 key 被错当成字符串值（紫色键名变蓝色）。
// 这里吞掉 {{xxx}} 后，再用一个临时 '0' 字面量驱动内层状态机走完一次「取值」，
// 使内层认为该位置已是一个完整值，从而后续的逗号/键名解析、缩进都保持正确。
// {{xxx}} 本身不返回基础样式（null），由变量 overlay 负责着色。
// 只在 {{xxx}} 处改变行为，对合法 JSON 与原模式完全一致（已验证 0 差异）。
const TEMPLATE_VAR_TOKEN = /^\{\{[^{}]*?\}\}/;
if (!CodeMirror.modes.jsonWithVars) {
  CodeMirror.defineMode('jsonWithVars', (config) => {
    const inner = CodeMirror.getMode(config, { name: 'javascript', json: true });
    // 用一个一次性 '0' 字面量推进内层状态机，等价于「内层消费了一个值」。
    const advanceInnerAsValue = (innerState) => {
      const probe = new CodeMirror.StringStream('0', config.indentUnit || 2, {
        lookAhead: () => null,
        baseToken: () => null,
      });
      while (!probe.eol()) {
        inner.token(probe, innerState);
        probe.start = probe.pos;
      }
    };
    return {
      startState: () => ({ inner: CodeMirror.startState(inner) }),
      copyState: (s) => ({ inner: CodeMirror.copyState(inner, s.inner) }),
      token: (stream, s) => {
        if (stream.match(TEMPLATE_VAR_TOKEN)) {
          advanceInnerAsValue(s.inner);
          return null;
        }
        return inner.token(stream, s.inner);
      },
      indent: (s, textAfter, line) =>
        inner.indent ? inner.indent(s.inner, textAfter, line) : CodeMirror.Pass,
      electricInput: inner.electricInput,
      electricChars: inner.electricChars,
      blankLine: (s) => inner.blankLine && inner.blankLine(s.inner),
      innerMode: (s) => ({ state: s.inner, mode: inner }),
    };
  });
}

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  placeholder: {
    type: String,
    default: ''
  },
  readOnly: {
    type: Boolean,
    default: false
  },
  language: {
    type: String,
    default: 'json',
    validator: (value) => ['json', 'xml', 'text'].includes(value)
  },
  availableVariables: {
    type: Object,
    default: () => ({})
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

// 拦截 Ctrl+F（capture 阶段，在 CodeMirror 处理之前触发）
const onContainerKeydown = (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
    event.preventDefault();
    event.stopPropagation();
    emit('ctrl-f', getSelectedText());
  }
};

// 获取编辑器当前选中的文本（用于 Ctrl+F 时默认填充搜索框）
const getSelectedText = () => {
  if (!editor) return '';
  return editor.getSelection() || '';
};

const editorContainer = ref(null);
const parameterHintPanel = ref(null);
let editor = null;
let applyingExternal = false; // guard so programmatic setValue doesn't echo as user edit

const isDark = ref(false);
const showParameterHint = ref(false);
const parameterHintContent = ref('');
const hintPosition = ref({ top: 0, left: 0 });

// 参数提示信息（与 VariableInput 保持一致）
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
      { syntax: '$date', desc: 'Default: yyyy-MM-dd' },
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
      { syntax: '$time', desc: 'Default: HH:mm:ss' },
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
      { syntax: '$datetime', desc: 'Default: yyyy-MM-dd HH:mm:ss' },
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

// 检查是否正在输入函数参数
const checkForParameterHint = (text, cursorPos) => {
  // 查找光标前最近的 {{
  const beforeCursor = text.substring(0, cursorPos);
  const lastOpenBrace = beforeCursor.lastIndexOf('{{');
  const lastCloseBrace = beforeCursor.lastIndexOf('}}');

  // 如果找到 {{ 且在最后一个 }} 之后
  if (lastOpenBrace !== -1 && lastOpenBrace > lastCloseBrace) {
    const variableText = beforeCursor.substring(lastOpenBrace + 2);

    // 检查是否正在输入函数参数（包含左括号）
    const functionMatch = variableText.match(/^(\$\w+)\s*\(/);
    if (functionMatch) {
      const funcName = functionMatch[1];
      if (parameterHints[funcName]) {
        return funcName;
      }
    }
  }

  return null;
};

// 计算提示面板位置
const calculateHintPosition = () => {
  if (!editor || !editorContainer.value) return;
  const coords = editor.cursorCoords(editor.getCursor(), 'page');
  if (coords) {
    const editorRect = editorContainer.value.getBoundingClientRect();
    hintPosition.value = {
      top: coords.bottom - editorRect.top + 5,
      left: coords.left - editorRect.left
    };
  }
};

const updateParameterHint = () => {
  if (!editor) return;
  const text = editor.getValue();
  const cursorPos = editor.indexFromPos(editor.getCursor());
  const funcName = checkForParameterHint(text, cursorPos);
  if (funcName) {
    parameterHintContent.value = funcName;
    showParameterHint.value = true;
    calculateHintPosition();
  } else {
    showParameterHint.value = false;
  }
};

const builtInVariableSyntax = {
  '$timestamp': 'Current timestamp in milliseconds',
  '$isoTimestamp': 'Current ISO 8601 timestamp',
  '$guid': 'Random UUID/GUID',
  '$randomInt': '$randomInt, $randomInt(start, end), or $randomInt(min=0, max=100) - Random integer',
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

const VAR_REGEX = /\{\{([^{}]*?)\}\}/g;
const getBaseVarName = (content) => content.trim().split('(')[0].trim();

// ── 变量自动完成（show-hint）─────────────────────────────────────────────
// 仅在 {{ 内触发，复用 availableVariables。CM5 的 show-hint 在 inputRead 后触发，
// IME 合成期间不会触发，因此对中文输入无干扰。
const variableHint = (cm) => {
  const cur = cm.getCursor();
  const line = cm.getLine(cur.line) || '';
  const before = line.slice(0, cur.ch);
  const open = before.lastIndexOf('{{');
  if (open === -1) return null;
  const between = before.slice(open + 2);
  if (between.includes('}}')) return null;
  const prefix = between;

  const builtInVars = [];
  const userVars = [];
  Object.entries(props.availableVariables).forEach(([key, value]) => {
    if (!prefix || key.toLowerCase().includes(prefix.toLowerCase())) {
      const isBuiltIn = key.startsWith('$');
      const detail = isBuiltIn
        ? (builtInVariableSyntax[key] || String(value))
        : `= ${String(value)}`;
      const item = {
        text: key,
        detail,
        hint: (cmInst, data, completion) => {
          const lineNow = cmInst.getLine(cur.line) || '';
          const after = lineNow.substr(cur.ch, 2);
          const insert = after === '}}' ? `{{${key}` : `{{${key}}}`;
          cmInst.replaceRange(
            insert,
            { line: cur.line, ch: open },
            { line: cur.line, ch: cur.ch }
          );
        },
        render: (el) => {
          const label = document.createElement('div');
          label.className = 'ak-hint-label';
          label.textContent = key;
          const det = document.createElement('div');
          det.className = 'ak-hint-detail';
          det.textContent = detail;
          el.appendChild(label);
          el.appendChild(det);
        }
      };
      (isBuiltIn ? builtInVars : userVars).push(item);
    }
  });

  const list = [...builtInVars, ...userVars];
  if (!list.length) return null;
  return {
    list,
    from: CodeMirror.Pos(cur.line, open),
    to: CodeMirror.Pos(cur.line, cur.ch)
  };
};

// ── 变量高亮（overlay）────────────────────────────────────────────────────
// 通过 overlay 给 {{var}} 上 cm-var-valid / cm-var-invalid 类。overlay 随 CM5
// 正常渲染增量执行，无需每次按键手动重建，对 IME 无干扰。
let currentVarOverlay = null;
const makeVarOverlay = (availableVars) => ({
  token(stream) {
    if (stream.match(/^\{\{[^{}]*?\}\}/)) {
      const matched = stream.current();
      const base = getBaseVarName(matched.slice(2, -2));
      return base in availableVars ? 'var-valid' : 'var-invalid';
    }
    // 跳到下一个 {{ 之前的内容不着色
    while (stream.next() != null) {
      if (stream.match(/^\{\{/, false)) break;
    }
    return null;
  }
});

const applyVarOverlay = () => {
  if (!editor) return;
  if (currentVarOverlay) editor.removeOverlay(currentVarOverlay);
  currentVarOverlay = makeVarOverlay(props.availableVariables);
  editor.addOverlay(currentVarOverlay);
};

// ── 搜索高亮（markText）──────────────────────────────────────────────────
let searchMarks = [];
const clearSearchMarks = () => {
  searchMarks.forEach((m) => m.clear());
  searchMarks = [];
};
const updateSearchHighlights = () => {
  if (!editor) return;
  clearSearchMarks();
  props.searchMatches.forEach((match, idx) => {
    const from = editor.posFromIndex(match.index);
    const to = editor.posFromIndex(match.index + match.length);
    const cls = idx === props.currentMatchIndex ? 'cm-searchMatch-current' : 'cm-searchMatch';
    searchMarks.push(editor.markText(from, to, { className: cls }));
  });
  if (props.currentMatchIndex >= 0 && props.searchMatches[props.currentMatchIndex]) {
    const match = props.searchMatches[props.currentMatchIndex];
    const from = editor.posFromIndex(match.index);
    const to = editor.posFromIndex(match.index + match.length);
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, 60);
  }
};

// ── 变量悬浮提示（自定义，CM5 无内置 hover）───────────────────────────────
let hoverTipEl = null;
let hoverRaf = null;
const hideHoverTip = () => {
  if (hoverTipEl) {
    hoverTipEl.remove();
    hoverTipEl = null;
  }
};
const onEditorMouseMove = (e) => {
  if (hoverRaf) cancelAnimationFrame(hoverRaf);
  hoverRaf = requestAnimationFrame(() => {
    if (!editor) return;
    let pos;
    try {
      pos = editor.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
    } catch {
      hideHoverTip();
      return;
    }
    const line = editor.getLine(pos.line);
    if (line == null) { hideHoverTip(); return; }
    const regex = new RegExp(VAR_REGEX.source, 'g');
    let m, found = null;
    while ((m = regex.exec(line)) !== null) {
      if (pos.ch >= m.index && pos.ch <= m.index + m[0].length) { found = m; break; }
    }
    if (!found) { hideHoverTip(); return; }
    const base = getBaseVarName(found[1]);
    const value = props.availableVariables[base];
    if (value === undefined) { hideHoverTip(); return; }

    if (!hoverTipEl) {
      hoverTipEl = document.createElement('div');
      hoverTipEl.className = 'ak-var-hover-tip';
      document.body.appendChild(hoverTipEl);
    }
    hoverTipEl.innerHTML =
      `<span class="cm-var-tip-name"></span><span class="cm-var-tip-sep"> = </span><span class="cm-var-tip-value"></span>`;
    hoverTipEl.querySelector('.cm-var-tip-name').textContent = base;
    hoverTipEl.querySelector('.cm-var-tip-value').textContent = value;
    hoverTipEl.style.left = e.clientX + 'px';
    hoverTipEl.style.top = (e.clientY - 8) + 'px';
  });
};

// 检测主题
const checkTheme = () => {
  isDark.value = document.documentElement.classList.contains('p-dark');
};

let themeObserver = null;
let resizeObserver = null;

// 在 <tag>|</tag> 中按 Enter 时展开为三行，中间行相对父节点缩进一级，
// 并把光标留在该空行。其他位置继续使用 CodeMirror 默认的换行行为。
const xmlEnter = (cm) => {
  if (
    props.language !== 'xml' ||
    cm.somethingSelected() ||
    cm.listSelections().length !== 1
  ) return CodeMirror.Pass;

  const cursor = cm.getCursor();
  const pair = findXmlTagPairAtCursor(cm.getLine(cursor.line) || '', cursor.ch);
  if (!pair) return CodeMirror.Pass;

  const contentLine = cursor.line + 1;
  const closingLine = cursor.line + 2;
  cm.operation(() => {
    cm.replaceRange(
      '\n\n',
      CodeMirror.Pos(cursor.line, pair.fromCh),
      CodeMirror.Pos(cursor.line, pair.toCh),
      '+input'
    );
    // aggressive=true is required because CM5 deliberately skips empty lines
    // during smart indentation by default.
    cm.indentLine(contentLine, 'smart', true);
    cm.indentLine(closingLine, 'smart', true);
    const indentation = (cm.getLine(contentLine).match(/^\s*/) || [''])[0].length;
    cm.setCursor(contentLine, indentation);
  });
};

onMounted(() => {
  checkTheme();

  themeObserver = new MutationObserver(checkTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  });

  editor = CodeMirror(editorContainer.value, {
    value: props.modelValue || '',
    mode: props.language === 'xml' ? 'xml' : (props.language === 'text' ? null : 'jsonWithVars'),
    indentUnit: 2,
    inputStyle: 'textarea', // native IME — the whole point of using CM5
    lineNumbers: true,
    lineWrapping: false,
    matchBrackets: true,        // 高亮匹配的括号
    autoCloseBrackets: true,    // 自动闭合 {} [] ""
    autoCloseTags: props.language === 'xml',
    matchTags: props.language === 'xml' ? { bothTags: true } : false,
    styleActiveLine: true,      // 当前行高亮
    foldGutter: true,           // 代码折叠
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    readOnly: props.readOnly,
    placeholder: props.placeholder,
    theme: isDark.value ? 'dracula' : 'github-light',
    extraKeys: { Enter: xmlEnter }
  });
  editor.setSize('100%', '100%');

  applyVarOverlay();

  // v-model：用户编辑 → emit（程序化 setValue 不回传）
  editor.on('change', () => {
    if (applyingExternal) return;
    emit('update:modelValue', editor.getValue());
  });

  // 光标/内容变化 → 参数提示
  editor.on('cursorActivity', updateParameterHint);

  // 自动完成：用户输入后触发（IME 合成期间不会触发 inputRead）
  editor.on('inputRead', () => {
    if (props.readOnly) return;
    editor.showHint({ hint: variableHint, completeSingle: false });
  });

  // 变量悬浮提示
  const wrapperEl = editor.getWrapperElement();
  wrapperEl.addEventListener('mousemove', onEditorMouseMove);
  wrapperEl.addEventListener('mouseleave', hideHoverTip);
  editor.on('scroll', hideHoverTip);

  // Esc 关闭参数提示
  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && showParameterHint.value) {
      showParameterHint.value = false;
      event.preventDefault();
    }
  };
  editorContainer.value.addEventListener('keydown', handleKeyDown);

  // 在 flex 容器中初次渲染需要 refresh 才能正确布局
  nextTick(() => editor && editor.refresh());

  // 关键:JsonEditor 常挂载在未激活的 TabPanel(display:none)里,CM5 会以 0 尺寸
  // 渲染且不会自动恢复(CM6 内部有 ResizeObserver 会自动重测,CM5 没有)。当所在
  // Tab 被切换为可见、容器从 0 尺寸变为有尺寸时,refresh() 让编辑器正确布局并可编辑。
  resizeObserver = new ResizeObserver(() => {
    if (editor) editor.refresh();
  });
  resizeObserver.observe(editorContainer.value);

  onUnmounted(() => {
    if (themeObserver) themeObserver.disconnect();
    if (resizeObserver) resizeObserver.disconnect();
    if (editorContainer.value) {
      editorContainer.value.removeEventListener('keydown', handleKeyDown);
    }
    if (wrapperEl) {
      wrapperEl.removeEventListener('mousemove', onEditorMouseMove);
      wrapperEl.removeEventListener('mouseleave', hideHoverTip);
    }
    hideHoverTip();
  });
});

// 主题变化
watch(isDark, (newVal) => {
  if (editor) editor.setOption('theme', newVal ? 'dracula' : 'github-light');
});

// readOnly 变化
watch(() => props.readOnly, (val) => {
  if (editor) editor.setOption('readOnly', val);
});

watch(() => props.language, (language) => {
  if (!editor) return;
  const isXml = language === 'xml';
  editor.setOption('mode', isXml ? 'xml' : (language === 'text' ? null : 'jsonWithVars'));
  editor.setOption('autoCloseTags', isXml);
  editor.setOption('matchTags', isXml ? { bothTags: true } : false);
});

// 搜索匹配变化：更新高亮
watch(() => [props.searchMatches, props.currentMatchIndex], () => {
  updateSearchHighlights();
}, { deep: true });

// availableVariables 变化：刷新变量高亮（自动完成/悬浮在调用时读取最新值）
watch(() => props.availableVariables, () => {
  applyVarOverlay();
}, { deep: true });

// 外部值变化：同步进编辑器（保留光标，避免回传）
watch(() => props.modelValue, (newVal) => {
  const val = newVal ?? '';
  if (editor && val !== editor.getValue()) {
    applyingExternal = true;
    const cursor = editor.getCursor();
    // 用 replaceRange 整体替换而非 setValue：CM5 的 setValue() 会清空 undo 历史，
    // 导致 Beautify 等外部就地修改后无法撤回。replaceRange 保留历史，使其可撤回。
    editor.operation(() => {
      const lastLine = editor.lastLine();
      editor.replaceRange(
        val,
        { line: 0, ch: 0 },
        { line: lastLine, ch: editor.getLine(lastLine).length }
      );
    });
    try { editor.setCursor(cursor); } catch { /* out of range after shrink */ }
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

defineExpose({ undo, redo, focus });
</script>

<template>
  <div class="json-editor-wrapper relative">
    <div
      ref="editorContainer"
      class="json-editor-container border border-surface-300 dark:border-surface-700 rounded"
      @keydown.capture="onContainerKeydown"
    ></div>

    <!-- Parameter Hint Panel -->
    <div
      v-if="showParameterHint && parameterHints[parameterHintContent]"
      ref="parameterHintPanel"
      class="absolute z-50 bg-surface-0 dark:bg-surface-900 border border-primary-300 dark:border-primary-700 rounded shadow-lg p-4 min-w-96 max-w-2xl"
      :style="{ top: hintPosition.top + 'px', left: hintPosition.left + 'px' }"
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
}

:deep(.CodeMirror) {
  height: 100%;
  font-size: 14px;
  font-family: 'JetBrains Mono Variable', 'JetBrains Mono', Consolas, 'Courier New', monospace;
  line-height: 22px;
}

/* Variable highlight marks (set by the overlay) */
:deep(.cm-var-valid) {
  color: #d97706 !important;
  font-weight: 500;
}

:deep(.cm-var-invalid) {
  color: #dc2626 !important;
  font-weight: 500;
}

/*
  github-light 主题（CM5 复刻）。
  CM5 不自带 github 主题，@uiw 的 githubLight 是 CM6 专用扩展无法用于 CM5，
  因此用 @uiw githubLight 的真实调色板在 CM5 主题体系里复刻一份，观感与 CM6 时一致。
  default 主题字符串为暗红(#a11)、整片偏红且与变量红撞色 —— 这里彻底替换。
  dracula(暗色)自带完整配色，不需覆盖。
*/
:deep(.cm-s-github-light.CodeMirror) {
  background: #fff;
  color: #24292e;
}
:deep(.cm-s-github-light .CodeMirror-gutters) {
  background: #fff;
  border-right: 1px solid #eaecef;
}
:deep(.cm-s-github-light .CodeMirror-linenumber) { color: #6e7781; }
:deep(.cm-s-github-light .CodeMirror-cursor) { border-left: 1px solid #24292e; }
:deep(.cm-s-github-light .CodeMirror-selected) { background: #BBDFFF; }
:deep(.cm-s-github-light.CodeMirror-focused .CodeMirror-selected) { background: #BBDFFF; }
:deep(.cm-s-github-light .CodeMirror-activeline-background) { background: #f6f8fa; }
:deep(.cm-s-github-light .CodeMirror-matchingbracket) {
  color: #24292e !important;
  border-bottom: 1px solid #24292e;
}
/* 语法 token —— @uiw githubLight 调色板 */
:deep(.cm-s-github-light .cm-string)     { color: #032f62; }  /* 字符串值 - 深蓝 */
/* XML mode: tag names, angle brackets, and attribute names are distinct tokens. */
:deep(.cm-s-github-light .cm-tag)        { color: #22863a; }  /* 标签名 - 绿 */
:deep(.cm-s-github-light .cm-bracket)    { color: #24292e; }  /* < > / - 前景色 */
:deep(.cm-s-github-light .cm-attribute)  { color: #6f42c1; }  /* 属性名 - 紫 */
/*
  JSON 模式下键被标为 `cm-string cm-property` 两个类(javascript.js: cx.style + " property")，
  值只有 cm-string。用组合选择器提高特异性，确保键稳定显示为紫色、与深蓝的值区分。
*/
:deep(.cm-s-github-light .cm-property),
:deep(.cm-s-github-light .cm-string.cm-property) { color: #6f42c1; }  /* 键名 - 紫 */
:deep(.cm-s-github-light .cm-string-2)   { color: #032f62; }
:deep(.cm-s-github-light .cm-number)     { color: #005cc5; }  /* 数字 - 蓝 */
:deep(.cm-s-github-light .cm-atom)       { color: #e36209; }  /* true/false/null - 橙 */
:deep(.cm-s-github-light .cm-keyword)    { color: #d73a49; }  /* 关键字 - 红 */
:deep(.cm-s-github-light .cm-variable)   { color: #005cc5; }
:deep(.cm-s-github-light .cm-variable-2) { color: #005cc5; }
:deep(.cm-s-github-light .cm-operator)   { color: #005cc5; }
:deep(.cm-s-github-light .cm-def)        { color: #6f42c1; }
:deep(.cm-s-github-light .cm-comment)    { color: #6a737d; }
:deep(.cm-s-github-light .cm-meta)       { color: #032f62; }
:deep(.cm-s-github-light .cm-error),
:deep(.cm-s-github-light .cm-invalidchar) { color: #cb2431; }

/* Search highlight (markText) */
:deep(.cm-searchMatch) {
  background-color: #fef08a;
  color: #000;
}
:deep(.cm-searchMatch-current) {
  background-color: #fb923c;
  color: #fff;
  font-weight: bold;
}
</style>

<!--
  show-hint dropdown and the hover tooltip are rendered OUTSIDE this component's
  scoped DOM (the hint list is appended to document.body by CodeMirror; the hover
  tooltip is appended to document.body by us), so these rules must be global —
  scoped :deep() can't reach body-level nodes.
-->
<style>
/* Dark-mode search highlight (global because .p-dark lives on <html>) */
.p-dark .cm-searchMatch {
  background-color: #a16207;
  color: #fff;
}
.p-dark .cm-searchMatch-current {
  background-color: #ea580c;
  color: #fff;
  font-weight: bold;
}

/* ── Autocomplete dropdown (CM5 show-hint) ──────────────────────────────── */
.CodeMirror-hints {
  z-index: 100;
  position: absolute;
  list-style: none;
  margin: 0;
  padding: 0;
  background-color: var(--p-surface-0, #fff);
  border: 1px solid var(--p-surface-300, #cbd5e1);
  border-radius: 6px;
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  min-width: 320px;
  max-height: 20em;
  overflow-y: auto;
  font-family: 'JetBrains Mono Variable', 'JetBrains Mono', Consolas, 'Courier New', monospace;
}

.p-dark .CodeMirror-hints {
  background-color: var(--p-surface-900, #0f172a);
  border-color: var(--p-surface-700, #334155);
}

.CodeMirror-hint {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 8px 12px;
  gap: 3px;
  cursor: pointer;
  color: inherit;
  white-space: normal;
}

.CodeMirror-hint-active {
  background-color: var(--ac-selected-bg, #2563eb) !important;
}

.ak-hint-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--p-primary-color, #3b82f6);
}

.CodeMirror-hint-active .ak-hint-label {
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

.CodeMirror-hint-active .ak-hint-detail {
  color: var(--ac-selected-detail-color, #dbeafe) !important;
}

/* ── Variable hover tooltip (custom, body-level) ────────────────────────── */
.ak-var-hover-tip {
  position: fixed;
  transform: translateY(-100%);
  z-index: 100;
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
  background: var(--p-surface-900, #0f172a);
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
