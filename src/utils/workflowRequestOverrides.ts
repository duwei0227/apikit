import type {
  Request,
  RequestSettings,
  WorkflowRequestOverrides,
} from '@/types/models';
import { parseRequestUrl, serializeRequestUrl } from '@/utils/urlQuery';
import { normalizeTestConfig } from '@/utils/requestTests';

export type WorkflowRequestOverrideSection =
  | 'method'
  | 'url'
  | 'params'
  | 'headers'
  | 'auth'
  | 'body'
  | 'testsConfig'
  | 'settings';

export const workflowRequestOverrideSectionLabels: Record<WorkflowRequestOverrideSection, string> = {
  method: 'Method',
  url: 'URL',
  params: 'Params',
  headers: 'Headers',
  auth: 'Authorization',
  body: 'Body',
  testsConfig: 'Tests',
  settings: 'Settings',
};

const settingDefaults: Required<RequestSettings> = {
  followRedirects: true,
  maxRedirectCount: 10,
  verifySsl: true,
  autoEncodeUrl: true,
  acceptEncoding: true,
};

const settingKeys = Object.keys(settingDefaults) as (keyof RequestSettings)[];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const requestBaseUrl = (url: string) => {
  const parsed = parseRequestUrl(url);
  return serializeRequestUrl(parsed.baseUrl, [], { fragment: parsed.fragment });
};

const syncUrlWithParams = (request: Request) => {
  const parsedUrl = parseRequestUrl(request.url);
  request.url = serializeRequestUrl(parsedUrl.baseUrl, request.params || [], {
    autoEncode: false,
    fragment: parsedUrl.fragment,
  });
};

const effectiveSetting = (settings: RequestSettings | undefined, key: keyof RequestSettings) => {
  return settings?.[key] ?? settingDefaults[key];
};

export const getWorkflowRequestOverrideSections = (
  overrides?: WorkflowRequestOverrides,
): WorkflowRequestOverrideSection[] => {
  if (!overrides) return [];

  return (Object.keys(workflowRequestOverrideSectionLabels) as WorkflowRequestOverrideSection[])
    .filter(section => {
      if (section === 'settings') return Boolean(overrides.settings && Object.keys(overrides.settings).length);
      return overrides[section] !== undefined;
    });
};

export const applyWorkflowRequestOverrides = (
  baseRequest: Request,
  overrides?: WorkflowRequestOverrides,
): Request => {
  const effective = clone(baseRequest);
  effective.testsConfig = normalizeTestConfig(effective.testsConfig ?? effective.tests);

  if (!overrides) return effective;

  const replaceSections: Exclude<WorkflowRequestOverrideSection, 'settings'>[] = [
    'method',
    'url',
    'params',
    'headers',
    'auth',
    'body',
    'testsConfig',
  ];

  replaceSections.forEach(section => {
    const value = overrides[section];
    if (value !== undefined) {
      (effective as any)[section] = clone(value);
    }
  });

  if (overrides.testsConfig) {
    effective.tests = clone(overrides.testsConfig);
  }

  if (overrides.settings && Object.keys(overrides.settings).length) {
    effective.settings = {
      ...(effective.settings || {}),
      ...clone(overrides.settings),
    };
  }

  if (overrides.url !== undefined || overrides.params !== undefined) {
    syncUrlWithParams(effective);
  }

  return effective;
};

export const buildWorkflowRequestOverrides = (
  baseRequest: Request,
  editedRequest: Request,
): WorkflowRequestOverrides | undefined => {
  const overrides: WorkflowRequestOverrides = {};

  if (baseRequest.method !== editedRequest.method) overrides.method = editedRequest.method;
  if (requestBaseUrl(baseRequest.url) !== requestBaseUrl(editedRequest.url)) {
    overrides.url = requestBaseUrl(editedRequest.url);
  }

  const replaceSections = ['params', 'headers', 'auth', 'body'] as const;
  replaceSections.forEach(section => {
    if (!equal(baseRequest[section], editedRequest[section])) {
      overrides[section] = clone(editedRequest[section]) as any;
    }
  });

  const baseTests = normalizeTestConfig(baseRequest.testsConfig ?? baseRequest.tests);
  const editedTests = normalizeTestConfig(editedRequest.testsConfig ?? editedRequest.tests);
  if (!equal(baseTests, editedTests)) {
    overrides.testsConfig = clone(editedTests);
  }

  const settings: RequestSettings = {};
  settingKeys.forEach(key => {
    const baseValue = effectiveSetting(baseRequest.settings, key);
    const editedValue = effectiveSetting(editedRequest.settings, key);
    if (!equal(baseValue, editedValue)) {
      (settings as any)[key] = editedValue;
    }
  });
  if (Object.keys(settings).length) overrides.settings = settings;

  return getWorkflowRequestOverrideSections(overrides).length ? overrides : undefined;
};

export const resetWorkflowRequestOverrideSection = (
  editedRequest: Request,
  baseRequest: Request,
  section: WorkflowRequestOverrideSection,
): Request => {
  const next = clone(editedRequest);

  if (section === 'testsConfig') {
    const tests = normalizeTestConfig(baseRequest.testsConfig ?? baseRequest.tests);
    next.tests = clone(tests);
    next.testsConfig = tests;
  } else if (section === 'settings') {
    next.settings = clone(baseRequest.settings || {});
  } else {
    (next as any)[section] = clone((baseRequest as any)[section]);
  }

  if (section === 'url' || section === 'params') {
    syncUrlWithParams(next);
  }

  return next;
};
