// 处理 Mock 服务收到的请求：匹配路由、选择响应、生成响应体，并生成调用记录。
// Rust 端通过 mock://request 事件交来请求，结果通过 mock_respond 返回。

import { useEnvironmentsStore } from '@/stores/environments';
import { replaceVariables } from '@/services/variables/resolver';
import { BUILT_IN_VARIABLE_NAMES, createBuiltInValues, resolveDynamicFunction } from '@/services/variables/dynamicVariables';
import type { MockLogEntry, MockResponse, MockService } from '@/types/models';
import { generateId } from '@/utils/id-generator';
import {
  buildMockRequestData,
  findMockRoute,
  mockRouteLabel,
  selectMockResponse,
  type MockRequestData,
} from '@/utils/mockMatching';
import { renderMockTemplate } from '@/utils/mockTemplate';

/** Rust 端 mock://request 事件 */
export interface MockRequestEvent {
  id: string;
  serviceId: string;
  method: string;
  path: string;
  query: string;
  headers: Array<[string, string]>;
  body: string;
}

/** 交给 Rust 端 mock_respond 的答复 */
export interface MockReply {
  status: number;
  headers: Array<[string, string]>;
  body: string;
  delayMs: number;
}

export interface MockHandling {
  reply: MockReply;
  log: MockLogEntry;
}

/** 日志中每段 body 最多保存的字符数 */
export const MAX_MOCK_LOG_BODY = 256 * 1024;

const BUILT_IN_NAMES = new Set<string>(BUILT_IN_VARIABLE_NAMES);

/**
 * 解析模板中的其它变量：环境变量、全局变量和内置动态变量。每次出现单独生成，
 * 所以 {{#repeat}} 中的 {{$guid}} 每份各不相同。
 */
export function createMockVariableResolver(): (name: string) => string | undefined {
  const variables = useEnvironmentsStore().getAllAvailableVariables;
  return (name: string) => {
    if (name.startsWith('$sequence')) {
      const value = replaceVariables(`{{${name}}}`);
      return value === `{{${name}}}` ? undefined : value;
    }
    const now = new Date();
    const dynamic = resolveDynamicFunction(name, now);
    if (dynamic !== undefined) return dynamic;
    if (BUILT_IN_NAMES.has(name)) return createBuiltInValues(now)[name];
    return variables[name];
  };
}

const jsonError = (status: number, message: string): MockReply => ({
  status,
  headers: [['content-type', 'application/json']],
  body: JSON.stringify({ error: message }),
  delayMs: 0,
});

const validStatus = (status: number) => (Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500);

const defaultContentType = (response: MockResponse) => (
  response.bodyMode === 'text' ? 'text/plain; charset=utf-8' : 'application/json'
);

/** 按选中的响应生成答复：响应头和响应体中的 {{变量}} 都会替换 */
export function renderMockReply(
  response: MockResponse,
  service: Pick<MockService, 'defaultDelayMs'>,
  request: MockRequestData,
  resolveVariable: (name: string) => string | undefined,
): MockReply {
  const context = { request, resolveVariable };
  const headers: Array<[string, string]> = response.headers
    .filter(header => header.enabled !== false && header.key.trim())
    .map(header => [header.key.trim(), renderMockTemplate(header.value, context)]);
  if (!headers.some(([key]) => key.toLowerCase() === 'content-type')) {
    headers.push(['content-type', defaultContentType(response)]);
  }
  return {
    status: validStatus(response.status),
    headers,
    body: renderMockTemplate(response.body, context),
    delayMs: Math.max(0, response.delayMs ?? service.defaultDelayMs ?? 0),
  };
}

const truncate = (text: string) => (text.length > MAX_MOCK_LOG_BODY ? `${text.slice(0, MAX_MOCK_LOG_BODY)}\n… (truncated)` : text);

export function handleMockRequest(
  service: MockService | undefined,
  event: MockRequestEvent,
  resolveVariable: (name: string) => string | undefined,
  now: Date = new Date(),
): MockHandling {
  const started = Date.now();
  const request = buildMockRequestData(event);
  let reply: MockReply;
  let route: string | undefined;
  let responseName: string | undefined;
  let reason: string | undefined;

  const match = service ? findMockRoute(service.routes, request.method, request.path) : null;
  if (!service) {
    reason = 'This mock service no longer exists';
    reply = jsonError(503, reason);
  } else if (!match) {
    reason = `No route matches ${request.method} ${request.path}`;
    reply = jsonError(404, reason);
  } else {
    route = mockRouteLabel(match.route);
    request.params = match.params;
    const selection = selectMockResponse(match.route, request);
    if (!selection) {
      reason = `${route} has no response for this request`;
      reply = jsonError(404, reason);
    } else {
      responseName = selection.response.name;
      try {
        reply = renderMockReply(selection.response, service, request, resolveVariable);
      } catch (error) {
        reason = `Failed to build the response: ${error instanceof Error ? error.message : String(error)}`;
        reply = jsonError(500, reason);
      }
    }
  }

  const log: MockLogEntry = {
    id: generateId(),
    time: now.toISOString(),
    method: request.method,
    path: request.path,
    query: event.query,
    status: reply.status,
    route,
    responseName,
    reason,
    durationMs: Date.now() - started + reply.delayMs,
    request: { headers: event.headers, body: truncate(event.body) },
    response: { headers: reply.headers, body: truncate(reply.body) },
  };
  return { reply, log };
}
