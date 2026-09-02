import { generateId } from '@/utils/id-generator';
import { createDefaultTestConfig } from '@/utils/requestTests';

const emptyKeyValue = () => ({ key: '', value: '', enabled: true });
const emptyFormData = () => ({
  key: '',
  value: '',
  type: 'text',
  enabled: true,
});

const createDefaultBody = () => ({
  type: 'none',
  raw: '',
  formData: [emptyFormData()],
  urlencoded: [emptyKeyValue()],
});

export const createTemporaryRequest = (overrides = {}) => {
  const now = new Date().toISOString();

  return {
    id: generateId(),
    name: 'Untitled Request',
    method: 'GET',
    url: '',
    params: [emptyKeyValue()],
    headers: [emptyKeyValue()],
    body: createDefaultBody(),
    auth: {
      type: 'none',
      token: '',
      username: '',
      password: '',
    },
    tests: createDefaultTestConfig(),
    testsConfig: createDefaultTestConfig(),
    ...overrides,
    collectionId: null,
    folderId: null,
    createdAt: now,
    updatedAt: now,
  };
};

const getHistoryRequestName = (method, url) => {
  try {
    const pathname = new URL(url).pathname;
    return `${method} ${pathname || '/'}`;
  } catch {
    return `${method} Request`;
  }
};

const createHistoryBody = (requestBody) => {
  const body = createDefaultBody();
  if (!requestBody) return body;

  try {
    JSON.parse(requestBody);
    body.type = 'json';
    body.raw = requestBody;
    return body;
  } catch {
    if (!requestBody.includes('=') || !requestBody.includes('&')) return body;
  }

  body.type = 'x-www-form-urlencoded';
  body.urlencoded = requestBody.split('&').map(pair => {
    const [key, value] = pair.split('=');
    return {
      key: decodeURIComponent(key || ''),
      value: decodeURIComponent(value || ''),
      enabled: true,
    };
  });
  return body;
};

export const createTemporaryRequestFromHistory = (historyItem) => {
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
    method,
    url,
    headers,
    body: createHistoryBody(requestData.body),
  });
};
