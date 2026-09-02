import type {
  AuthConfig,
  HttpMethod,
  Request,
  RequestBody,
  TestConfig,
  WorkflowCondition,
  WorkflowDefinition,
  WorkflowStep,
} from '@/types/models';
import { httpbinUrl } from './httpbin';

let counter = 0;

export const nextId = (prefix: string) => `${prefix}-${++counter}`;

const emptyBody = (): RequestBody => ({
  type: 'none',
  raw: '',
  formData: [{ key: '', value: '', type: 'text', enabled: true }],
  urlencoded: [{ key: '', value: '', enabled: true }],
});

const emptyAuth = (): AuthConfig => ({
  type: 'none',
  token: '',
  username: '',
  password: '',
});

export const emptyTests = (): TestConfig => ({
  statusCodeTests: [],
  jsonFieldTests: [],
  globalVariables: [],
});

export const passingStatusTest = (expectedValue = '200'): TestConfig => ({
  statusCodeTests: [{ enabled: true, operator: 'equals', expectedValue, description: '' }],
  jsonFieldTests: [],
  globalVariables: [],
});

export const makeRequest = (overrides: Partial<Request> = {}): Request => {
  const now = new Date().toISOString();
  const tests = overrides.tests || emptyTests();
  return {
    id: overrides.id || nextId('request'),
    name: overrides.name || 'Test Request',
    method: overrides.method || 'GET',
    url: overrides.url || httpbinUrl('/status/200'),
    params: overrides.params || [],
    headers: overrides.headers || [],
    body: overrides.body || emptyBody(),
    auth: overrides.auth || emptyAuth(),
    tests,
    testsConfig: overrides.testsConfig || tests,
    settings: {
      followRedirects: true,
      maxRedirectCount: 10,
      verifySsl: true,
      autoEncodeUrl: true,
      acceptEncoding: true,
      ...(overrides.settings || {}),
    },
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    collectionId: overrides.collectionId,
    folderId: overrides.folderId,
  };
};

export const requestStep = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: overrides.id || nextId('step'),
  type: 'request',
  name: overrides.name || 'Request Step',
  enabled: overrides.enabled ?? true,
  requestSource: overrides.requestSource || 'inline',
  requestId: overrides.requestId,
  requestOverrides: overrides.requestOverrides,
  inlineRequest: overrides.inlineRequest || makeRequest(),
});

export const condition = (overrides: Partial<WorkflowCondition> = {}): WorkflowCondition => ({
  source: overrides.source || 'lastResponse',
  stepId: overrides.stepId,
  field: overrides.field || 'status',
  path: overrides.path,
  operator: overrides.operator || 'equals',
  expectedValue: overrides.expectedValue || '200',
});

export const controlStep = (
  type: Exclude<WorkflowStep['type'], 'request'>,
  overrides: Partial<WorkflowStep> = {},
): WorkflowStep => ({
  id: overrides.id || nextId(type),
  type,
  name: overrides.name || `${type} step`,
  enabled: overrides.enabled ?? true,
  condition: overrides.condition,
  thenSteps: overrides.thenSteps,
  elseSteps: overrides.elseSteps,
  childSteps: overrides.childSteps,
  iterations: overrides.iterations,
  maxIterations: overrides.maxIterations,
});

export const workflow = (steps: WorkflowStep[], overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition => {
  const now = new Date().toISOString();
  return {
    id: overrides.id || nextId('workflow'),
    name: overrides.name || 'Workflow under test',
    steps,
    version: overrides.version || 1,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
};
