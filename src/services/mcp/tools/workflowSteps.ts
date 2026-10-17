// Workflow 步骤：校验 AI 传入的步骤，输出现有步骤

import type { WorkflowCondition, WorkflowRequestOverrides, WorkflowStep } from '@/types/models';
import { conditionMatchesFor, getConditionMatch, getStepConditions, MAX_LOOP_DELAY_MS, MAX_LOOP_ITERATIONS } from '@/services/workflow/definition';
import { generateId } from '@/utils/id-generator';
import { CONDITION_OPERATORS } from '../schemas';
import { savedRequestExists } from './lookups';
import { useCollectionsStore } from '@/stores/collections';
import { findRequestReference } from '@/utils/collectionTree';
import { toKeyValues, toBody, toAuth, toTests, toSettings, toMethod, applyRequestFields, describeRequest } from './requestFields';
import { isRecord, isOneOf, fail, stringValue, requireUrl, hide } from './shared';
import { STEP_TYPES, CONDITION_SOURCES, CONDITION_FIELDS, SENSITIVE_HEADERS } from './types';

interface StepValidation {
  errors: string[];
  stepIds: Set<string>;
  requestStepIds: Set<string>;
}

function collectStepIds(steps: unknown, validation: StepValidation, path: string) {
  if (!Array.isArray(steps)) return;
  steps.forEach((step, index) => {
    if (!isRecord(step)) return;
    if (step.id !== undefined) {
      if (typeof step.id !== 'string' || !step.id) {
        validation.errors.push(`${path}[${index}].id must be a non-empty string`);
      } else if (validation.stepIds.has(step.id)) {
        validation.errors.push(`${path}[${index}].id "${step.id}" is used more than once`);
      } else {
        validation.stepIds.add(step.id);
        if (step.type === 'request') validation.requestStepIds.add(step.id);
      }
    }
    collectStepIds(step.thenSteps, validation, `${path}[${index}].thenSteps`);
    collectStepIds(step.elseSteps, validation, `${path}[${index}].elseSteps`);
    collectStepIds(step.childSteps, validation, `${path}[${index}].childSteps`);
  });
}

function toCondition(value: unknown, path: string, validation: StepValidation): WorkflowCondition | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    validation.errors.push(`${path} must be an object`);
    return undefined;
  }
  // 先按传入的值组装，下面逐项校验，不合法时记入 validation.errors
  const condition: WorkflowCondition = {
    source: value.source as WorkflowCondition['source'],
    field: (value.field ?? (value.source === 'globalVariable' || value.source === 'loopIndex' ? 'value' : 'status')) as WorkflowCondition['field'],
    operator: (value.operator ?? 'equals') as string,
    expectedValue: stringValue(value.expectedValue),
  };
  if (!CONDITION_SOURCES.includes(condition.source)) {
    validation.errors.push(`${path}.source must be one of ${CONDITION_SOURCES.join(', ')}`);
  }
  if (!CONDITION_FIELDS.includes(condition.field)) {
    validation.errors.push(`${path}.field must be one of ${CONDITION_FIELDS.join(', ')}`);
  }
  if (!CONDITION_OPERATORS.includes(condition.operator)) {
    validation.errors.push(`${path}.operator must be one of ${CONDITION_OPERATORS.join(', ')}`);
  }
  if (typeof value.path === 'string') condition.path = value.path;
  if (condition.source === 'stepResponse') {
    if (typeof value.stepId !== 'string' || !validation.requestStepIds.has(value.stepId)) {
      validation.errors.push(`${path}.stepId must be the id of a request step in this workflow`);
    } else {
      condition.stepId = value.stepId;
    }
  }
  const needsPath = condition.source === 'globalVariable'
    || ((condition.source === 'lastResponse' || condition.source === 'stepResponse')
      && (condition.field === 'header' || condition.field === 'jsonPath'));
  if (needsPath && !condition.path) {
    validation.errors.push(`${path}.path is required for this source and field`);
  }
  return condition;
}

/** condition（单个）或 conditions（多个）加 conditionMatch */
function toConditions(value: Record<string, unknown>, step: WorkflowStep, path: string, validation: StepValidation) {
  if (value.condition !== undefined && value.conditions !== undefined) {
    validation.errors.push(`${path}: pass either condition or conditions, not both`);
    return;
  }
  if (value.conditions !== undefined) {
    if (!Array.isArray(value.conditions) || value.conditions.length === 0) {
      validation.errors.push(`${path}.conditions must be a non-empty array`);
      return;
    }
    step.conditions = value.conditions
      .map((item, index) => toCondition(item, `${path}.conditions[${index}]`, validation))
      .filter((condition): condition is WorkflowCondition => Boolean(condition));
  } else if (value.condition !== undefined) {
    const condition = toCondition(value.condition, `${path}.condition`, validation);
    step.conditions = condition ? [condition] : [];
  } else {
    validation.errors.push(`${path}.condition or conditions is required for ${step.type} steps`);
    return;
  }

  const matches = conditionMatchesFor(step.type);
  if (value.conditionMatch === undefined) {
    step.conditionMatch = 'all';
  } else if (isOneOf(matches, value.conditionMatch)) {
    step.conditionMatch = value.conditionMatch;
  } else {
    validation.errors.push(`${path}.conditionMatch must be one of ${matches.join(', ')} for ${step.type} steps`);
  }
}

function toIterationCount(value: unknown, path: string, validation: StepValidation): number | undefined {
  if (value === undefined) return undefined;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_LOOP_ITERATIONS) {
    validation.errors.push(`${path} must be an integer between 1 and ${MAX_LOOP_ITERATIONS}`);
    return undefined;
  }
  return count;
}

function toDelay(value: unknown, path: string, validation: StepValidation): number | undefined {
  if (value === undefined) return undefined;
  const delay = Number(value);
  if (!Number.isInteger(delay) || delay < 0 || delay > MAX_LOOP_DELAY_MS) {
    validation.errors.push(`${path} must be an integer between 0 and ${MAX_LOOP_DELAY_MS}`);
    return undefined;
  }
  return delay || undefined;
}

function toOverrides(value: unknown, path: string, validation: StepValidation): WorkflowRequestOverrides | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    validation.errors.push(`${path} must be an object`);
    return undefined;
  }
  try {
    const overrides: WorkflowRequestOverrides = {};
    if (value.method !== undefined) overrides.method = toMethod(value.method);
    if (value.url !== undefined) overrides.url = requireUrl(value.url);
    if (value.params !== undefined) overrides.params = toKeyValues(value.params, 'params');
    if (value.headers !== undefined) overrides.headers = toKeyValues(value.headers, 'headers');
    if (value.body !== undefined) overrides.body = toBody(value.body);
    if (value.auth !== undefined) overrides.auth = toAuth(value.auth);
    if (value.tests !== undefined) overrides.testsConfig = toTests(value.tests);
    if (value.settings !== undefined) overrides.settings = toSettings(value.settings);
    return overrides;
  } catch (error) {
    validation.errors.push(`${path}: ${(error as Error).message}`);
    return undefined;
  }
}

function toStep(value: unknown, path: string, validation: StepValidation): WorkflowStep | null {
  if (!isRecord(value)) {
    validation.errors.push(`${path} must be an object`);
    return null;
  }
  if (!isOneOf(STEP_TYPES, value.type)) {
    validation.errors.push(`${path}.type must be one of ${STEP_TYPES.join(', ')}`);
    return null;
  }

  const type = value.type as WorkflowStep['type'];
  const defaultNames: Record<string, string> = {
    request: 'Request Step', if: 'If Condition', for: 'For Loop', while: 'While Loop', doWhile: 'Do While Loop', until: 'Until Loop', setVariables: 'Set Variables',
  };
  const step: WorkflowStep = {
    id: typeof value.id === 'string' && value.id ? value.id : generateId(),
    type,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : defaultNames[type],
    enabled: value.enabled !== false,
  };

  const children = (key: 'thenSteps' | 'elseSteps' | 'childSteps') => {
    const list = value[key];
    if (list === undefined) return [];
    if (!Array.isArray(list)) {
      validation.errors.push(`${path}.${key} must be an array`);
      return [];
    }
    return list
      .map((child, index) => toStep(child, `${path}.${key}[${index}]`, validation))
      .filter((child): child is WorkflowStep => Boolean(child));
  };

  if (type === 'setVariables') {
    if (!Array.isArray(value.variables) || value.variables.length === 0) {
      validation.errors.push(`${path}.variables must be a non-empty array of { key, value }`);
      return step;
    }
    step.variables = value.variables.map((item: unknown, index: number) => {
      if (!isRecord(item) || typeof item.key !== 'string' || !item.key.trim()) {
        validation.errors.push(`${path}.variables[${index}].key is required`);
        return { key: '', value: '', enabled: false };
      }
      return { key: item.key.trim(), value: stringValue(item.value), enabled: item.enabled !== false };
    });
    return step;
  }

  if (type === 'request') {
    if (value.requestId !== undefined && value.inlineRequest !== undefined) {
      validation.errors.push(`${path} must have exactly one of requestId or inlineRequest`);
      return step;
    }
    if (typeof value.requestId === 'string' && value.requestId) {
      if (!savedRequestExists(value.requestId)) {
        validation.errors.push(`${path}.requestId: request not found: ${value.requestId}`);
      }
      step.requestSource = 'reference';
      step.requestId = value.requestId;
      // 没给名称时用引用的请求的名称，日志中容易区分
      if (typeof value.name !== 'string' || !value.name.trim()) {
        step.name = findRequestReference(useCollectionsStore().collections, value.requestId)?.name || step.name;
      }
      step.requestOverrides = toOverrides(value.requestOverrides, `${path}.requestOverrides`, validation);
    } else if (isRecord(value.inlineRequest)) {
      try {
        step.requestSource = 'inline';
        requireUrl(value.inlineRequest.url);
        if ((typeof value.name !== 'string' || !value.name.trim()) && typeof value.inlineRequest.name === 'string' && value.inlineRequest.name.trim()) {
          step.name = value.inlineRequest.name.trim();
        }
        step.inlineRequest = applyRequestFields({ name: step.name, ...value.inlineRequest });
      } catch (error) {
        validation.errors.push(`${path}.inlineRequest: ${(error as Error).message}`);
      }
    } else {
      validation.errors.push(`${path} needs either requestId or inlineRequest`);
    }
    return step;
  }

  if (type === 'if') {
    toConditions(value, step, path, validation);
    step.thenSteps = children('thenSteps');
    step.elseSteps = children('elseSteps');
  } else {
    step.childSteps = children('childSteps');
    step.delayMs = toDelay(value.delayMs, `${path}.delayMs`, validation);
    if (type === 'for') {
      step.iterations = toIterationCount(value.iterations ?? 1, `${path}.iterations`, validation);
    } else {
      toConditions(value, step, path, validation);
      step.maxIterations = toIterationCount(value.maxIterations, `${path}.maxIterations`, validation);
    }
  }
  return step;
}

/** 校验并转换 AI 传入的步骤；有任何错误时一次性全部报告 */
export function buildWorkflowSteps(value: unknown): WorkflowStep[] {
  if (!Array.isArray(value)) fail('steps must be an array');
  const validation: StepValidation = { errors: [], stepIds: new Set(), requestStepIds: new Set() };
  collectStepIds(value, validation, 'steps');
  const steps = value
    .map((step, index) => toStep(step, `steps[${index}]`, validation))
    .filter((step): step is WorkflowStep => Boolean(step));
  if (validation.errors.length > 0) {
    fail(`Invalid workflow steps:\n- ${validation.errors.join('\n- ')}`);
  }
  return steps;
}

export function describeStep(step: WorkflowStep, revealSecrets = true): Record<string, unknown> {
  const described: Record<string, unknown> = { id: step.id, type: step.type, name: step.name, enabled: step.enabled };
  if (step.type === 'request') {
    if (step.requestSource === 'reference') {
      described.requestId = step.requestId;
      if (step.requestOverrides && Object.keys(step.requestOverrides).length > 0) {
        const overrides = step.requestOverrides;
        described.requestOverrides = {
          ...overrides,
          ...(overrides.headers ? {
            headers: overrides.headers.map(header => (
              SENSITIVE_HEADERS.has(header.key.toLowerCase())
                ? { ...header, value: hide(header.value, revealSecrets) }
                : header
            )),
          } : {}),
          ...(overrides.auth ? {
            auth: {
              ...overrides.auth,
              token: hide(overrides.auth.token || '', revealSecrets),
              password: hide(overrides.auth.password || '', revealSecrets),
            },
          } : {}),
        };
      }
    } else if (step.inlineRequest) {
      const { id, collectionId, folderId, ...inline } = describeRequest(step.inlineRequest, revealSecrets);
      described.inlineRequest = inline;
    }
    return described;
  }
  if (step.type === 'setVariables') {
    described.variables = (step.variables || []).map(({ key, value, enabled }) => ({ key, value, enabled }));
    return described;
  }
  const conditions = getStepConditions(step);
  if (conditions.length === 1) {
    described.condition = conditions[0];
  } else if (conditions.length > 1) {
    described.conditions = conditions;
    described.conditionMatch = getConditionMatch(step);
  }
  if (step.type === 'if') {
    described.thenSteps = (step.thenSteps || []).map(child => describeStep(child, revealSecrets));
    described.elseSteps = (step.elseSteps || []).map(child => describeStep(child, revealSecrets));
  } else {
    if (step.type === 'for') described.iterations = step.iterations;
    else described.maxIterations = step.maxIterations;
    if (step.delayMs) described.delayMs = step.delayMs;
    described.childSteps = (step.childSteps || []).map(child => describeStep(child, revealSecrets));
  }
  return described;
}

export function countSteps(steps: WorkflowStep[] = []): number {
  return steps.reduce((total, step) => total + 1
    + countSteps(step.thenSteps) + countSteps(step.elseSteps) + countSteps(step.childSteps), 0);
}
