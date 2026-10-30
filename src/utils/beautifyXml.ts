import { XMLValidator } from 'fast-xml-parser';
import xmlFormat from 'xml-formatter';

export interface XmlSyntaxError {
  message: string;
  /** 1-based */
  line: number;
  /** 1-based */
  column: number;
}

const NAME_START = /[\p{L}_:]/u;
const ENTITY_REFERENCE = /^&(#\d+|#x[\da-fA-F]+|[\p{L}_:][\p{L}\d_:.-]*);/u;

const positionAt = (text: string, offset: number): { line: number; column: number } => {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
};

const offsetAt = (text: string, line: number, column: number): number => {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const newline = text.indexOf('\n', offset);
    if (newline === -1) break;
    offset = newline + 1;
  }
  return offset + column - 1;
};

// 跳过注释、CDATA、处理指令和 DOCTYPE 这类不含普通文本的片段，返回结束位置；不是这类片段时返回 -1。
// 未闭合时返回文本末尾。
const skipMarkup = (xml: string, start: number): number => {
  const enclosures: Array<[string, string]> = [['<!--', '-->'], ['<![CDATA[', ']]>'], ['<?', '?>']];
  for (const [open, close] of enclosures) {
    if (!xml.startsWith(open, start)) continue;
    const end = xml.indexOf(close, start + open.length);
    return end === -1 ? xml.length : end + close.length;
  }
  if (!xml.startsWith('<!', start)) return -1;

  // DOCTYPE 等声明：内部子集 [...] 里可能有 >
  let depth = 0;
  for (let i = start + 2; i < xml.length; i++) {
    if (xml[i] === '[') depth += 1;
    else if (xml[i] === ']') depth -= 1;
    else if (xml[i] === '>' && depth <= 0) return i + 1;
  }
  return xml.length;
};

/**
 * 找出文本和属性值里没有转义的 & 和 <，以及未声明的实体引用。
 * fast-xml-parser 不检查属性值里的 & / <，也不检查实体是否声明，这里补上。
 */
const findReferenceError = (xml: string): { message: string; offset: number } | null => {
  const knownEntities = new Set(['amp', 'apos', 'gt', 'lt', 'quot']);
  for (const match of xml.matchAll(/<!ENTITY\s+([\p{L}_:][\p{L}\d_:.-]*)\s+/gu)) {
    knownEntities.add(match[1]);
  }

  const checkAmpersand = (offset: number): { message: string; offset: number } | null => {
    const reference = xml.slice(offset).match(ENTITY_REFERENCE);
    if (!reference) return { message: "Bare '&' must be escaped as &amp;", offset };
    const name = reference[1];
    if (!name.startsWith('#') && !knownEntities.has(name)) {
      return { message: `Undeclared entity &${name};`, offset };
    }
    return null;
  };

  let quote = '';
  let inTag = false;
  for (let i = 0; i < xml.length; i++) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = '';
      else if (ch === '<') return { message: "'<' in an attribute value must be escaped as &lt;", offset: i };
      else if (ch === '&') {
        const error = checkAmpersand(i);
        if (error) return error;
      }
      continue;
    }
    if (inTag) {
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') inTag = false;
      continue;
    }
    if (ch === '<') {
      const end = skipMarkup(xml, i);
      if (end !== -1) { i = end - 1; continue; }
      inTag = true;
      continue;
    }
    if (ch === '&') {
      const error = checkAmpersand(i);
      if (error) return error;
    }
  }
  return null;
};

/** 校验 XML，返回第一处错误的位置（行列号从 1 开始）；合法时返回 null。 */
export const findXmlSyntaxError = (xml: string): XmlSyntaxError | null => {
  const errors: Array<{ message: string; offset: number }> = [];

  const referenceError = findReferenceError(xml);
  if (referenceError) errors.push(referenceError);
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (validation !== true) {
    errors.push({ message: validation.err.msg, offset: offsetAt(xml, validation.err.line, validation.err.col) });
  }
  if (errors.length === 0) return null;

  // 两边都报错时取靠前的一处；同一位置时自己的提示更具体
  const first = errors.reduce((earliest, error) => (error.offset < earliest.offset ? error : earliest));
  return { message: first.message, ...positionAt(xml, first.offset) };
};

const escapeText = (xml: string, start: number): string => (ENTITY_REFERENCE.test(xml.slice(start)) ? '&' : '&amp;');

// 读取开始标签 `<name attr="v" ...>`，补全截断的属性引号和标签结尾，并转义属性值里的 & 和 <。
const readStartTag = (xml: string, start: number): { value: string; end: number; name: string; selfClosing: boolean } => {
  let i = start + 1;
  while (i < xml.length && !/[\s/>]/.test(xml[i])) i += 1;
  const name = xml.slice(start + 1, i);
  let value = xml.slice(start, i);

  while (i < xml.length) {
    const ch = xml[i];
    if (ch === '>') return { value: value + '>', end: i + 1, name, selfClosing: false };
    if (ch === '/' && xml[i + 1] === '>') return { value: value + '/>', end: i + 2, name, selfClosing: true };
    // 下一个标签开始了，说明这个标签缺少 >
    if (ch === '<') return { value: value + '>', end: i, name, selfClosing: false };

    if (ch === '"' || ch === "'") {
      const close = xml.indexOf(ch, i + 1);
      // 引号没闭合：在第一个换行、< 或 > 处补上；都没有就补在末尾
      const valueEnd = close !== -1 ? close : (() => {
        const stop = xml.slice(i + 1).search(/[\n<>]/);
        return stop === -1 ? xml.length : i + 1 + stop;
      })();
      let attrValue = '';
      for (let j = i + 1; j < valueEnd; j++) {
        if (xml[j] === '<') attrValue += '&lt;';
        else if (xml[j] === '&') attrValue += escapeText(xml, j);
        else attrValue += xml[j];
      }
      value += ch + attrValue + ch;
      i = close !== -1 ? close + 1 : valueEnd;
      continue;
    }

    value += ch;
    i += 1;
  }

  return { value: value + '>', end: xml.length, name, selfClosing: false };
};

/**
 * Beautify 前补全 XML：
 * - 未闭合的标签在末尾按嵌套顺序补上闭合标签；闭合标签错位时先补上中间未闭合的标签
 * - 截断的标签补上属性引号和 >，未闭合的注释 / CDATA / 处理指令补上结尾
 * - 文本和属性值里裸露的 & 转成 &amp;，文本里裸露的 < 转成 &lt;
 */
export const repairXmlText = (xml: string): string => {
  const stack: string[] = [];
  let output = '';
  let i = 0;

  while (i < xml.length) {
    const ch = xml[i];

    if (ch === '&') {
      output += escapeText(xml, i);
      i += 1;
      continue;
    }
    if (ch !== '<') {
      output += ch;
      i += 1;
      continue;
    }

    const markupEnd = skipMarkup(xml, i);
    if (markupEnd !== -1) {
      const markup = xml.slice(i, markupEnd);
      output += markup;
      if (markupEnd === xml.length) {
        if (markup.startsWith('<!--') && !markup.endsWith('-->')) output += '-->';
        else if (markup.startsWith('<![CDATA[') && !markup.endsWith(']]>')) output += ']]>';
        else if (markup.startsWith('<?') && !markup.endsWith('?>')) output += '?>';
        else if (markup.startsWith('<!') && !markup.endsWith('>')) output += '>';
      }
      i = markupEnd;
      continue;
    }

    if (xml[i + 1] === '/') {
      const close = xml.slice(i + 2).search(/[<>]/);
      const tagEnd = close === -1 ? xml.length : i + 2 + close;
      const name = xml.slice(i + 2, tagEnd).trim();
      const depth = stack.lastIndexOf(name);
      if (depth !== -1) {
        while (stack.length - 1 > depth) output += `</${stack.pop()}>`;
        stack.pop();
      }
      output += `</${name}>`;
      i = xml[tagEnd] === '>' ? tagEnd + 1 : tagEnd;
      continue;
    }

    if (!NAME_START.test(xml[i + 1] ?? '')) {
      output += '&lt;';
      i += 1;
      continue;
    }

    const tag = readStartTag(xml, i);
    output += tag.value;
    if (!tag.selfClosing) stack.push(tag.name);
    i = tag.end;
  }

  while (stack.length > 0) output += `</${stack.pop()}>`;
  return output;
};

export const beautifyXmlText = (xml: string): string => {
  const source = repairXmlText(String(xml || '').trim());
  if (!source) throw new Error('No valid XML content found to beautify');

  const error = findXmlSyntaxError(source);
  if (error) {
    throw new Error(`Invalid XML: ${error.message} (line ${error.line}, column ${error.column})`);
  }

  return xmlFormat(source, {
    indentation: '  ',
    lineSeparator: '\n',
    collapseContent: true,
    throwOnFailure: true,
    strictMode: true,
  });
};
