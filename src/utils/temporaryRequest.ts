import { createEmptyBody, createEmptyRequest } from '@/utils/requestFactory';
import type { HistoryItem, HttpMethod, KeyValue, Request, RequestBody } from '@/types/models';

const createDefaultBody = () => createEmptyBody();

// 临时请求（未保存到任何 Collection）
export const createTemporaryRequest = (overrides: Partial<Request> = {}): Request => {
  const now = new Date().toISOString();
  return createEmptyRequest({
    ...overrides,
    collectionId: null,
    folderId: null,
    createdAt: now,
    updatedAt: now,
  });
};

const getHistoryRequestName = (method: string, url: string) => {
  try {
    const pathname = new URL(url).pathname;
    return `${method} ${pathname || '/'}`;
  } catch {
    return `${method} Request`;
  }
};

const decodeFormComponent = (text: string) => {
  const value = text.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

// a=1&b=2：每段按第一个 = 分成键和值，值中可以再有 =
const parseUrlencoded = (text: string): KeyValue[] => text.split('&').filter(Boolean).map(pair => {
  const separator = pair.indexOf('=');
  const key = separator === -1 ? pair : pair.slice(0, separator);
  const value = separator === -1 ? '' : pair.slice(separator + 1);
  return { key: decodeFormComponent(key), value: decodeFormComponent(value), enabled: true };
});

const URLENCODED_PATTERN = /^[^=&\s]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/;

const getContentType = (headers: Record<string, unknown> | undefined) => {
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === 'content-type');
  return entry ? String(entry[1] ?? '').toLowerCase() : '';
};

const isJson = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

// 按请求头中的 Content-Type 还原 Body 类型；没有时按内容判断（旧的 History 记录）
const createHistoryBody = (requestBody: unknown, headers: Record<string, unknown> | undefined): RequestBody => {
  const body = createDefaultBody();
  if (typeof requestBody !== 'string' || !requestBody) return body;

  const contentType = getContentType(headers);
  if (contentType.includes('x-www-form-urlencoded')
    || (!contentType && !isJson(requestBody) && URLENCODED_PATTERN.test(requestBody))) {
    body.type = 'x-www-form-urlencoded';
    body.urlencoded = parseUrlencoded(requestBody);
    return body;
  }

  if (contentType.includes('json')) {
    body.type = 'json';
  } else if (contentType.includes('xml')) {
    body.type = 'xml';
  } else if (contentType.startsWith('text/')) {
    body.type = 'text';
  } else if (isJson(requestBody)) {
    body.type = 'json';
  } else {
    body.type = requestBody.trimStart().startsWith('<') ? 'xml' : 'text';
  }
  body.raw = requestBody;
  return body;
};

export const createTemporaryRequestFromHistory = (historyItem: Pick<HistoryItem, 'method' | 'url' | 'requestData'>): Request => {
  const requestData = historyItem?.requestData || {};
  const method = requestData.method || historyItem?.method || 'GET';
  const url = requestData.url || historyItem?.url || '';
  const headers = requestData.headers
    ? Object.entries(requestData.headers).map(([key, value]) => ({
        key,
        value: String(value ?? ''),
        enabled: true,
      }))
    : [];

  return createTemporaryRequest({
    name: getHistoryRequestName(method, url),
    method: method as HttpMethod,
    url,
    headers,
    body: createHistoryBody(requestData.body, requestData.headers),
  });
};
