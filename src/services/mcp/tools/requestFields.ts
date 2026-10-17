// 请求字段：AI 传入的字段转换为请求，请求转换为输出

import type { AuthConfig, FormDataItem, HttpMethod, KeyValue, Request, RequestBody, RequestSettings, TestConfig } from '@/types/models';
import { cloneJson } from '@/utils/clone';
import { prepareRequestForPersistence } from '@/utils/requestDraft';
import { createEmptyRequest } from '@/utils/requestFactory';
import { normalizeTestConfig } from '@/utils/requestTests';
import { CONDITION_OPERATORS } from '../schemas';
import { isRecord, isOneOf, fail, optionalString, stringValue, fileNameFromPath, requireUrl, hide } from './shared';
import { MCP_HIDDEN_VALUE, HTTP_METHODS, BODY_TYPES, SENSITIVE_HEADERS } from './types';

export function toKeyValues(value: unknown, label: string): KeyValue[] {
  if (!Array.isArray(value)) fail(`${label} must be an array of { key, value, enabled }`);
  return value.map((item, index) => {
    if (!isRecord(item) || typeof item.key !== 'string') fail(`${label}[${index}].key must be a string`);
    return { key: item.key, value: stringValue(item.value), enabled: item.enabled !== false };
  });
}

export function toBody(value: unknown): RequestBody {
  if (!isRecord(value)) fail('body must be an object with a type');
  const type = value.type as RequestBody['type'];
  if (!BODY_TYPES.includes(type)) fail(`body.type must be one of ${BODY_TYPES.join(', ')}`);

  let raw = '';
  if (value.raw !== undefined && value.raw !== null) {
    raw = typeof value.raw === 'string' ? value.raw : JSON.stringify(value.raw, null, 2);
  }

  const formData: FormDataItem[] = value.formData === undefined
    ? []
    : (Array.isArray(value.formData) ? value.formData : fail('body.formData must be an array')).map((item: unknown, index: number) => {
      if (!isRecord(item) || typeof item.key !== 'string') fail(`body.formData[${index}].key must be a string`);
      const isFile = item.type === 'file';
      const filePath = isFile && typeof item.filePath === 'string' ? item.filePath : undefined;
      return {
        key: item.key,
        // 文件项的 value 是上传时用的文件名，和界面选择文件后一致
        value: isFile ? fileNameFromPath(filePath || '') : stringValue(item.value),
        type: isFile ? 'file' : 'text',
        enabled: item.enabled !== false,
        ...(filePath !== undefined ? { filePath } : {}),
      };
    });

  return {
    type,
    raw,
    formData,
    urlencoded: value.urlencoded === undefined ? [] : toKeyValues(value.urlencoded, 'body.urlencoded'),
    ...(typeof value.filePath === 'string' ? { filePath: value.filePath } : {}),
  };
}

export function toAuth(value: unknown, current?: AuthConfig): AuthConfig {
  if (!isRecord(value)) fail('auth must be an object with a type');
  const authType = value.type;
  if (!isOneOf(['none', 'bearer', 'basic'] as const, authType)) fail('auth.type must be none, bearer or basic');
  const keep = (key: 'token' | 'username' | 'password') => {
    const next = stringValue(value[key]);
    return next === MCP_HIDDEN_VALUE ? (current?.[key] || '') : next;
  };
  return { type: authType, token: keep('token'), username: keep('username'), password: keep('password') };
}

export function toTests(value: unknown): TestConfig {
  if (!isRecord(value)) fail('tests must be an object');
  // 未指定 enabled 的项默认启用（normalizeTestConfig 会把缺省值当作 false）
  const withEnabled = (list: unknown) => (Array.isArray(list)
    ? list.map(item => (isRecord(item) ? { enabled: true, ...item } : item))
    : []);
  const checkOperators = (key: 'statusCodeTests' | 'jsonFieldTests') => {
    if (!Array.isArray(value[key])) return;
    value[key].forEach((item: unknown, index: number) => {
      if (isRecord(item) && item.operator !== undefined && !isOneOf(CONDITION_OPERATORS, item.operator)) {
        fail(`tests.${key}[${index}].operator must be one of ${CONDITION_OPERATORS.join(', ')}`);
      }
    });
  };
  checkOperators('statusCodeTests');
  checkOperators('jsonFieldTests');
  if (Array.isArray(value.globalVariables)) {
    value.globalVariables.forEach((item: unknown, index: number) => {
      if (isRecord(item) && item.valueType !== undefined && !isOneOf(['jsonPath', 'customValue', 'header'] as const, item.valueType)) {
        fail(`tests.globalVariables[${index}].valueType must be jsonPath, customValue or header`);
      }
      if (isRecord(item) && item.valueType === 'header' && (typeof item.headerName !== 'string' || !item.headerName.trim())) {
        fail(`tests.globalVariables[${index}].headerName is required for valueType header`);
      }
    });
  }
  return normalizeTestConfig({
    statusCodeTests: withEnabled(value.statusCodeTests),
    jsonFieldTests: withEnabled(value.jsonFieldTests),
    globalVariables: withEnabled(value.globalVariables),
  });
}

export function toSettings(value: unknown): RequestSettings {
  if (!isRecord(value)) fail('settings must be an object');
  const settings: RequestSettings = {};
  for (const key of ['followRedirects', 'verifySsl', 'autoEncodeUrl', 'acceptEncoding'] as const) {
    if (value[key] !== undefined) settings[key] = value[key] === true;
  }
  if (value.maxRedirectCount !== undefined) {
    const count = Number(value.maxRedirectCount);
    if (!Number.isInteger(count) || count < 0) fail('settings.maxRedirectCount must be a non-negative integer');
    settings.maxRedirectCount = count;
  }
  return settings;
}

export function toMethod(value: unknown): HttpMethod {
  const method = String(value).toUpperCase() as HttpMethod;
  if (!HTTP_METHODS.includes(method)) fail(`method must be one of ${HTTP_METHODS.join(', ')}`);
  return method;
}

/** 保留现有敏感 header 的值：收到占位符时沿用同名 header 的原值 */
export function keepHiddenHeaders(headers: KeyValue[], current: KeyValue[] = []): KeyValue[] {
  return headers.map(header => {
    if (header.value !== MCP_HIDDEN_VALUE) return header;
    const previous = current.find(item => item.key.toLowerCase() === header.key.toLowerCase());
    return { ...header, value: previous?.value || '' };
  });
}

/** 把 AI 传入的字段合并到请求上；base 为空时创建新请求 */
export function applyRequestFields(fields: Record<string, unknown>, base?: Request): Request {
  const now = new Date().toISOString();
  const request: Request = base
    ? cloneJson(base)
    : createEmptyRequest({ createdAt: now, updatedAt: now }, { withEmptyRows: false });

  if (fields.name !== undefined) {
    const name = optionalString(fields.name, 'name')?.trim();
    if (!name) fail('name must not be empty');
    request.name = name;
  }
  if (fields.method !== undefined) request.method = toMethod(fields.method);
  if (fields.url !== undefined) request.url = requireUrl(fields.url);
  if (fields.params !== undefined) request.params = toKeyValues(fields.params, 'params');
  if (fields.headers !== undefined) {
    request.headers = keepHiddenHeaders(toKeyValues(fields.headers, 'headers'), base?.headers);
  }
  if (fields.body !== undefined) request.body = toBody(fields.body);
  if (fields.auth !== undefined) request.auth = toAuth(fields.auth, base?.auth);
  if (fields.tests !== undefined) {
    const tests = toTests(fields.tests);
    request.tests = tests;
    request.testsConfig = cloneJson(tests);
  }
  if (fields.settings !== undefined) request.settings = { ...(request.settings || {}), ...toSettings(fields.settings) };
  return request;
}

/** 输出给 AI 的请求：去掉空行和运行时字段，按设置隐藏凭据 */
export function describeRequest(request: Request, reveal: boolean) {
  // prepareRequestForPersistence 本身会拷贝，不会修改传入的请求
  const clean = prepareRequestForPersistence(request);
  return {
    id: clean.id,
    name: clean.name,
    method: clean.method,
    url: clean.url,
    params: clean.params,
    headers: clean.headers.map(header => (
      SENSITIVE_HEADERS.has(header.key.toLowerCase()) ? { ...header, value: hide(header.value, reveal) } : header
    )),
    body: clean.body,
    auth: {
      type: clean.auth?.type || 'none',
      token: hide(clean.auth?.token || '', reveal),
      username: clean.auth?.username || '',
      password: hide(clean.auth?.password || '', reveal),
    },
    tests: normalizeTestConfig(clean.testsConfig ?? clean.tests),
    settings: clean.settings,
    collectionId: clean.collectionId,
    folderId: clean.folderId,
  };
}
