import { apiService } from '@/services/api/apiService';
import type { Request, RequestTestResults } from '@/types/models';
import { formatJsonPreservingNumbers, parseJsonPreservingNumbers } from '@/utils/jsonFormat';
import { canSendRequestBody } from '@/utils/httpMethods';
import { removeHttpHeader, setDefaultHeader } from '@/utils/httpHeaders';
import { normalizeTestConfig } from '@/utils/requestTests';
import { buildRequestUrl } from '@/utils/urlQuery';

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
  onConsoleLog?: (log: any) => void;
  onRequestStart?: (requestId: string) => void;
}

export interface HttpExecutionResult {
  requestId: string;
  response: any;
  testResults: RequestTestResults;
  consoleLog: any;
}

const defaultSettings: RequestExecutionSettings = {
  followRedirects: true,
  maxRedirectCount: 10,
  verifySsl: true,
  autoEncodeUrl: true,
  acceptEncoding: true,
};

export const extractValueFromJsonPath = (jsonData: any, path: string): any => {
  try {
    const cleanPath = path.replace(/^\$\.?/, '');
    const parts = cleanPath.split(/\.|\[|\]/).filter(Boolean);

    let value = jsonData;
    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      value = value[part];
    }
    return value;
  } catch {
    return undefined;
  }
};

export const areTestsPassed = (results?: RequestTestResults): boolean => {
  const statusPassed = (results?.statusCode || []).every(item => item.passed);
  const jsonPassed = (results?.jsonFields || []).every(item => item.passed);
  return statusPassed && jsonPassed;
};

const evaluateOperator = (actualValue: any, operator: string, expectedValue: any): boolean => {
  switch (operator) {
    case 'equals':
      return String(actualValue) === String(expectedValue);
    case 'notEquals':
      return String(actualValue) !== String(expectedValue);
    case 'contains':
      return String(actualValue).includes(String(expectedValue));
    case 'notContains':
      return !String(actualValue).includes(String(expectedValue));
    case 'exists':
      return actualValue !== undefined && actualValue !== null;
    case 'notExists':
      return actualValue === undefined || actualValue === null;
    case 'greaterThan':
      return Number(actualValue) > Number(expectedValue);
    case 'lessThan':
      return Number(actualValue) < Number(expectedValue);
    case 'greaterThanOrEquals':
      return Number(actualValue) >= Number(expectedValue);
    case 'lessThanOrEquals':
      return Number(actualValue) <= Number(expectedValue);
    default:
      return false;
  }
};

export const executeRequestTests = (
  responseData: any,
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

  statusCodeTests.forEach((test, index) => {
    if (!test.enabled) return;

    const actualStatus = responseData.status;
    const expectedText = test.expectedValue.trim();
    const expectedStatus = Number(expectedText);
    const validExpectedStatus = /^\d+$/.test(expectedText) && Number.isInteger(expectedStatus);
    const passed = validExpectedStatus && evaluateOperator(actualStatus, test.operator, expectedStatus);

    results.statusCode.push({
      index,
      passed,
      message: validExpectedStatus
        ? `Status code ${actualStatus} ${test.operator} ${expectedText}`
        : 'Expected status code is missing or invalid',
      description: test.description,
      actualValue: actualStatus,
      operator: test.operator,
      expectedValue: test.expectedValue,
    });
  });

  let jsonData: any = null;
  let isValidJson = false;
  try {
    jsonData = parseJsonPreservingNumbers(responseData.rawBody);
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
    const passed = evaluateOperator(actualValue, test.operator, test.expectedValue);

    results.jsonFields.push({
      index,
      passed,
      message: `${test.jsonPath}: ${actualValue} ${test.operator} ${test.expectedValue}`,
      description: test.description,
      actualValue,
      operator: test.operator,
      expectedValue: test.expectedValue,
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
        source: variable.valueType === 'customValue' ? 'Custom value' : variable.jsonPath,
      });
    });
  } else {
    enabledGlobalVariables.forEach(({ variable, index }) => {
      const source = variable.valueType === 'customValue' ? 'Custom value' : variable.jsonPath;

      const value = variable.valueType === 'customValue'
        ? variable.customValue
        : variable.jsonPath && jsonData
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
          value: String(value),
        });
        return;
      }

      context.setGlobalVariable(variable.variableName, String(value), true, variable.description);
      results.globalVars.push({
        index,
        success: true,
        status: 'set',
        message: `Set ${variable.variableName} = ${value}`,
        description: variable.description,
        variableName: variable.variableName,
        valueType: variable.valueType,
        source,
        value: String(value),
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

const getFilePath = (file?: File): string => file ? ((file as any).path || '') : '';

const buildMultipartData = async (request: Request, replaceVariables: (value: string) => string) => {
  const fields = [];

  for (const item of request.body.formData || []) {
    if (!item.enabled || !item.key) continue;

    if (item.type === 'file') {
      const filePath = item.filePath || getFilePath(item.file);
      const filename = item.file?.name || item.value;
      if (!filePath && !item.file) continue;

      const field: any = {
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

const decodeResponseBody = (result: any, contentType: string) => {
  const isBinaryContent = contentType.startsWith('image/')
    || contentType.startsWith('audio/')
    || contentType.startsWith('video/')
    || contentType.includes('octet-stream')
    || contentType.includes('pdf')
    || contentType.includes('zip')
    || contentType.includes('gzip')
    || contentType.startsWith('font/');

  if (isBinaryContent) {
    return {
      responseText: `[Binary: ${contentType}, ${result.bodyBytes} bytes]`,
      imageDataUrl: contentType.startsWith('image/') ? `data:${contentType};base64,${result.body}` : '',
      isBinaryContent,
    };
  }

  const binaryStr = atob(result.body);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  return {
    responseText: new TextDecoder('utf-8').decode(bytes),
    imageDataUrl: '',
    isBinaryContent,
  };
};

const formatResponseBody = (responseText: string, contentType: string, isBinaryContent: boolean) => {
  if (isBinaryContent) return { responseBody: responseText, isPartialJson: false };

  try {
    return {
      responseBody: formatJsonPreservingNumbers(responseText),
      isPartialJson: false,
    };
  } catch {
    return {
      responseBody: responseText,
      isPartialJson: false,
    };
  }
};

export const executeHttpRequest = async (
  request: Request,
  context: HttpExecutionContext = {},
): Promise<HttpExecutionResult> => {
  const runtimeRequestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  context.onRequestStart?.(runtimeRequestId);
  const startTime = Date.now();
  const replaceVariables = context.replaceVariables || ((value: string) => value);
  const settings = { ...defaultSettings, ...(request as any).settings };

  const consoleLog: any = {
    id: Date.now(),
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

  const url = buildRequestUrl(request.url, request.params || [], {
    autoEncode: settings.autoEncodeUrl,
    transform: replaceVariables,
    normalizeBaseUrl: normalizeUrl,
  });
  consoleLog.url = url;

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
  let multipartData: any = null;
  if (canSendRequestBody(request.method)) {
    if (request.body.type === 'json') {
      setDefaultHeader(headers, 'Content-Type', 'application/json');
      if (request.body.raw) {
        body = replaceVariables(request.body.raw);
      }
    } else if (request.body.type === 'xml') {
      setDefaultHeader(headers, 'Content-Type', 'application/xml');
      if (request.body.raw) {
        body = replaceVariables(request.body.raw);
      }
    } else if (request.body.type === 'text') {
      setDefaultHeader(headers, 'Content-Type', 'text/plain');
      if (request.body.raw) {
        body = replaceVariables(request.body.raw);
      }
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
        multipartData = await buildMultipartData(request, replaceVariables);
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

  consoleLog.requestHeaders = { ...headers };
  consoleLog.requestBody = body;

  const result: any = await apiService.sendHttpRequest({
    requestId: runtimeRequestId,
    method: request.method,
    url,
    headers,
    body: multipartData ? undefined : (body || undefined),
    bodyFilePath: canSendRequestBody(request.method)
      && request.body.type === 'binary' && request.body.filePath
      ? replaceVariables(request.body.filePath)
      : undefined,
    multipart: multipartData || undefined,
    maxRedirections: settings.followRedirects ? settings.maxRedirectCount : 0,
    verifySsl: settings.verifySsl,
    acceptEncoding: settings.acceptEncoding,
  });

  if (result.requestContentType) {
    headers['Content-Type'] = result.requestContentType;
    consoleLog.requestHeaders = { ...headers };
  }

  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of result.headers) {
    responseHeaders[key] = responseHeaders[key] ? `${responseHeaders[key]}, ${value}` : value;
  }

  const contentType = responseHeaders['content-type'] || '';
  const { responseText, imageDataUrl, isBinaryContent } = decodeResponseBody(result, contentType);
  const { responseBody, isPartialJson } = formatResponseBody(responseText, contentType, isBinaryContent);
  const sizeBytes = result.bodyBytes;
  const size = sizeBytes < 1024
    ? `${sizeBytes}B`
    : sizeBytes < 1024 * 1024
      ? `${(sizeBytes / 1024).toFixed(2)}KB`
      : `${(sizeBytes / (1024 * 1024)).toFixed(2)}MB`;

  const response = {
    status: result.status,
    statusText: result.statusText,
    time: `${result.durationMs}ms`,
    size,
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

  const testResults = executeRequestTests(response, (request as any).testsConfig || request.tests || {}, context);
  context.onConsoleLog?.(consoleLog);

  return {
    requestId: runtimeRequestId,
    response,
    testResults,
    consoleLog,
  };
};

export const cancelHttpExecution = async (requestId: string | null): Promise<boolean> => {
  if (!requestId) return false;
  return apiService.cancelHttpRequest(requestId);
};
