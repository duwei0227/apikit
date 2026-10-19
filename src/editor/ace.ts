// Ace 编辑器的统一入口：加载核心和所需模式，定义 ApiKit 的语言模式和主题。
// 选择 Ace 是因为它用隐藏的 <textarea> 接收输入：Windows 上 WebView2 的 contenteditable
// 与输入法（TSF）配合有问题（首字丢失、中文标点要按两次），textarea 不受影响。
// 所有模块都在这里静态导入，并关闭 worker，运行时不会再按路径下载任何文件。

import ace from 'ace-builds';
import 'ace-builds/src-noconflict/mode-json';
import 'ace-builds/src-noconflict/mode-xml';
import 'ace-builds/src-noconflict/mode-html';
import 'ace-builds/src-noconflict/mode-text';
import { getBaseVarName } from '@/utils/templateVariables';
import { bracketStateKey, colorBrackets, INITIAL_BRACKET_STATE, type BracketLanguage, type BracketState, type BracketToken } from '@/utils/bracketColors';

export { ace };
export type AceEditor = ace.Ace.Editor;

/** 搜索匹配项在文档中的位置（字符偏移） */
export interface SearchMatch {
  index: number;
  length: number;
}

export const EDITOR_FONT_FAMILY = "'JetBrains Mono Variable', 'JetBrains Mono', Consolas, 'Courier New', monospace";
export const LIGHT_THEME = 'ace/theme/apikit-light';
export const DARK_THEME = 'ace/theme/apikit-dark';

ace.config.set('loadWorkerFromBlob', false);

// Ace 的模式和高亮规则是用 oop.inherits 定义的构造函数，下面的接口描述这里用到的部分
interface HighlightRule {
  token?: string | ((value: string) => string);
  regex?: string;
  next?: string;
  defaultToken?: string;
}

interface HighlightRulesInstance {
  $rules: Record<string, HighlightRule[]>;
  normalizeRules(): void;
}

interface ModeInstance {
  HighlightRules: unknown;
}

type ModeConstructor = new () => ace.Ace.SyntaxMode;

const oop = ace.require('ace/lib/oop');
const TextHighlightRules = ace.require('ace/mode/text_highlight_rules').TextHighlightRules;
const TextMode = ace.require('ace/mode/text').Mode;
const JsonMode = ace.require('ace/mode/json').Mode;
const JsonHighlightRules = ace.require('ace/mode/json_highlight_rules').JsonHighlightRules;
const XmlMode = ace.require('ace/mode/xml').Mode;
const XmlHighlightRules = ace.require('ace/mode/xml_highlight_rules').XmlHighlightRules;
const HtmlMode = ace.require('ace/mode/html').Mode;

// ── {{变量}} 高亮 ────────────────────────────────────────────────────────────
// 在每个状态最前面加一条 {{...}} 规则：变量按是否已定义着色，并且不会被当成 JSON 的
// 对象起止符（否则会打乱后续的高亮和缩进）。字符串和键名里的变量同样着色。

const TEMPLATE_REGEX = '\\{\\{[^{}]*?\\}\\}';

const templateRule = (isKnownVariable: (name: string) => boolean) => ({
  token: (value: string) => (
    isKnownVariable(getBaseVarName(value.slice(2, -2))) ? 'template.valid' : 'template.invalid'
  ),
  regex: TEMPLATE_REGEX,
});

function addTemplateRule(rules: Record<string, HighlightRule[]>, isKnownVariable: (name: string) => boolean) {
  Object.values(rules).forEach(stateRules => stateRules.unshift(templateRule(isKnownVariable)));
}

// Ace 的 JSON 规则只认 true/false，null 也按常量着色（与原编辑器一致）
function addJsonNullRule(rules: Record<string, HighlightRule[]>, token = 'constant.language') {
  const booleanIndex = rules.start.findIndex(rule => rule.token === 'constant.language.boolean');
  rules.start.splice(booleanIndex + 1, 0, { token, regex: 'null\\b' });
}

// ── 括号按层级着色 ───────────────────────────────────────────────────────────
// 层级要跨行传递，所以放进 Ace 的行状态：每行结束的状态包成 BracketLineState（原状态 + 括号状态），
// 状态的字符串形式带上层级，某行层级变化后 Ace 会继续给后面的行重新着色。着色结果放在
// token.rainbow，渲染时才拼进 class，token.type 不变，自动配对、括号匹配和折叠不受影响。

class BracketLineState {
  constructor(readonly inner: unknown, readonly brackets: BracketState) {}
  toString() {
    return `${String(this.inner)}#${bracketStateKey(this.brackets)}`;
  }
}

interface LineTokenizer {
  getLineTokens(line: string, startState: unknown, row?: number): { tokens: BracketToken[]; state: unknown };
}

function withBracketColors<T extends ace.Ace.SyntaxMode>(mode: T, language: BracketLanguage): T {
  const getTokenizer = mode.getTokenizer.bind(mode) as unknown as () => LineTokenizer;
  let tokenizer: LineTokenizer | null = null;
  (mode as unknown as { getTokenizer: () => LineTokenizer }).getTokenizer = () => {
    if (tokenizer) return tokenizer;
    const inner = getTokenizer();
    tokenizer = Object.create(inner) as LineTokenizer;
    tokenizer.getLineTokens = (line, startState, row) => {
      const start = startState instanceof BracketLineState ? startState : null;
      const data = inner.getLineTokens(line, start ? start.inner : startState, row);
      const colored = colorBrackets(language, data.tokens, start ? start.brackets : INITIAL_BRACKET_STATE);
      return { tokens: colored.tokens, state: new BracketLineState(data.state, colored.state) };
    };
    return tokenizer;
  };
  return mode;
}

// 其他地方（缩进、注释、折叠）读到的仍是模式自己的状态
const EditSession = ace.require('ace/edit_session').EditSession;
const getState = EditSession.prototype.getState;
EditSession.prototype.getState = function (this: unknown, row: number) {
  const state = getState.call(this, row);
  return state instanceof BracketLineState ? state.inner : state;
};

const TextLayer = ace.require('ace/layer/text').Text;
const renderToken = TextLayer.prototype.$renderToken;
TextLayer.prototype.$renderToken = function (this: unknown, parent: unknown, screenColumn: number, token: BracketToken, value: string) {
  const rendered = token.rainbow ? { ...token, type: `${token.type}.${token.rainbow}` } : token;
  return renderToken.call(this, parent, screenColumn, rendered, value);
};

/** 编辑模式：json / xml / text，都能识别 {{变量}}。isKnownVariable 在每次着色时调用，变量变化后需重新着色 */
export function createTemplateMode(language: 'json' | 'xml' | 'text', isKnownVariable: (name: string) => boolean) {
  const BaseMode = language === 'json' ? JsonMode : (language === 'xml' ? XmlMode : TextMode);
  const BaseRules = language === 'json' ? JsonHighlightRules : (language === 'xml' ? XmlHighlightRules : TextHighlightRules);

  const Rules = function (this: HighlightRulesInstance) {
    BaseRules.call(this);
    if (language === 'json') {
      addJsonNullRule(this.$rules);
      // 键名原本整体是一个 token，拆成单独的状态，键名里的变量才能单独着色
      this.$rules.start[0] = { token: 'variable', regex: '"(?=(?:\\\\.|[^"\\\\])*"\\s*:)', next: 'key' };
      this.$rules.key = [
        { token: 'variable', regex: '\\\\.' },
        { token: 'variable', regex: '"', next: 'start' },
        { defaultToken: 'variable' },
      ];
    }
    // 父类只在自身构造时展开 include 和嵌套状态，子类要自己做；展开后再加规则，
    // 展开生成的状态（例如 XML 属性值）也能识别变量
    this.normalizeRules();
    addTemplateRule(this.$rules, isKnownVariable);
  };
  oop.inherits(Rules, BaseRules);

  const Mode = function (this: ModeInstance) {
    BaseMode.call(this);
    this.HighlightRules = Rules;
  };
  oop.inherits(Mode, BaseMode);
  Mode.prototype.$id = `ace/mode/apikit-${language}`;
  // 不在 worker 里做语法检查：请求体允许出现 {{变量}}，按 JSON 校验会处处报错
  Mode.prototype.createWorker = () => null;
  const mode = new (Mode as unknown as ModeConstructor)();
  return language === 'text' ? mode : withBracketColors(mode, language);
}

// ── 只读查看用的模式 ─────────────────────────────────────────────────────────

const UrlEncodedRules = function (this: HighlightRulesInstance) {
  this.$rules = {
    start: [
      { token: 'punctuation.operator', regex: '&' },
      { token: 'variable', regex: '[^=&]+(?==)' },
      { token: 'keyword.operator', regex: '=', next: 'value' },
      { token: 'variable', regex: '[^=&]+' },
    ],
    value: [
      { token: 'punctuation.operator', regex: '&', next: 'start' },
      { token: 'keyword.operator', regex: '=' },
      { token: 'string', regex: '[^&=]+' },
    ],
  };
};
oop.inherits(UrlEncodedRules, TextHighlightRules);

const UrlEncodedMode = function (this: ModeInstance) {
  TextMode.call(this);
  this.HighlightRules = UrlEncodedRules;
};
oop.inherits(UrlEncodedMode, TextMode);
UrlEncodedMode.prototype.$id = 'ace/mode/apikit-urlencoded';

const ViewerJsonRules = function (this: HighlightRulesInstance) {
  JsonHighlightRules.call(this);
  addJsonNullRule(this.$rules, 'constant.language.null');
  this.normalizeRules();
};
oop.inherits(ViewerJsonRules, JsonHighlightRules);

const ViewerJsonMode = function (this: ModeInstance) {
  JsonMode.call(this);
  this.HighlightRules = ViewerJsonRules;
};
oop.inherits(ViewerJsonMode, JsonMode);
ViewerJsonMode.prototype.$id = 'ace/mode/apikit-json-viewer';

/** 查看模式：json / xml / html / urlencoded / text */
export function createViewerMode(language: string): ace.Ace.SyntaxMode {
  let mode: ace.Ace.SyntaxMode;
  switch (language) {
    case 'json': mode = withBracketColors(new (ViewerJsonMode as unknown as ModeConstructor)(), 'json'); break;
    case 'xml': mode = withBracketColors(new XmlMode(), 'xml'); break;
    case 'html': mode = new HtmlMode(); break;
    case 'urlencoded': mode = new (UrlEncodedMode as unknown as ModeConstructor)(); break;
    default: mode = new TextMode();
  }
  mode.createWorker = () => null;
  return mode;
}

// ── 主题 ────────────────────────────────────────────────────────────────────
// 浅色沿用 GitHub Light 调色板，暗色沿用 VS Code「2026 Dark」，与原 CodeMirror 主题一致。

const themeCss = (cls: string, c: Record<string, string>) => `
.${cls} { background-color: ${c.bg}; color: ${c.fg}; }
.${cls} .ace_gutter { background: ${c.bg}; color: ${c.gutterFg}; border-right: ${c.gutterBorder}; }
.${cls} .ace_gutter-active-line { background: transparent; color: ${c.gutterActiveFg}; }
.${cls} .ace_print-margin { display: none; }
.${cls} .ace_cursor { color: ${c.caret}; }
.${cls} .ace_marker-layer .ace_selection { background: ${c.selection}; }
.${cls} .ace_marker-layer .ace_active-line { background: ${c.activeLine}; }
.${cls} .ace_marker-layer .ace_selected-word { border: 1px solid ${c.selection}; }
.${cls} .ace_marker-layer .ace_bracket { margin: 0; border: none; ${c.bracket} }
.${cls} .ace_fold { background-color: ${c.fold}; border-color: ${c.fg}; }
.${cls} .ace_fold-widget { color: ${c.gutterFg}; }
.${cls} .ace_variable { color: ${c.key}; }
.${cls} .ace_string { color: ${c.string}; }
.${cls} .ace_constant.ace_numeric { color: ${c.number}; }
.${cls} .ace_constant.ace_language { color: ${c.atom}; }
.${cls} .ace_constant.ace_language.ace_escape { color: ${c.string}; }
.${cls} .ace_paren, .${cls} .ace_punctuation { color: ${c.punctuation}; }
.${cls} .ace_comment { color: ${c.comment}; }
.${cls} .ace_keyword, .${cls} .ace_storage { color: ${c.keyword}; }
.${cls} .ace_meta.ace_tag { color: ${c.punctuation}; }
.${cls} .ace_meta.ace_tag.ace_tag-name { color: ${c.tag}; }
.${cls} .ace_entity.ace_other.ace_attribute-name { color: ${c.attribute}; }
.${cls} .ace_string.ace_attribute-value { color: ${c.string}; }
.${cls} .ace_xml-pe, .${cls} .ace_doctype { color: ${c.meta}; }
.${cls} .ace_entity.ace_other.ace_attribute-name.ace_decl-attribute-name,
.${cls} .ace_keyword.ace_operator.ace_decl-attribute-equals,
.${cls} .ace_punctuation.ace_xml-decl,
.${cls} .ace_instruction { color: ${c.meta}; }
.${cls} .ace_keyword.ace_operator.ace_attribute-equals { color: ${c.punctuation}; }
.${cls} .ace_entity.ace_name.ace_function, .${cls} .ace_support.ace_function { color: ${c.func}; }
.${cls} .ace_support.ace_constant, .${cls} .ace_support.ace_type { color: ${c.number}; }
.${cls} .ace_invalid { color: ${c.invalid}; background: none; }
.${cls} .ace_rainbow.ace_rainbow-0 { color: ${c.rainbow0}; }
.${cls} .ace_rainbow.ace_rainbow-1 { color: ${c.rainbow1}; }
.${cls} .ace_rainbow.ace_rainbow-2 { color: ${c.rainbow2}; }
.${cls} .ace_rainbow.ace_rainbow-unmatched { color: ${c.invalid}; }
.${cls} .ace_template.ace_valid { color: #d97706; font-weight: 500; }
.${cls} .ace_template.ace_invalid { color: #dc2626; font-weight: 500; }
.${cls} .ace_placeholder { color: ${c.gutterFg}; font-family: inherit; transform: none; opacity: 1; }
`;

function defineTheme(name: string, cssClass: string, isDark: boolean, colors: Record<string, string>) {
  // ace.define 不在类型声明中
  const define = (ace as unknown as {
    define: (name: string, deps: string[], factory: (require: (id: 'ace/lib/dom') => { importCssString: (css: string, id: string, append: boolean) => void }, exports: Record<string, unknown>) => void) => void;
  }).define;
  define(name, ['require', 'exports', 'module', 'ace/lib/dom'], (require, exports) => {
    exports.isDark = isDark;
    exports.cssClass = cssClass;
    exports.cssText = themeCss(cssClass, colors);
    require('ace/lib/dom').importCssString(exports.cssText as string, exports.cssClass as string, false);
  });
}

defineTheme(LIGHT_THEME, 'ace-apikit-light', false, {
  bg: '#ffffff',
  fg: '#24292e',
  caret: '#24292e',
  gutterFg: '#6e7781',
  gutterActiveFg: '#24292e',
  gutterBorder: '1px solid #eaecef',
  selection: '#BBDFFF',
  activeLine: '#f6f8fa',
  bracket: 'border-bottom: 1px solid #24292e;',
  fold: '#d0d7de',
  key: '#6f42c1',
  string: '#032f62',
  number: '#005cc5',
  atom: '#e36209',
  punctuation: '#24292e',
  comment: '#6a737d',
  keyword: '#d73a49',
  tag: '#22863a',
  attribute: '#6f42c1',
  meta: '#032f62',
  func: '#6f42c1',
  invalid: '#cb2431',
  rainbow0: '#9a6700',
  rainbow1: '#8250df',
  rainbow2: '#0969da',
});

defineTheme(DARK_THEME, 'ace-apikit-dark', true, {
  bg: '#121314',
  fg: '#bbbebf',
  caret: '#bbbebf',
  gutterFg: '#858889',
  gutterActiveFg: '#bbbebf',
  gutterBorder: 'none',
  selection: '#276782dd',
  activeLine: '#242526',
  bracket: 'background: #3994bc55;',
  fold: '#3c3d3e',
  key: '#79c0ff',
  string: '#a5d6ff',
  number: '#79c0ff',
  atom: '#79c0ff',
  punctuation: '#c9d1d9',
  comment: '#8b949e',
  keyword: '#ff7b72',
  tag: '#7ee787',
  attribute: '#79c0ff',
  meta: '#c9d1d9',
  func: '#d2a8ff',
  invalid: '#f48771',
  rainbow0: '#ffd700',
  rainbow1: '#da70d6',
  rainbow2: '#179fff',
});

// 搜索高亮（标记层，在文字下方）：普通匹配高于当前行背景，当前匹配项高于选区，始终可见
ace.require('ace/lib/dom').importCssString(`
.ace_marker-layer .ak-search-match { position: absolute; z-index: 3; background-color: #fef08a; }
.ace_marker-layer .ak-search-match-current { position: absolute; z-index: 6; background-color: #fb923c; }
.p-dark .ace_marker-layer .ak-search-match { background-color: #a16207; }
.p-dark .ace_marker-layer .ak-search-match-current { background-color: #ea580c; }
`, 'apikit-ace-search', false);

export const isDarkMode = () => document.documentElement.classList.contains('p-dark');
export const themeFor = (dark: boolean) => (dark ? DARK_THEME : LIGHT_THEME);

/** 去掉会按需下载扩展模块的命令（搜索框、跳转行、设置菜单等）；搜索由 ApiKit 自己的搜索框负责 */
export function removeUnusedCommands(editor: AceEditor) {
  ['find', 'findnext', 'findprevious', 'findAll', 'replace', 'replaceall', 'gotoline', 'showSettingsMenu',
    'openCommandPalette', 'showKeyboardShortcuts'].forEach(name => editor.commands.removeCommand(name));
}

/** 与原编辑器一致的通用外观：字体、行高、行号、当前行、括号匹配和折叠 */
export function applyBaseOptions(editor: AceEditor) {
  editor.setOptions({
    fontSize: '14px',
    fontFamily: EDITOR_FONT_FAMILY,
    showPrintMargin: false,
    displayIndentGuides: false,
    highlightActiveLine: true,
    highlightGutterLine: true,
    showFoldWidgets: true,
    fadeFoldWidgets: false,
    useSoftTabs: true,
    tabSize: 2,
    scrollPastEnd: 0,
  });
  editor.renderer.setScrollMargin(8, 8, 0, 0);
  editor.renderer.setPadding(8);
  removeUnusedCommands(editor);
  deleteSelectionBeforeComposition(editor);
}

// 选中文字后用输入法输入：组字开始前先删掉选中内容。按下输入法按键（keyCode 229）时就删除，
// 此时输入法还没开始组字；没有这个按键时在 compositionstart 里删除。
// compositionstart 的 data 是 textarea 里将被替换的选中文字，Ace 见到非空 data 会改为把组字过程
// （拼音）直接写进文档：Windows 上样式错乱、选中内容没删，撤销时还会一步步出现拼音。所以总是
// 清空 data，让 Ace 只在组字结束后插入结果。删除后要立即同步 textarea：Ace 等操作结束才同步，
// Windows 上输入法紧接着开始组字时，textarea 里还是选中的文字。
// 删除和随后组字的结果合并成一步撤销。监听都挂在容器的捕获阶段，先于 Ace 在 textarea 上的处理。
function deleteSelectionBeforeComposition(editor: AceEditor) {
  const textInput = editor.textInput as unknown as { resetSelection(): void };
  let mergeNextComposition = false;
  const deleteSelection = () => {
    if (editor.getReadOnly() || editor.selection.isEmpty()) return;
    editor.session.remove(editor.getSelectionRange());
    editor.clearSelection();
    textInput.resetSelection();
    mergeNextComposition = true;
  };
  editor.container.addEventListener('keydown', (event) => {
    if (event.keyCode === 229) deleteSelection();
  }, true);
  editor.container.addEventListener('compositionstart', (event) => {
    if (editor.getReadOnly()) return;
    deleteSelection();
    Object.defineProperty(event, 'data', { value: '' });
  }, true);
  editor.container.addEventListener('compositionend', () => {
    // mergeUndoDeltas 是 Ace 内部字段，为 true 时下一次修改并入上一步撤销
    if (mergeNextComposition) (editor.session as unknown as { mergeUndoDeltas: boolean }).mergeUndoDeltas = true;
    mergeNextComposition = false;
  }, true);
}

/** 设置只读。Ace 在只读时按键会弹出 "Editing is disabled" 提示；查看器里不需要，与原编辑器一致只是不响应 */
export function setReadOnly(editor: AceEditor, readOnly: boolean) {
  editor.setReadOnly(readOnly);
  // $readOnlyCallback 是 Ace 内部字段，不在类型声明中
  const callback = (editor as unknown as { $readOnlyCallback?: () => void }).$readOnlyCallback;
  if (!readOnly || !callback) return;
  ace.require('ace/lib/event').removeListener(editor.textInput.getElement(), 'keydown', callback);
  const commands = editor.commands as unknown as { off: (event: string, callback: () => void) => void };
  commands.off('exec', callback);
  commands.off('commandUnavailable', callback);
}
