// 新建请求的默认值，所有新建请求的地方共用

import type { AuthConfig, FormDataItem, KeyValue, Request, RequestBody, RequestSettings } from '@/types/models';
import { generateId } from '@/utils/id-generator';
import { createDefaultTestConfig } from '@/utils/requestTests';

export const DEFAULT_REQUEST_SETTINGS: Required<RequestSettings> = {
  followRedirects: true,
  maxRedirectCount: 10,
  verifySsl: true,
  autoEncodeUrl: true,
  acceptEncoding: true,
};

export const createEmptyKeyValue = (): KeyValue => ({ key: '', value: '', enabled: true });

export const createEmptyFormDataItem = (): FormDataItem => ({ key: '', value: '', type: 'text', enabled: true });

export interface EmptyRequestOptions {
  /** 编辑器中的表格末尾保留一行空行便于输入；保存或通过 MCP 创建的请求不需要 */
  withEmptyRows?: boolean;
}

export const createEmptyBody = ({ withEmptyRows = true }: EmptyRequestOptions = {}): RequestBody => ({
  type: 'none',
  raw: '',
  formData: withEmptyRows ? [createEmptyFormDataItem()] : [],
  urlencoded: withEmptyRows ? [createEmptyKeyValue()] : [],
});

export const createEmptyAuth = (): AuthConfig => ({ type: 'none', token: '', username: '', password: '' });

/** 新建一个 GET 请求，带默认的状态码 200 断言 */
export const createEmptyRequest = (overrides: Partial<Request> = {}, options: EmptyRequestOptions = {}): Request => {
  const withEmptyRows = options.withEmptyRows ?? true;
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name: 'Untitled Request',
    method: 'GET',
    url: '',
    params: withEmptyRows ? [createEmptyKeyValue()] : [],
    headers: withEmptyRows ? [createEmptyKeyValue()] : [],
    body: createEmptyBody({ withEmptyRows }),
    auth: createEmptyAuth(),
    tests: createDefaultTestConfig(),
    testsConfig: createDefaultTestConfig(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};
