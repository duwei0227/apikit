// Workflow 条件：读取条件值并比较（纯函数，不依赖 store）

import { extractValueFromJsonPath } from '@/utils/jsonPath';
import type { HttpResponseView, WorkflowCondition, WorkflowConditionMatch } from '@/types/models';
import { parseJsonPreservingNumbers } from '@/utils/jsonFormat';
import type { WorkflowRuntimeContext } from './engine';

export { compareValues } from '@/utils/valueComparison';

export const responseFieldValue = (response: HttpResponseView | null | undefined, condition: WorkflowCondition): unknown => {
  if (!response) return undefined;
  if (condition.field === 'status') return response.status;
  if (condition.field === 'body') return response.rawBody || response.body;
  if (condition.field === 'header') {
    // 响应头名称为小写，条件中的名称不区分大小写
    const name = (condition.path || '').trim().toLowerCase();
    const entry = Object.entries(response.headers || {}).find(([key]) => key.toLowerCase() === name);
    return entry?.[1];
  }
  if (condition.field === 'jsonPath') {
    try {
      return extractValueFromJsonPath(parseJsonPreservingNumbers(response.testBody ?? response.rawBody), condition.path || '');
    } catch {
      return undefined;
    }
  }
  return undefined;
};

export const resolveConditionValue = (
  condition: WorkflowCondition | undefined,
  lastResponse: HttpResponseView | null,
  lastResponses: Record<string, HttpResponseView>,
  loopIndex: number,
  context: WorkflowRuntimeContext,
) => {
  if (!condition) return undefined;

  if (condition.source === 'lastResponse') {
    return responseFieldValue(lastResponse, condition);
  }
  if (condition.source === 'stepResponse') {
    return responseFieldValue(lastResponses[condition.stepId || ''], condition);
  }
  if (condition.source === 'loopIndex') {
    return loopIndex;
  }
  if (condition.source === 'globalVariable' && condition.path) {
    const token = `{{${condition.path}}}`;
    const replaced = context.replaceVariables?.(token);
    return replaced && replaced !== token ? replaced : undefined;
  }
  return undefined;
};

/** 按组合方式合并各条件的结果；没有条件时为 true（cumulative 的 passed 已是"满足过"） */
export const combineConditionChecks = (match: WorkflowConditionMatch, checks: Array<{ passed: boolean }>): boolean => {
  if (checks.length === 0) return true;
  return match === 'any' ? checks.some(check => check.passed) : checks.every(check => check.passed);
};
