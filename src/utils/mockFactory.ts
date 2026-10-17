// 新建和规范化 Mock 服务、路由、响应、规则（读取的文件可能来自旧版本或被手工修改）

import type {
  HttpMethod,
  KeyValue,
  MockBodyMode,
  MockResponse,
  MockRoute,
  MockRule,
  MockRuleOperator,
  MockRuleSource,
  MockService,
} from '@/types/models';
import { cloneJson } from '@/utils/clone';
import { generateId } from '@/utils/id-generator';
import { normalizeMockPath } from '@/utils/mockMatching';

export const DEFAULT_MOCK_PORT = 3001;
export const MOCK_HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const MOCK_RULE_SOURCES: MockRuleSource[] = ['query', 'header', 'path', 'body', 'cookie'];
export const MOCK_RULE_OPERATORS: MockRuleOperator[] = ['equals', 'notEquals', 'contains', 'regex', 'exists', 'notExists'];
const BODY_MODES: MockBodyMode[] = ['json', 'template', 'text'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (
  options.includes(value as T) ? (value as T) : fallback
);
const integer = (value: unknown, fallback: number, min: number, max: number) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};

export function createMockRule(overrides: Partial<MockRule> = {}): MockRule {
  return { id: generateId(), source: 'query', key: '', operator: 'equals', value: '', ...overrides };
}

export function createMockResponse(overrides: Partial<MockResponse> = {}): MockResponse {
  return {
    id: generateId(),
    name: 'Success',
    status: 200,
    headers: [],
    bodyMode: 'json',
    body: '',
    delayMs: null,
    isDefault: false,
    ruleLogic: 'all',
    rules: [],
    ...overrides,
  };
}

export function createMockRoute(overrides: Partial<MockRoute> = {}): MockRoute {
  return {
    id: generateId(),
    method: 'GET',
    path: '/',
    enabled: true,
    responses: [createMockResponse({ isDefault: true })],
    ...overrides,
  };
}

/**
 * 复制路由：副本停用，路径末尾加 -copy（已有同方法同路径的路由时再加序号），
 * 避免和原路由同时匹配同一请求。
 */
export function duplicateMockRoute(route: MockRoute, routes: MockRoute[]): MockRoute {
  const base = normalizeMockPath(route.path);
  const taken = new Set(routes.filter(item => item.method === route.method).map(item => normalizeMockPath(item.path)));
  const stem = base === '/' ? '/copy' : `${base}-copy`;
  let path = stem;
  for (let n = 2; taken.has(path); n++) path = `${stem}-${n}`;
  return {
    ...cloneJson(route),
    id: generateId(),
    path,
    enabled: false,
    responses: route.responses.map(response => ({
      ...cloneJson(response),
      id: generateId(),
      rules: response.rules.map(rule => ({ ...rule, id: generateId() })),
    })),
  };
}

export function createMockService(overrides: Partial<MockService> = {}): MockService {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name: 'Mock Service',
    port: DEFAULT_MOCK_PORT,
    autoStart: false,
    cors: true,
    defaultDelayMs: 0,
    routes: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function normalizeHeaders(value: unknown): KeyValue[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map(header => ({
    key: text(header.key),
    value: text(header.value),
    enabled: header.enabled !== false,
  }));
}

function normalizeRule(value: unknown): MockRule | null {
  if (!isRecord(value)) return null;
  return {
    id: text(value.id) || generateId(),
    source: oneOf(value.source, MOCK_RULE_SOURCES, 'query'),
    key: text(value.key),
    operator: oneOf(value.operator, MOCK_RULE_OPERATORS, 'equals'),
    value: text(value.value),
  };
}

function normalizeResponse(value: unknown): MockResponse | null {
  if (!isRecord(value)) return null;
  return {
    id: text(value.id) || generateId(),
    name: text(value.name, 'Response'),
    status: integer(value.status, 200, 100, 599),
    headers: normalizeHeaders(value.headers),
    bodyMode: oneOf(value.bodyMode, BODY_MODES, 'json'),
    body: text(value.body),
    delayMs: value.delayMs === null || value.delayMs === undefined ? null : integer(value.delayMs, 0, 0, 60000),
    isDefault: value.isDefault === true,
    ruleLogic: value.ruleLogic === 'any' ? 'any' : 'all',
    rules: (Array.isArray(value.rules) ? value.rules : []).map(normalizeRule).filter((rule): rule is MockRule => rule !== null),
  };
}

function normalizeRoute(value: unknown): MockRoute | null {
  if (!isRecord(value)) return null;
  return {
    id: text(value.id) || generateId(),
    method: oneOf(text(value.method).toUpperCase(), MOCK_HTTP_METHODS, 'GET'),
    path: normalizeMockPath(text(value.path, '/')),
    enabled: value.enabled !== false,
    responses: (Array.isArray(value.responses) ? value.responses : [])
      .map(normalizeResponse)
      .filter((response): response is MockResponse => response !== null),
  };
}

export function normalizeMockService(value: unknown): MockService | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
  const now = new Date().toISOString();
  return {
    id: value.id,
    name: text(value.name, 'Mock Service') || 'Mock Service',
    port: integer(value.port, DEFAULT_MOCK_PORT, 1, 65535),
    autoStart: value.autoStart === true,
    cors: value.cors !== false,
    defaultDelayMs: integer(value.defaultDelayMs, 0, 0, 60000),
    routes: (Array.isArray(value.routes) ? value.routes : []).map(normalizeRoute).filter((route): route is MockRoute => route !== null),
    createdAt: text(value.createdAt, now),
    updatedAt: text(value.updatedAt, now),
  };
}

/** 新服务默认用的端口：从 3001 起第一个没被其它服务占用的端口 */
export function nextFreeMockPort(services: Pick<MockService, 'port'>[]): number {
  const used = new Set(services.map(service => service.port));
  let port = DEFAULT_MOCK_PORT;
  while (used.has(port) && port < 65535) port++;
  return port;
}

/** 复制服务：服务、路由、响应和规则都换新的 id */
export function duplicateMockService(service: MockService, name: string, port: number): MockService {
  const now = new Date().toISOString();
  return {
    ...service,
    id: generateId(),
    name,
    port,
    autoStart: false,
    createdAt: now,
    updatedAt: now,
    routes: service.routes.map(route => ({
      ...route,
      id: generateId(),
      responses: route.responses.map(response => ({
        ...response,
        id: generateId(),
        headers: response.headers.map(header => ({ ...header })),
        rules: response.rules.map(rule => ({ ...rule, id: generateId() })),
      })),
    })),
  };
}
