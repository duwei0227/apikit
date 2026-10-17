// Mock 响应体模板。
// {{$request.query.page}}、{{$request.params.id}}、{{$request.headers.x-trace}}、{{$request.cookies.sid}}、
// {{$request.body.items[0].sku}}、{{$request.method}}、{{$request.path}} 读取请求数据；`?? 默认值` 在取不到值时使用。
// {{#repeat 10}}…{{/repeat}} 把一段内容重复 n 次，副本之间用逗号连接；n 也可以来自请求，如
// {{#repeat $request.query.pageSize ?? 10}}。块内 {{$index}} 从 1 开始计数。{{$pick(a, b, c)}} 随机取一个值。
// 其它 {{变量}} 交给 resolveVariable（环境变量、全局变量和内置动态变量），每次出现单独生成。

import { parseParameters } from '@/services/variables/dynamicVariables';
import { extractValueFromJsonPath } from '@/utils/jsonPath';
import type { MockRequestData } from '@/utils/mockMatching';

export const MAX_MOCK_REPEAT = 1000;

export interface MockTemplateContext {
  request: MockRequestData;
  /** 解析其它变量；返回 undefined 时保留原文 */
  resolveVariable: (name: string) => string | undefined;
}

type TemplateNode =
  | { kind: 'text'; text: string }
  | { kind: 'tag'; expr: string; raw: string }
  | { kind: 'repeat'; expr: string; raw: string; children: TemplateNode[] };

const TAG_PATTERN = /\{\{([\s\S]*?)\}\}/g;

function parseTemplate(template: string): TemplateNode[] {
  const root: TemplateNode[] = [];
  const stack: Array<{ node: Extract<TemplateNode, { kind: 'repeat' }>; parent: TemplateNode[] }> = [];
  let current = root;
  let lastIndex = 0;

  for (const match of template.matchAll(TAG_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) current.push({ kind: 'text', text: template.slice(lastIndex, index) });
    lastIndex = index + match[0].length;
    const content = match[1].trim();

    if (content.startsWith('#repeat')) {
      const node = { kind: 'repeat' as const, expr: content.slice('#repeat'.length).trim(), raw: match[0], children: [] as TemplateNode[] };
      current.push(node);
      stack.push({ node, parent: current });
      current = node.children;
    } else if (content === '/repeat' && stack.length > 0) {
      current = stack.pop()!.parent;
    } else {
      current.push({ kind: 'tag', expr: content, raw: match[0] });
    }
  }
  if (lastIndex < template.length) current.push({ kind: 'text', text: template.slice(lastIndex) });

  // 没有闭合的 {{#repeat}} 按原文输出
  while (stack.length > 0) {
    const { node, parent } = stack.pop()!;
    const position = parent.indexOf(node);
    parent.splice(position, 1, { kind: 'text', text: node.raw }, ...node.children);
  }
  return root;
}

const stripQuotes = (value: string) => value.replace(/^(['"])([\s\S]*)\1$/, '$2');

const valueText = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

function requestValue(path: string, request: MockRequestData): unknown {
  const [section, ...rest] = path.split('.');
  const key = rest.join('.');
  switch (section) {
    case 'method':
      return request.method;
    case 'path':
      return request.path;
    case 'query':
      return key ? request.query[key] : request.query;
    case 'params':
      return key ? request.params[key] : request.params;
    case 'headers':
      return key ? request.headers[key.toLowerCase()] : request.headers;
    case 'cookies':
      return key ? request.cookies[key] : request.cookies;
    case 'body':
      if (!key) return request.body;
      return request.json === undefined ? undefined : extractValueFromJsonPath(request.json, key);
    default:
      return undefined;
  }
}

/** 计算一个标签的值；返回 undefined 表示保留原文 */
function evaluate(expr: string, context: MockTemplateContext, index: number | null): string | undefined {
  const fallbackAt = expr.indexOf('??');
  const name = (fallbackAt >= 0 ? expr.slice(0, fallbackAt) : expr).trim();
  const fallback = fallbackAt >= 0 ? stripQuotes(expr.slice(fallbackAt + 2).trim()) : undefined;

  let value: string | undefined;
  if (name === '$index') {
    value = index === null ? undefined : String(index);
  } else if (name.startsWith('$request.')) {
    value = valueText(requestValue(name.slice('$request.'.length), context.request));
    if (value === undefined) return fallback ?? '';
  } else if (name.startsWith('$pick')) {
    const options = parseParameters(name, '$pick')?._positional ?? [];
    value = options.length > 0 ? options[Math.floor(Math.random() * options.length)] : undefined;
  } else {
    value = context.resolveVariable(name);
  }
  return value ?? fallback;
}

function repeatCount(expr: string, context: MockTemplateContext, index: number | null): number {
  const text = /^\d+$/.test(expr) ? expr : evaluate(expr, context, index);
  const count = parseInt(text ?? '', 10);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(count, MAX_MOCK_REPEAT);
}

/** 把副本用逗号连接：逗号放在每个副本末尾的空白之前，保持缩进 */
const joinCopies = (copies: string[]) => copies
  .map((copy, i) => (i < copies.length - 1 ? copy.replace(/(\s*)$/, ',$1') : copy))
  .join('');

function renderNodes(nodes: TemplateNode[], context: MockTemplateContext, index: number | null): string {
  let output = '';
  for (const node of nodes) {
    if (node.kind === 'text') {
      output += node.text;
    } else if (node.kind === 'tag') {
      output += evaluate(node.expr, context, index) ?? node.raw;
    } else {
      const count = repeatCount(node.expr, context, index);
      const copies: string[] = [];
      for (let i = 1; i <= count; i++) copies.push(renderNodes(node.children, context, i));
      output += joinCopies(copies);
    }
  }
  return output;
}

export function renderMockTemplate(template: string, context: MockTemplateContext): string {
  if (!template || !template.includes('{{')) return template || '';
  return renderNodes(parseTemplate(template), context, null);
}
