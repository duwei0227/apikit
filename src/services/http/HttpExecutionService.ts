import { apiService, type HttpSendResult } from '@/services/api/apiService';
import { markRaw } from 'vue';
import { StreamAccumulator, describeStream, detectStreamFormat, formatByteSize, formatDuration, parseStreamBody } from '@/utils/streamResponse';
import type { ConsoleLog, GlobalVariableConfig, HttpResponseView, Request, RequestTestResults } from '@/types/models';
import { parseJsonPreservingNumbers } from '@/utils/jsonFormat';
import { stripJsonComments } from '@/utils/jsonComments';
import { canSendRequestBody } from '@/utils/httpMethods';
import { removeHttpHeader, setDefaultHeader } from '@/utils/httpHeaders';
import { normalizeTestConfig } from '@/utils/requestTests';
import { buildRequestUrl } from '@/utils/urlQuery';
import { generateId } from '@/utils/id-generator';
import { DEFAULT_REQUEST_SETTINGS } from '@/utils/requestFactory';
import { decodeResponseBody, formatResponseText } from '@/utils/responseBody';
import { compareValues, describeComparison, valueToText } from '@/utils/valueComparison';
import { extractValueFromJsonPath } from '@/utils/jsonPath';

export interface RequestExecutionSettings {
  followRedirects: boolean;
  maxRedirectCount: number;
  verifySsl: boolean;
  autoEncodeUrl: boolean;
  acceptEncoding: boolean;
}

export interface HttpExecutionContext {
  replaceVariables?: (value: string) => string;
  setGlobalVariable?: (key: string, value: string, enabled?: boolean, description?: string) => void;
  onConsoleLog?: (log: ConsoleLog) => void;
  onRequestStart?: (requestId: string) => void;
  /** 流式响应接收过程中的响应快照（请求编辑器用来边收边显示） */
  onStreamUpdate?: (response: HttpResponseView) => void;
}

export interface HttpExecutionResult {
  requestId: string;
  response: HttpResponseView;
  testResults: RequestTestResults;
  consoleLog: ConsoleLog;
}

/** multipart 上传的字段（Rust 端 MultipartField） */
interface MultipartField {
  name: string;
  value: string;
  filename: string | null;
  mimeType: string | null;
  filePath?: string;
}

/** Rust 端 http://stream 事件：开始接收和收到一段数据 */
type HttpStreamEvent =
  | { requestId: string; kind: 'start'; status: number; statusText: string; headers: Array<[string, string]>; elapsedMs: number }
  | { requestId: string; kind: 'chunk'; data: string; elapsedMs: number; receivedBytes: number };

const defaultSettings: RequestExecutionSettings = DEFAULT_REQUEST_SETTINGS;

export { extractValueFromJsonPath };

export const areTestsPassed = (results?: RequestTestResults): boolean => {
  const statusPassed = (results?.statusCode || []).every(item => item.passed);
  const jsonPassed = (results?.jsonFields || []).every(item => item.passed);
  return statusPassed && jsonPassed;
};

/** 提取变量的来源说明，显示在测试结果中 */
const variableSource = (variable: GlobalVariableConfig) => {
  if (variable.valueType === 'customValue') return 'Custom value';
  if (variable.valueType === 'header') return `Header ${variable.headerName || ''}`.trim();
  return variable.jsonPath;
};

/** 按名称取响应头，不区分大小写；没有该响应头时为 undefined */
const findResponseHeader = (headers: Record<string, string> | undefined, name?: string): string | undefined => {
  const target = (name || '').trim().toLowerCase();
  if (!target || !headers) return undefined;
  return Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1];
};

export const executeRequestTests = (
  responseData: Pick<HttpResponseView, 'status' | 'rawBody' | 'testBody'> & { headers?: HttpResponseView['headers'] },
  testsConfig: unknown = {},
  context: HttpExecutionContext = {},
): RequestTestResults => {
  const normalizedConfig = normalizeTestConfig(testsConfig);
  const results: RequestTestResults = {
    statusCode: [],
    jsonFields: [],
    globalVars: [],
  };

  const statusCodeTests = normalizedConfig.statusCodeTests;
  const jsonFieldTests = normalizedConfig.jsonFieldTests;
  const globalVariables = normalizedConfig.globalVariables;
  // 期望值和自定义值可以使用 {{变量}}；未定义的变量保持原样
  const resolve = (value: string) => (value && context.replaceVariables ? context.replaceVariables(value) : value);

  statusCodeTests.forEach((test, index) => {
    if (!test.enabled) return;

    const actualStatus = responseData.status;
    const expectedText = resolve(test.expectedValue).trim();
    const expectedStatus = Number(expectedText);
    const validExpectedStatus = /^\d+$/.test(expectedText) && Number.isInteger(expectedStatus);
    const passed = validExpectedStatus && compareValues(actualStatus, test.operator, expectedStatus);

    results.statusCode.push({
      index,
      passed,
      message: validExpectedStatus
        ? describeComparison('Status code', actualStatus, test.operator, expectedText)
        : 'Expected status code is missing or invalid',
      description: test.description,
      actualValue: actualStatus,
      operator: test.operator,
      expectedValue: expectedText,
    });
  });

  let jsonData: unknown = null;
  let isValidJson = false;
  try {
    // 流式响应对合并后的结果对象取值
    jsonData = parseJsonPreservingNumbers(responseData.testBody ?? responseData.rawBody);
    isValidJson = true;
  } catch {
    jsonData = null;
  }

  jsonFieldTests.forEach((test, index) => {
    if (!test.enabled) return;

    if (!test.jsonPath) {
      results.jsonFields.push({
        index,
        passed: false,
        message: 'JSON path is required',
        description: test.description,
        operator: test.operator,
        expectedValue: test.expectedValue,
        jsonPath: '',
      });
      return;
    }

    if (!isValidJson) {
      results.jsonFields.push({
        index,
        passed: false,
        message: `${test.jsonPath}: response is not valid JSON`,
        description: test.description,
        operator: test.operator,
        expectedValue: test.expectedValue,
        jsonPath: test.jsonPath,
      });
      return;
    }

    const actualValue = extractValueFromJsonPath(jsonData, test.jsonPath);
    const expectedValue = resolve(test.expectedValue);
    const passed = compareValues(actualValue, test.operator, expectedValue);

    results.jsonFields.push({
      index,
      passed,
      message: describeComparison(test.jsonPath, actualValue, test.operator, expectedValue),
      description: test.description,
      actualValue,
      operator: test.operator,
      expectedValue,
      jsonPath: test.jsonPath,
    });
  });

  const enabledGlobalVariables = globalVariables
    .map((variable, index) => ({ variable, index }))
    .filter(({ variable }) => variable.enabled && variable.variableName);

  if (!areTestsPassed(results)) {
    enabledGlobalVariables.forEach(({ variable, index }) => {
      results.globalVars.push({
        index,
        success: false,
        status: 'skipped',
        message: `Skipped ${variable.variableName}: request tests failed`,
        description: variable.description,
        variableName: variable.variableName,
        valueType: variable.valueType,
        source: variableSource(variable),
      });
    });
  } else {
    enabledGlobalVariables.forEach(({ variable, index }) => {
      const source = variableSource(variable);

      const value = variable.valueType === 'customValue'
        ? resolve(variable.customValue)
        : variable.valueType === 'header'
          ? findResponseHeader(responseData.headers, variable.headerName)
          : variable.jsonPath && isValidJson
            ? extractValueFromJsonPath(jsonData, variable.jsonPath)
            : undefined;

      if (value === undefined) {
        results.globalVars.push({
          index,
          success: false,
          status: 'failed',
          message: `Failed to set ${variable.variableName}: value could not be resolved`,
          description: variable.description,
          variableName: variable.variableName,
          valueType: variable.valueType,
          source,
        });
        return;
      }

      if (!context.setGlobalVariable) {
        results.globalVars.push({
          index,
          success: false,
          status: 'failed',
          message: `Failed to set ${variable.variableName}: global variable setter is unavailable`,
          description: variable.description,
          variableName: variable.variableName,
          valueType: variable.valueType,
          source,
          value: valueToText(value),
        });
        return;
      }

      context.setGlobalVariable(variable.variableName, valueToText(value), true, variable.description);
      results.globalVars.push({
        index,
        success: true,
        status: 'set',
        message: `Set ${variable.variableName} = ${valueToText(value)}`,
        description: variable.description,
        variableName: variable.variableName,
        valueType: variable.valueType,
        source,
        value: valueToText(value),
      });
    });
  }

  return results;
};

const normalizeUrl = (url: string): string => {
  if (!url) return url;
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return `http://${trimmed}`;
  }
  return trimmed;
};

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    resolve(result.split(',')[1] || '');
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

// Tauri 的 WebView 中 File 可能带有本地路径
const getFilePath = (file?: File & { path?: string }): string => file?.path || '';

const buildMultipartData = async (request: Request, replaceVariables: (value: string) => string) => {
  const fields: MultipartField[] = [];

  for (const item of request.body.formData || []) {
    if (!item.enabled || !item.key) continue;

    if (item.type === 'file') {
      const filePath = item.filePath || getFilePath(item.file ?? undefined);
      const filename = item.file?.name || item.value || filePath.replace(/\\/g, '/').split('/').pop() || '';
      if (!filePath && !item.file) continue;

      const field: MultipartField = {
        name: replaceVariables(item.key),
        value: '',
        filename,
        mimeType: item.file?.type || null,
      };

      if (filePath) {
        field.filePath = filePath;
      } else if (item.file) {
        field.value = await fileToBase64(item.file);
      }

      fields.push(field);
    } else if (item.type === 'text') {
      fields.push({
        name: replaceVariables(item.key),
        value: replaceVariables(item.value),
        filename: null,
        mimeType: null,
      });
    }
  }

  return { fields };
};

export const executeHttpRequest = async (
  request: Request,
  context: HttpExecutionContext = {},
): Promise<HttpExecutionResult> => {
  const runtimeRequestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  context.onRequestStart?.(runtimeRequestId);
  const startTime = Date.now();

  const consoleLog: ConsoleLog = {
    id: generateId(),
    startTime,
    method: request.method,
    url: '',
    requestHeaders: {},
    requestBody: null,
    endTime: 0,
    status: 0,
    statusText: '',
    duration: '',
    responseHeaders: {},
    responseBody: '',
  };

  try {
    return await sendAndRecord(request, context, runtimeRequestId, consoleLog);
  } catch (error) {
    const message = (error as Error | null)?.message || String(error);
    // 没有收到响应的请求也写入日志（status 0），用户取消的除外
    if (consoleLog.endTime === 0 && !message.includes('cancelled')) {
      const endTime = Date.now();
      consoleLog.endTime = endTime;
      consoleLog.statusText = 'Error';
      consoleLog.duration = `${endTime - startTime}ms`;
      consoleLog.responseBody = `Error: ${message}`;
      context.onConsoleLog?.(consoleLog);
    }
    throw error;
  }
};

export interface PreparedHttpRequest {
  url: string;
  headers: Record<string, string>;
  /** 普通请求体；multipart 上传时为 null */
  body: string | null;
  multipart: { fields: MultipartField[] } | null;
  bodyFilePath?: string;
  settings: RequestExecutionSettings;
  /** 替换后仍然存在的 {{name}}，请求照常发送 */
  unresolvedVariables: string[];
}

/** 替换变量，拼出要发送的 URL、请求头和请求体 */
export const prepareHttpRequest = async (
  request: Request,
  resolveVariables: (value: string) => string = (value: string) => value,
): Promise<PreparedHttpRequest> => {
  const unresolvedVariables = new Set<string>();
  const replaceVariables = (value: string) => {
    const resolved = resolveVariables(value);
    if (typeof resolved === 'string') {
      for (const match of resolved.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) unresolvedVariables.add(match[1]);
    }
    return resolved;
  };
  const settings: RequestExecutionSettings = { ...defaultSettings, ...request.settings };

  const url = buildRequestUrl(request.url, request.params || [], {
    autoEncode: settings.autoEncodeUrl,
    transform: replaceVariables,
    normalizeBaseUrl: normalizeUrl,
  });

  const headers: Record<string, string> = {};
  (request.headers || [])
    .filter(item => item.enabled && item.key)
    .forEach(item => {
      headers[replaceVariables(item.key)] = replaceVariables(item.value);
    });

  if (request.auth?.type === 'bearer' && request.auth.token) {
    const token = replaceVariables(request.auth.token);
    headers.Authorization = token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
  } else if (request.auth?.type === 'basic' && request.auth.username) {
    const credentials = btoa(`${replaceVariables(request.auth.username)}:${replaceVariables(request.auth.password)}`);
    headers.Authorization = `Basic ${credentials}`;
  }

  if (settings.acceptEncoding && !Object.keys(headers).some(key => key.toLowerCase() === 'accept-encoding')) {
    headers['Accept-Encoding'] = 'gzip, deflate, br';
  }

  let body: string | null = null;
  let multipart: { fields: MultipartField[] } | null = null;
  if (canSendRequestBody(request.method)) {
    if (request.body.type === 'json') {
      setDefaultHeader(headers, 'Content-Type', 'application/json');
      // 先去掉注释再替换变量，变量值里的 // 不受影响
      if (request.body.raw) body = replaceVariables(stripJsonComments(request.body.raw));
    } else if (request.body.type === 'xml') {
      setDefaultHeader(headers, 'Content-Type', 'application/xml');
      if (request.body.raw) body = replaceVariables(request.body.raw);
    } else if (request.body.type === 'text') {
      setDefaultHeader(headers, 'Content-Type', 'text/plain');
      if (request.body.raw) body = replaceVariables(request.body.raw);
    } else if (request.body.type === 'binary') {
      setDefaultHeader(headers, 'Content-Type', 'application/octet-stream');
    } else if (request.body.type === 'x-www-form-urlencoded') {
      setDefaultHeader(headers, 'Content-Type', 'application/x-www-form-urlencoded');
      body = (request.body.urlencoded || [])
        .filter(item => item.enabled && item.key)
        .map(item => `${encodeURIComponent(replaceVariables(item.key))}=${encodeURIComponent(replaceVariables(item.value))}`)
        .join('&');
    } else if (request.body.type === 'form-data') {
      const hasFileUpload = (request.body.formData || []).some(item => item.enabled && item.key && item.type === 'file' && (item.file || item.filePath));
      if (hasFileUpload) {
        removeHttpHeader(headers, 'Content-Type');
        multipart = await buildMultipartData(request, replaceVariables);
      } else {
        const formDataObj: Record<string, string> = {};
        (request.body.formData || [])
          .filter(item => item.enabled && item.key && item.type === 'text')
          .forEach(item => {
            formDataObj[replaceVariables(item.key)] = replaceVariables(item.value);
          });
        setDefaultHeader(headers, 'Content-Type', 'application/json');
        body = JSON.stringify(formDataObj);
      }
    }
  }

  return {
    url,
    headers,
    body,
    multipart,
    bodyFilePath: canSendRequestBody(request.method) && request.body.type === 'binary' && request.body.filePath
      ? replaceVariables(request.body.filePath)
      : undefined,
    settings,
    unresolvedVariables: [...unresolvedVariables],
  };
};

const sendPrepared = (prepared: PreparedHttpRequest, method: string, requestId: string, streamEvents: boolean) => (
  apiService.sendHttpRequest({
    requestId,
    method,
    url: prepared.url,
    headers: prepared.headers,
    body: prepared.multipart ? undefined : (prepared.body || undefined),
    bodyFilePath: prepared.bodyFilePath,
    multipart: prepared.multipart || undefined,
    maxRedirections: prepared.settings.followRedirects ? prepared.settings.maxRedirectCount : 0,
    verifySsl: prepared.settings.verifySsl,
    acceptEncoding: prepared.settings.acceptEncoding,
    ...(streamEvents ? { streamEvents: true } : {}),
  })
);

/** 同名 header（如 set-cookie）用逗号拼接 */
const collectHeaders = (pairs: Array<[string, string]>): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const [key, value] of pairs) {
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  }
  return headers;
};

/**
 * 流式响应（SSE / 逐行 JSON）边接收边推给界面。返回 stop 函数和当前的累积器；
 * 只在调用方提供 onStreamUpdate（如请求编辑器）时启用。
 */
const watchStream = async (requestId: string, onStreamUpdate: (response: HttpResponseView) => void) => {
  const { listen } = await import('@tauri-apps/api/event');
  let live: { accumulator: StreamAccumulator; response: HttpResponseView; elapsedMs: number; receivedBytes: number; revision: number } | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    flushTimer = null;
    if (!live) return;
    live.revision += 1;
    // 每次推送新对象，界面才能感知变化
    live.response = {
      ...live.response,
      stream: describeStream(live.accumulator, { active: true, revision: live.revision }),
      time: formatDuration(live.elapsedMs),
      size: formatByteSize(live.receivedBytes),
    };
    onStreamUpdate(live.response);
  };

  const unlisten = await listen<HttpStreamEvent>('http://stream', ({ payload }) => {
    if (payload.requestId !== requestId) return;
    if (payload.kind === 'start') {
      const headers = collectHeaders(payload.headers);
      const format = detectStreamFormat(headers['content-type']);
      if (!format) return;
      const accumulator = new StreamAccumulator(format);
      // 事件可能有上万个，不需要逐个做响应式代理；界面靠 revision 感知更新
      markRaw(accumulator.events);
      live = {
        accumulator,
        elapsedMs: payload.elapsedMs,
        receivedBytes: 0,
        revision: 0,
        response: {
          status: payload.status,
          statusText: payload.statusText,
          time: formatDuration(payload.elapsedMs),
          size: '0B',
          body: '',
          rawBody: '',
          headers,
          contentType: headers['content-type'] || '',
          imageDataUrl: '',
          isPartialJson: false,
          stream: describeStream(accumulator, { active: true }),
        },
      };
      onStreamUpdate(live.response);
    } else if (payload.kind === 'chunk' && live) {
      live.accumulator.push(payload.data, payload.elapsedMs);
      live.elapsedMs = payload.elapsedMs;
      live.receivedBytes = payload.receivedBytes;
      if (!flushTimer) flushTimer = setTimeout(flush, 60);
    }
  });

  return {
    get live() { return live; },
    stop() {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      unlisten();
    },
  };
};

const sendAndRecord = async (
  request: Request,
  context: HttpExecutionContext,
  runtimeRequestId: string,
  consoleLog: ConsoleLog,
): Promise<HttpExecutionResult> => {
  const prepared = await prepareHttpRequest(request, context.replaceVariables);
  consoleLog.url = prepared.url;
  consoleLog.requestHeaders = { ...prepared.headers };
  consoleLog.requestBody = prepared.body;
  if (prepared.unresolvedVariables.length > 0) consoleLog.unresolvedVariables = prepared.unresolvedVariables;

  const stream = context.onStreamUpdate ? await watchStream(runtimeRequestId, context.onStreamUpdate) : null;
  let result: HttpSendResult;
  try {
    result = await sendPrepared(prepared, request.method, runtimeRequestId, Boolean(stream));
  } finally {
    stream?.stop();
  }

  if (result.requestContentType) {
    prepared.headers['Content-Type'] = result.requestContentType;
    consoleLog.requestHeaders = { ...prepared.headers };
  }

  const responseHeaders = collectHeaders(result.headers);
  const contentType = responseHeaders['content-type'] || '';
  const { responseText, imageDataUrl, isBinaryContent } = decodeResponseBody(result, contentType);
  const { responseBody, isPartialJson } = formatResponseText(responseText, contentType, isBinaryContent, { allowPartialJson: true });

  const response: HttpResponseView = {
    status: result.status,
    statusText: result.statusText,
    time: `${result.durationMs}ms`,
    size: formatByteSize(result.bodyBytes),
    body: responseBody,
    rawBody: responseText,
    headers: responseHeaders,
    contentType,
    imageDataUrl,
    isPartialJson,
  };

  consoleLog.endTime = Date.now();
  consoleLog.status = result.status;
  consoleLog.statusText = result.statusText;
  consoleLog.duration = `${result.durationMs}ms`;
  consoleLog.responseHeaders = responseHeaders;
  consoleLog.responseBody = responseText;

  // 流式响应：补上还没处理的内容，生成最终状态和断言用的合并结果
  const streamFormat = isBinaryContent ? null : detectStreamFormat(contentType);
  if (streamFormat) {
    const live = stream?.live;
    const totalMs = result.totalMs ?? result.durationMs;
    let accumulator: StreamAccumulator;
    if (live) {
      accumulator = live.accumulator;
      if (responseText.startsWith(accumulator.raw)) {
        accumulator.push(responseText.slice(accumulator.raw.length), totalMs);
      }
      accumulator.finish(totalMs);
    } else {
      accumulator = parseStreamBody(responseText, streamFormat, totalMs);
    }
    markRaw(accumulator.events);
    Object.assign(response, {
      time: live ? formatDuration(totalMs) : response.time,
      body: responseText,
      isPartialJson: false,
      stream: describeStream(accumulator, {
        active: false,
        interrupted: result.interrupted,
        revision: (live?.revision ?? 0) + 1,
      }),
      testBody: JSON.stringify(accumulator.toTestObject()),
    });
    if (live) consoleLog.duration = `${totalMs}ms`;
    consoleLog.stream = {
      eventCount: accumulator.events.length,
      firstEventMs: live ? accumulator.firstEventMs : null,
      interrupted: result.interrupted || null,
    };
  }

  const testResults = executeRequestTests(response, request.testsConfig || request.tests || {}, context);
  context.onConsoleLog?.(consoleLog);

  return {
    requestId: runtimeRequestId,
    response,
    testResults,
    consoleLog,
  };
};

export interface HttpDownloadResult {
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  size: string;
  headers: Record<string, string>;
  contentType: string;
  bytes: Uint8Array;
}

/** Send and Download：按同样的规则发送请求，返回原始字节供保存到文件 */
export const downloadHttpResponse = async (
  request: Request,
  context: Pick<HttpExecutionContext, 'replaceVariables' | 'onRequestStart'> = {},
): Promise<HttpDownloadResult> => {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  context.onRequestStart?.(requestId);
  const prepared = await prepareHttpRequest(request, context.replaceVariables);
  const result = await sendPrepared(prepared, request.method, requestId, false);
  const headers = collectHeaders(result.headers);

  let bytes: Uint8Array;
  if (result.isBase64) {
    const binary = atob(result.body);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(result.body);
  }

  return {
    url: prepared.url,
    status: result.status,
    statusText: result.statusText,
    durationMs: result.durationMs,
    size: formatByteSize(result.bodyBytes),
    headers,
    contentType: headers['content-type'] || '',
    bytes,
  };
};

export const cancelHttpExecution = async (requestId: string | null): Promise<boolean> => {
  if (!requestId) return false;
  return apiService.cancelHttpRequest(requestId);
};
