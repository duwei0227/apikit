// Workflow 定义：步骤规范化和新建步骤（纯函数，不依赖 store）

import type { Request, WorkflowCondition, WorkflowConditionMatch, WorkflowDefinition, WorkflowStep } from '@/types/models';
import { generateId } from '@/utils/id-generator';
import { createEmptyRequest, DEFAULT_REQUEST_SETTINGS } from '@/utils/requestFactory';

/** Workflow 内联请求的默认值：与编辑器中新建的请求相同，并带默认设置 */
export const emptyRequest = (name: string = 'Untitled Request'): Request => createEmptyRequest({
  name,
  settings: { ...DEFAULT_REQUEST_SETTINGS },
});

export const defaultMaxLoopIterations = 30;
export const MAX_LOOP_ITERATIONS = 1000;
/** 循环间隔上限：1 小时 */
export const MAX_LOOP_DELAY_MS = 3_600_000;

export const defaultWorkflowCondition = (): WorkflowCondition => ({
  source: 'lastResponse',
  field: 'status',
  operator: 'equals',
  expectedValue: '200',
});

/** 步骤的条件列表；兼容旧版只有 condition 的步骤 */
export const getStepConditions = (step: WorkflowStep): WorkflowCondition[] => {
  if (step.conditions?.length) return step.conditions;
  return step.condition ? [step.condition] : [];
};

/** 步骤类型可用的组合方式：cumulative 只用于 until */
export const conditionMatchesFor = (type: WorkflowStep['type']): WorkflowConditionMatch[] => (
  type === 'until' ? ['all', 'any', 'cumulative'] : ['all', 'any']
);

/** 实际使用的组合方式：未设置或该步骤类型不支持时为 all */
export const getConditionMatch = (step: WorkflowStep): WorkflowConditionMatch => (
  step.conditionMatch && conditionMatchesFor(step.type).includes(step.conditionMatch) ? step.conditionMatch : 'all'
);

const normalizeWorkflowStep = (step: WorkflowStep): WorkflowStep => {
  const normalized: WorkflowStep = {
    ...step,
    enabled: step.enabled ?? true,
  };

  if (normalized.type === 'setVariables') {
    normalized.variables = (normalized.variables || []).map(variable => ({
      key: String(variable.key ?? ''),
      value: String(variable.value ?? ''),
      enabled: variable.enabled !== false,
    }));
    return normalized;
  }

  if (normalized.type === 'request') {
    normalized.requestSource = normalized.requestSource || (normalized.requestId ? 'reference' : 'inline');
    if (normalized.requestSource === 'inline' && !normalized.inlineRequest) {
      normalized.inlineRequest = emptyRequest(normalized.name || 'Inline Request');
    }
    return normalized;
  }

  if (normalized.type !== 'for') {
    const conditions = getStepConditions(normalized);
    normalized.conditions = (conditions.length ? conditions : [{} as Partial<WorkflowCondition>])
      .map(condition => ({ ...defaultWorkflowCondition(), ...condition }));
    normalized.conditionMatch = getConditionMatch(normalized);
  } else {
    delete normalized.conditions;
    delete normalized.conditionMatch;
  }
  delete normalized.condition;

  if (normalized.type === 'if') {
    normalized.thenSteps = (normalized.thenSteps || []).map(normalizeWorkflowStep);
    normalized.elseSteps = (normalized.elseSteps || []).map(normalizeWorkflowStep);
  }

  if (['for', 'while', 'doWhile', 'until'].includes(normalized.type)) {
    normalized.childSteps = (normalized.childSteps || []).map(normalizeWorkflowStep);
    const delayMs = Math.min(MAX_LOOP_DELAY_MS, Math.max(0, Math.floor(Number(normalized.delayMs) || 0)));
    if (delayMs > 0) normalized.delayMs = delayMs;
    else delete normalized.delayMs;
    if (normalized.type === 'for') {
      normalized.iterations = normalized.iterations ?? 1;
      delete normalized.maxIterations;
    } else {
      normalized.maxIterations = normalized.maxIterations || defaultMaxLoopIterations;
    }
  }

  return normalized;
};

export const normalizeWorkflowDefinition = (workflow: WorkflowDefinition): WorkflowDefinition => ({
  ...workflow,
  steps: (workflow.steps || []).map(normalizeWorkflowStep),
});

export const createWorkflowRequestStep = (requestId?: string, name: string = 'Request Step'): WorkflowStep => ({
  id: generateId(),
  type: 'request',
  name,
  enabled: true,
  requestSource: requestId ? 'reference' : 'inline',
  requestId,
  inlineRequest: requestId ? undefined : emptyRequest(name),
});

/** 新建请求步骤时的默认名称；选择已保存的请求后改用请求名称 */
const DEFAULT_REQUEST_STEP_NAMES = ['', 'Request Step', 'Existing Request'];

/** 步骤名称还是默认名称，或者是之前引用的请求的名称（用户没有改过）时，返回新请求的名称；否则保留原名称 */
export const referenceStepName = (currentName: string, newRequestName: string | undefined, previousRequestName?: string): string => {
  const name = currentName.trim();
  const untouched = DEFAULT_REQUEST_STEP_NAMES.includes(name) || (previousRequestName !== undefined && name === previousRequestName);
  return untouched && newRequestName ? newRequestName : currentName;
};

export type WorkflowControlStepType = 'if' | 'for' | 'while' | 'doWhile' | 'until';

export const createWorkflowControlStep = (type: WorkflowControlStepType): WorkflowStep => ({
  id: generateId(),
  type,
  name: type === 'if' ? 'If Condition' : type === 'for' ? 'For Loop' : type === 'while' ? 'While Loop' : type === 'doWhile' ? 'Do While Loop' : 'Until Loop',
  enabled: true,
  conditions: type === 'for' ? undefined : [defaultWorkflowCondition()],
  conditionMatch: type === 'for' ? undefined : 'all',
  thenSteps: type === 'if' ? [] : undefined,
  elseSteps: type === 'if' ? [] : undefined,
  childSteps: type === 'for' || type === 'while' || type === 'doWhile' || type === 'until' ? [] : undefined,
  iterations: type === 'for' ? 1 : undefined,
  maxIterations: type === 'while' || type === 'doWhile' || type === 'until' ? defaultMaxLoopIterations : undefined,
});

export const createWorkflowSetVariablesStep = (): WorkflowStep => ({
  id: generateId(),
  type: 'setVariables',
  name: 'Set Variables',
  enabled: true,
  variables: [{ key: '', value: '', enabled: true }],
});
