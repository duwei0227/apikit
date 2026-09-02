import type {
  GlobalVariableConfig,
  JsonFieldTest,
  RequestTestResults,
  StatusCodeTest,
  TestConfig,
} from '@/types/models';

const asRecord = (value: unknown): Record<string, any> => (
  value && typeof value === 'object' ? value as Record<string, any> : {}
);

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const normalizeStatusCodeTest = (value: unknown): StatusCodeTest => {
  const test = asRecord(value);
  return {
    enabled: Boolean(test.enabled),
    operator: String(test.operator || 'equals'),
    expectedValue: String(test.expectedValue ?? test.value ?? ''),
    description: String(test.description || ''),
  };
};

const normalizeJsonFieldTest = (value: unknown): JsonFieldTest => {
  const test = asRecord(value);
  return {
    enabled: Boolean(test.enabled),
    jsonPath: String(test.jsonPath || ''),
    operator: String(test.operator || 'equals'),
    expectedValue: String(test.expectedValue ?? test.value ?? ''),
    description: String(test.description || ''),
  };
};

const normalizeGlobalVariable = (value: unknown): GlobalVariableConfig => {
  const variable = asRecord(value);
  return {
    enabled: Boolean(variable.enabled),
    variableName: String(variable.variableName || ''),
    valueType: variable.valueType === 'customValue' ? 'customValue' : 'jsonPath',
    jsonPath: String(variable.jsonPath || ''),
    customValue: String(variable.customValue || ''),
    description: String(variable.description || ''),
  };
};

export const createDefaultTestConfig = (): TestConfig => ({
  statusCodeTests: [{ enabled: true, operator: 'equals', expectedValue: '200', description: '' }],
  jsonFieldTests: [],
  globalVariables: [],
});

/** Normalize persisted test data without mutating the stored request or draft. */
export const normalizeTestConfig = (value: unknown): TestConfig => {
  const config = asRecord(value);
  return {
    statusCodeTests: asArray(config.statusCodeTests).map(normalizeStatusCodeTest),
    jsonFieldTests: asArray(config.jsonFieldTests).map(normalizeJsonFieldTest),
    globalVariables: asArray(config.globalVariables).map(normalizeGlobalVariable),
  };
};

export const getFailedTestResults = (results: RequestTestResults) => [
  ...results.statusCode,
  ...results.jsonFields,
].filter(result => !result.passed);

export const summarizeTestFailures = (results: RequestTestResults): string | null => {
  const failed = getFailedTestResults(results);
  if (!failed.length) return null;
  const suffix = `${failed.length} test${failed.length === 1 ? '' : 's'} failed`;
  return `${failed[0].message} (${suffix})`;
};
