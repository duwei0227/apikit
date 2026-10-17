// 由集合中的请求和 Console 中的真实响应生成 Mock 路由和响应（纯函数）

import type { HttpMethod, MockResponse, MockRoute } from '@/types/models';
import { createMockResponse, createMockRoute } from '@/utils/mockFactory';
import { matchMockPath, normalizeMockPath } from '@/utils/mockMatching';

/**
 * 请求 URL 对应的路由路径：去掉开头的 {{baseUrl}} 或协议和主机、查询参数，
 * 整段为 {{id}} 的路径段改为路径参数 :id。例如 {{baseUrl}}/orders/{{id}}?x=1 → /orders/:id
 */
export function mockPathFromUrl(url: string): string {
  let path = url.trim().replace(/^\{\{[^}]+\}\}/, '');
  path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');
  path = path.split(/[?#]/)[0];
  const segments = path.split('/').map(segment => {
    const variable = segment.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    return variable ? `:${variable[1].replace(/^\$/, '')}` : segment;
  });
  return normalizeMockPath(segments.join('/'));
}

/** 发送到这个路由的真实响应（来自 Console） */
export interface ObservedResponse {
  method: string;
  url: string;
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  body: string;
}

const headerValue = (headers: Record<string, string>, name: string) => (
  Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] || ''
);

/** 把真实响应转成 Mock 响应；只保留 Content-Type 响应头 */
export function mockResponseFromObserved(observed: ObservedResponse, name: string, keepHeaders = false): MockResponse {
  const contentType = headerValue(observed.headers, 'content-type');
  const isJson = !contentType || /json/i.test(contentType);
  const headers = keepHeaders
    ? Object.entries(observed.headers)
      .filter(([key]) => !/^(content-length|transfer-encoding|connection|date|content-encoding|set-cookie)$/i.test(key))
      .map(([key, value]) => ({ key, value, enabled: true }))
    : contentType && !/json/i.test(contentType) ? [{ key: 'Content-Type', value: contentType, enabled: true }] : [];
  return createMockResponse({
    name,
    status: observed.status,
    headers,
    bodyMode: isJson ? 'json' : 'text',
    body: observed.body,
  });
}

/** 这个路由最近一次的真实响应：responses 按从新到旧排列 */
export function latestObservedFor<T extends Pick<ObservedResponse, 'method' | 'url'>>(
  responses: T[],
  method: HttpMethod,
  path: string,
): T | undefined {
  return responses.find(response => response.method.toUpperCase() === method
    && matchMockPath(path, mockPathFromUrl(response.url)) !== null);
}

export interface RequestForMock {
  name: string;
  method: HttpMethod;
  url: string;
}

/** 每个请求一条路由；相同方法和路径的请求只建一条 */
export function routesFromRequests(requests: RequestForMock[]): Array<{ route: MockRoute; request: RequestForMock }> {
  const seen = new Set<string>();
  const result: Array<{ route: MockRoute; request: RequestForMock }> = [];
  for (const request of requests) {
    const path = mockPathFromUrl(request.url);
    const key = `${request.method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      request,
      route: createMockRoute({
        method: request.method,
        path,
        responses: [createMockResponse({ name: request.name || 'Success', isDefault: true })],
      }),
    });
  }
  return result;
}
