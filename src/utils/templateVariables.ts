// 模板变量 {{name}} 的编辑辅助：参数提示数据、补全列表、光标处变量查找。
// 只处理文本，不依赖具体编辑器，供 JsonEditor 使用。

export interface ParameterHint {
  title: string;
  description: string;
  examples: Array<{ syntax: string; desc: string }>;
  params: Array<{ name: string; type: string; default: string; desc: string }>;
}

export interface VariableCompletion {
  /** 变量名，例如 token、$timestamp */
  name: string;
  /** 内置变量显示用法说明，其他变量显示当前值 */
  detail: string;
  isBuiltIn: boolean;
}

// 参数提示信息（与 VariableInput 保持一致）
export const PARAMETER_HINTS: Record<string, ParameterHint> = {
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
      { name: 'format / fmt', type: 'string', default: '"yyyyMMdd"', desc: 'Date format (yyyy=year, MM=month, dd=day)' }
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
      { name: 'format / fmt', type: 'string', default: '"HHmmss"', desc: 'Time format (HH=hours, mm=minutes, ss=seconds)' }
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
      { name: 'format / fmt', type: 'string', default: '"yyyyMMddHHmmss"', desc: 'Datetime format' }
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

export const BUILT_IN_VARIABLE_SYNTAX: Record<string, string> = {
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
  '$loopIndex': 'Current iteration of the innermost Workflow loop, starting at 1 (only inside Workflow loops)',
  '$sequence': '$sequence, $sequence(100), $sequence(start=100), $sequence(step=10), or $sequence(name=myseq, start=100, step=10) - Auto-increment'
};

/** 带参数的 {{$func(...)}} 取函数名，例如 "$sequence(start=1)" → "$sequence" */
export const getBaseVarName = (content: string) => content.trim().split('(')[0].trim();

/** 光标是否在 {{$func( 的参数中；是则返回有参数提示的函数名 */
export function findParameterHint(text: string, cursorPos: number): string | null {
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
      if (PARAMETER_HINTS[funcName]) {
        return funcName;
      }
    }
  }

  return null;
}

/** 光标前同一行是否有未闭合的 {{；有则返回 {{ 的位置和已输入的前缀 */
export function findOpenTemplate(lineBeforeCursor: string): { openIndex: number; prefix: string } | null {
  const openIndex = lineBeforeCursor.lastIndexOf('{{');
  if (openIndex === -1) return null;
  const prefix = lineBeforeCursor.slice(openIndex + 2);
  if (prefix.includes('}}')) return null;
  return { openIndex, prefix };
}

/**
 * 补全列表：名称包含前缀（不区分大小写）的变量，内置变量在前。
 * 以 . 结尾的项（如 $request.headers.）已完整输入时不再列出，接着输入的是名称
 */
export function buildVariableCompletions(availableVariables: Record<string, unknown>, prefix: string): VariableCompletion[] {
  const builtInVars: VariableCompletion[] = [];
  const userVars: VariableCompletion[] = [];
  Object.entries(availableVariables).forEach(([key, value]) => {
    if (key.endsWith('.') && key === prefix) return;
    if (!prefix || key.toLowerCase().includes(prefix.toLowerCase())) {
      const isBuiltIn = key.startsWith('$');
      const detail = isBuiltIn
        ? (BUILT_IN_VARIABLE_SYNTAX[key] || String(value))
        : `= ${String(value)}`;
      (isBuiltIn ? builtInVars : userVars).push({ name: key, detail, isBuiltIn });
    }
  });
  return [...builtInVars, ...userVars];
}

/** 选中补全项后插入的文本：光标后已有 }} 时不再重复 */
export const completionInsertText = (name: string, textAfterCursor: string) => (
  textAfterCursor.startsWith('}}') ? `{{${name}` : `{{${name}}}`
);

/**
 * 选中补全项后光标相对 {{ 的位置：以 . 结尾的项（如 $request.headers.）停在 . 之后、}} 之前，
 * 接着输入名称；其它停在 }} 之后
 */
export const completionCursorOffset = (name: string) => 2 + name.length + (name.endsWith('.') ? 0 : 2);

/** 一行中第 ch 列所在的 {{...}}（含两端）；返回变量名和位置 */
export function findTemplateVariableAt(line: string, ch: number): { base: string; index: number; length: number } | null {
  const regex = /\{\{([^{}]*?)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    if (ch >= match.index && ch <= match.index + match[0].length) {
      return { base: getBaseVarName(match[1]), index: match.index, length: match[0].length };
    }
  }
  return null;
}
