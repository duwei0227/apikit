// Mock 服务的路由匹配和响应选择（纯函数）。
// 路由按「方法 + 路径」匹配，路径参数写作 :id、{id} 或 {{id}}，* 匹配任意一段；多条路由都匹配时取静态段最多的。
// 响应的选择顺序：请求头 x-mock-response-name / x-mock-response-code → 第一个规则满足的响应 → 默认响应。

import type { MockResponse, MockRoute, MockRule } from '@/types/models';
import { extractValueFromJsonPath } from '@/utils/jsonPath';
import { compareValues } from '@/utils/valueComparison';

export const MOCK_RESPONSE_NAME_HEADER = 'x-mock-response-name';
export const MOCK_RESPONSE_CODE_HEADER = 'x-mock-response-code';

/** Mock 服务收到的一次请求，已解析好各部分 */
export interface MockRequestData {
  method: string;
  path: string;
  query: Record<string, string>;
  /** 键为小写 */
  headers: Record<string, string>;
  cookies: Record<string, string>;
  /** 路由的路径参数，匹配路由后填入 */
  params: Record<string, string>;
  body: string;
  /** body 按 JSON 解析的结果；不是 JSON 时为 undefined */
  json: unknown;
}

export function parseQueryString(query: string): Record<string, string> {
  const result: Record<string, string> = {};
  new URLSearchParams(query).forEach((value, key) => {
    if (!(key in result)) result[key] = value;
  });
  return result;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  (header || '').split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index <= 0) return;
    const key = part.slice(0, index).trim();
    if (key && !(key in result)) result[key] = part.slice(index + 1).trim();
  });
  return result;
}

const tryParseJson = (text: string): unknown => {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export function buildMockRequestData(input: {
  method: string;
  path: string;
  query: string;
  headers: Array<[string, string]>;
  body: string;
}): MockRequestData {
  const headers: Record<string, string> = {};
  input.headers.forEach(([key, value]) => {
    const name = key.toLowerCase();
    headers[name] = name in headers ? `${headers[name]}, ${value}` : value;
  });
  return {
    method: input.method.toUpperCase(),
    path: input.path,
    query: parseQueryString(input.query),
    headers,
    cookies: parseCookies(headers.cookie),
    params: {},
    body: input.body,
    json: tryParseJson(input.body),
  };
}

/**
 * 把填写的请求地址拆成路径和查询参数：可以是 /orders/1?page=2，也可以是带协议和主机的完整地址
 * （如 Copy URL 复制的 http://127.0.0.1:3001/orders/1），协议和主机会去掉。
 */
export function splitMockRequestTarget(target: string): { path: string; query: string } {
  let text = target.trim().split('#')[0];
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?]*/i, '');
  // 不带协议的 主机:端口/路径
  text = text.replace(/^[^/?]*:\d+(?=[/?]|$)/, '');
  const index = text.indexOf('?');
  return index < 0 ? { path: text, query: '' } : { path: text.slice(0, index), query: text.slice(index + 1) };
}

/** 统一为以 / 开头、不以 / 结尾（根路径除外）、不带查询参数的路径 */
export function normalizeMockPath(path: string): string {
  let result = (path || '').trim().split(/[?#]/)[0];
  if (!result.startsWith('/')) result = `/${result}`;
  result = result.replace(/\/{2,}/g, '/');
  if (result.length > 1) result = result.replace(/\/+$/, '');
  return result;
}

const segmentsOf = (path: string) => normalizeMockPath(path).split('/').filter(Boolean);

const paramName = (segment: string): string | null => {
  if (segment.startsWith(':') && segment.length > 1) return segment.slice(1);
  const braced = segment.match(/^\{\{\s*([^{}]+?)\s*\}\}$/) || segment.match(/^\{([^{}]+)\}$/);
  return braced ? braced[1] : null;
};

const decodeSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** 路径匹配时返回路径参数，不匹配时返回 null */
export function matchMockPath(pattern: string, path: string): Record<string, string> | null {
  const expected = segmentsOf(pattern);
  const actual = segmentsOf(path);
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < expected.length; i++) {
    const name = paramName(expected[i]);
    if (name) {
      params[name] = decodeSegment(actual[i]);
    } else if (expected[i] !== '*' && expected[i] !== actual[i] && expected[i] !== decodeSegment(actual[i])) {
      return null;
    }
  }
  return params;
}

/** 把路径参数和 * 换成示例值 1，得到可以直接访问的路径，例如 /orders/:id → /orders/1 */
export const mockExamplePath = (pattern: string) => `/${segmentsOf(pattern)
  .map(segment => (paramName(segment) || segment === '*' ? '1' : segment))
  .join('/')}`;

const staticSegmentCount = (pattern: string) => segmentsOf(pattern).filter(segment => !paramName(segment) && segment !== '*').length;

export interface MockRouteMatch {
  route: MockRoute;
  params: Record<string, string>;
}

export function findMockRoute(routes: MockRoute[], method: string, path: string): MockRouteMatch | null {
  let best: (MockRouteMatch & { score: number }) | null = null;
  for (const route of routes) {
    if (!route.enabled || route.method !== method.toUpperCase()) continue;
    const params = matchMockPath(route.path, path);
    if (!params) continue;
    const score = staticSegmentCount(route.path);
    if (!best || score > best.score) best = { route, params, score };
  }
  return best ? { route: best.route, params: best.params } : null;
}

export function ruleActualValue(rule: MockRule, request: MockRequestData): unknown {
  const key = rule.key.trim();
  switch (rule.source) {
    case 'query':
      return request.query[key];
    case 'header':
      return request.headers[key.toLowerCase()];
    case 'path':
      return request.params[key];
    case 'cookie':
      return request.cookies[key];
    case 'body':
      if (!key || key === '$') return request.body || undefined;
      return request.json === undefined ? undefined : extractValueFromJsonPath(request.json, key);
    default:
      return undefined;
  }
}

export function evaluateMockRule(rule: MockRule, request: MockRequestData): boolean {
  const actual = ruleActualValue(rule, request);
  if (rule.operator === 'regex') {
    if (actual === undefined || actual === null) return false;
    try {
      return new RegExp(rule.value).test(typeof actual === 'object' ? JSON.stringify(actual) : String(actual));
    } catch {
      return false;
    }
  }
  return compareValues(actual, rule.operator, rule.value);
}

export function responseRulesMatch(response: MockResponse, request: MockRequestData): boolean {
  if (response.rules.length === 0) return false;
  return response.ruleLogic === 'any'
    ? response.rules.some(rule => evaluateMockRule(rule, request))
    : response.rules.every(rule => evaluateMockRule(rule, request));
}

export type MockResponsePick = 'header' | 'rules' | 'default';

export interface MockResponseSelection {
  response: MockResponse;
  pickedBy: MockResponsePick;
}

/** 没有其它响应满足规则时返回的响应：标为默认的，否则第一个没有规则的 */
export function defaultMockResponse(route: MockRoute): MockResponse | null {
  return route.responses.find(response => response.isDefault)
    || route.responses.find(response => response.rules.length === 0)
    || null;
}

export function selectMockResponse(route: MockRoute, request: MockRequestData): MockResponseSelection | null {
  const wantedName = request.headers[MOCK_RESPONSE_NAME_HEADER]?.trim();
  if (wantedName) {
    const byName = route.responses.find(response => response.name.trim().toLowerCase() === wantedName.toLowerCase());
    if (byName) return { response: byName, pickedBy: 'header' };
  }
  const wantedCode = Number(request.headers[MOCK_RESPONSE_CODE_HEADER]);
  if (Number.isInteger(wantedCode) && wantedCode > 0) {
    const byCode = route.responses.find(response => response.status === wantedCode);
    if (byCode) return { response: byCode, pickedBy: 'header' };
  }

  const byRules = route.responses.find(response => responseRulesMatch(response, request));
  if (byRules) return { response: byRules, pickedBy: 'rules' };

  const fallback = defaultMockResponse(route);
  return fallback ? { response: fallback, pickedBy: 'default' } : null;
}

/** 路由在列表和日志中的名称，例如 "GET /orders/:id" */
export const mockRouteLabel = (route: Pick<MockRoute, 'method' | 'path'>) => `${route.method} ${normalizeMockPath(route.path)}`;
