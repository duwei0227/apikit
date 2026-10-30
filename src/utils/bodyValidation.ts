// 发送前校验 JSON / XML 请求体：校验的是实际要发出去的内容（JSON 去掉注释、变量替换后），
// 但错误位置换算回编辑器里的原文，便于定位。
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { findXmlSyntaxError } from './beautifyXml';

export interface BodySyntaxError {
  message: string;
  /** 1-based, in the editor text */
  line: number;
  /** 1-based, in the editor text */
  column: number;
  /** 出错位置所在的 `{{变量}}`，错误可能来自变量的值 */
  placeholder?: string;
}

/** 返回一个 `{{变量}}` 替换后的文本；inString 表示占位符位于 JSON 字符串内 */
export type PlaceholderResolver = (placeholder: string, context: { inString: boolean }) => string;

// 与变量解析器（services/variables/resolver.ts）的匹配规则一致
const PLACEHOLDER = /\{\{[^}]+\}\}/y;

interface Segment {
  outputStart: number;
  sourceStart: number;
  sourceEnd: number;
  placeholder?: string;
}

interface MappedText {
  text: string;
  segments: Segment[];
}

/**
 * 替换 `{{变量}}` 并记录每段替换后文本对应的原文位置。
 * json 为 true 时跟踪 JSON 字符串状态，告诉 resolver 占位符是否在字符串内。
 */
const substitutePlaceholders = (source: string, resolve: PlaceholderResolver, json: boolean): MappedText => {
  const segments: Segment[] = [];
  let text = '';
  let plainStart = 0;
  let inString = false;

  const flushPlain = (end: number) => {
    if (end <= plainStart) return;
    segments.push({ outputStart: text.length, sourceStart: plainStart, sourceEnd: end });
    text += source.slice(plainStart, end);
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (json && inString && ch === '\\') { i += 1; continue; }
    if (json && ch === '"') { inString = !inString; continue; }
    if (ch !== '{' || source[i + 1] !== '{') continue;

    PLACEHOLDER.lastIndex = i;
    const match = PLACEHOLDER.exec(source);
    if (!match) continue;
    flushPlain(i);
    const end = i + match[0].length;
    segments.push({ outputStart: text.length, sourceStart: i, sourceEnd: end, placeholder: match[0] });
    text += resolve(match[0], { inString });
    plainStart = end;
    i = end - 1;
  }
  flushPlain(source.length);
  return { text, segments };
};

const toSourceOffset = ({ segments }: MappedText, outputOffset: number): { offset: number; placeholder?: string } => {
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index];
    if (outputOffset < segment.outputStart) continue;
    if (segment.placeholder) return { offset: segment.sourceStart, placeholder: segment.placeholder };
    return { offset: Math.min(segment.sourceStart + outputOffset - segment.outputStart, segment.sourceEnd) };
  }
  return { offset: 0 };
};

const positionAt = (text: string, offset: number): { line: number; column: number } => {
  const before = text.slice(0, offset);
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
};

/**
 * 把注释换成等长空白（保留换行），位置不变。与发送时的 stripJsonComments 一致：
 * 有注释时，注释掉最后一项后留在 `}` / `]` 前的逗号也一并去掉。
 */
const blankJsonComments = (text: string): string => {
  const chars = text.split('');
  let hasComment = false;
  let inString = false;

  const blank = (start: number, end: number) => {
    for (let i = start; i < end; i++) if (chars[i] !== '\n') chars[i] = ' ';
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"' || ch === '\n') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch !== '/' || (text[i + 1] !== '/' && text[i + 1] !== '*')) continue;

    hasComment = true;
    const close = text[i + 1] === '/' ? text.indexOf('\n', i) : text.indexOf('*/', i + 2);
    const end = close === -1 ? text.length : (text[i + 1] === '/' ? close : close + 2);
    blank(i, end);
    i = end - 1;
  }
  if (!hasComment) return text;

  const blanked = chars.join('');
  inString = false;
  for (let i = 0; i < blanked.length; i++) {
    const ch = blanked[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch !== ',') continue;
    const next = blanked.slice(i + 1).search(/\S/);
    const nextChar = next === -1 ? '' : blanked[i + 1 + next];
    if (nextChar === '}' || nextChar === ']') chars[i] = ' ';
  }
  return chars.join('');
};

// `CommaExpected` → `Comma expected`
const describeJsonError = (error: ParseError): string => {
  const words = printParseErrorCode(error.error).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const findJsonError = (text: string): { message: string; offset: number } | null => {
  const errors: ParseError[] = [];
  parse(text, errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: true });
  if (errors.length === 0) return null;
  return { message: describeJsonError(errors[0]), offset: errors[0].offset };
};

/** 校验 JSON / XML 请求体，返回第一处错误（位置对应编辑器原文）；合法或为空时返回 null。 */
export const validateRawBody = (
  type: 'json' | 'xml',
  raw: string,
  resolve: PlaceholderResolver,
): BodySyntaxError | null => {
  if (!raw.trim()) return null;

  const isJson = type === 'json';
  const prepared = isJson ? blankJsonComments(raw) : raw;
  const mapped = substitutePlaceholders(prepared, resolve, isJson);

  let outputOffset: number;
  let message: string;
  if (isJson) {
    const error = findJsonError(mapped.text);
    if (!error) return null;
    ({ message, offset: outputOffset } = error);
  } else {
    if (!mapped.text.trim()) return null;
    const error = findXmlSyntaxError(mapped.text);
    if (!error) return null;
    message = error.message;
    const lines = mapped.text.split('\n');
    outputOffset = lines.slice(0, error.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + error.column - 1;
  }

  const { offset, placeholder } = toSourceOffset(mapped, outputOffset);
  return { message, ...positionAt(raw, offset), ...(placeholder ? { placeholder } : {}) };
};

/** 只检查语法时用的占位值：字符串里换成空，字符串外换成 ""，保证变量本身不会导致报错 */
export const neutralPlaceholder: PlaceholderResolver = (_placeholder, { inString }) => (inString ? '' : '""');
