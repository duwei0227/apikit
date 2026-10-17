import type { Request } from '@/types/models';
import { cloneJson } from '@/utils/clone';
import { createEmptyFormDataItem as emptyFormData, createEmptyKeyValue as emptyKeyValue } from '@/utils/requestFactory';

const withTrailingEmptyRow = <T extends { key: string; value: string }>(
  rows: T[] | undefined,
  createEmpty: () => T,
): T[] => {
  const next = rows ? cloneJson(rows) : [];
  while (next.length > 0) {
    const last = next[next.length - 1];
    if (last.key || last.value) break;
    next.pop();
  }
  next.push(createEmpty());
  return next;
};

const removeTransientFields = (request: Request): Request => {
  const next = cloneJson(request) as Request & Record<string, unknown>;
  Object.keys(next).forEach(key => {
    if (key.startsWith('_')) delete next[key];
  });
  return next;
};

export const prepareRequestForEditing = (request: Request): Request => {
  const next = removeTransientFields(request);
  next.params = withTrailingEmptyRow(next.params, emptyKeyValue);
  next.headers = withTrailingEmptyRow(next.headers, emptyKeyValue);
  next.body = next.body || {
    type: 'none',
    raw: '',
    formData: [],
    urlencoded: [],
  };
  next.body.formData = withTrailingEmptyRow(next.body.formData, emptyFormData);
  next.body.urlencoded = withTrailingEmptyRow(next.body.urlencoded, emptyKeyValue);
  return next;
};

export const prepareRequestForPersistence = (request: Request): Request => {
  const next = removeTransientFields(request);
  next.params = (next.params || []).filter(item => item.key || item.value);
  next.headers = (next.headers || []).filter(item => item.key || item.value);
  next.body.formData = (next.body.formData || []).filter(item => item.key || item.value);
  next.body.urlencoded = (next.body.urlencoded || []).filter(item => item.key || item.value);
  return next;
};

export const requestDraftFingerprint = (request: Request): string => {
  const normalized = prepareRequestForPersistence(request);
  return JSON.stringify({
    name: normalized.name,
    method: normalized.method,
    url: normalized.url,
    params: normalized.params,
    headers: normalized.headers,
    body: normalized.body,
    auth: normalized.auth,
    tests: normalized.tests,
    testsConfig: normalized.testsConfig,
    settings: normalized.settings,
  });
};
