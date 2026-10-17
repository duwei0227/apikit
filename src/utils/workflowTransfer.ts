import type { Request, WorkflowDefinition, WorkflowStep } from '@/types/models';
import { generateId } from '@/utils/id-generator';
import { applyWorkflowRequestOverrides } from '@/utils/workflowRequestOverrides';
import { cloneJson } from '@/utils/clone';

const childStepLists = (step: WorkflowStep): WorkflowStep[][] => [
  step.thenSteps || [],
  step.elseSteps || [],
  step.childSteps || [],
];

const isReferenceStep = (step: WorkflowStep) => (
  step.type === 'request' &&
  (step.requestSource === 'reference' || (!step.requestSource && !!step.requestId)) &&
  !!step.requestId
);

const mapSteps = (steps: WorkflowStep[], fn: (step: WorkflowStep) => WorkflowStep): WorkflowStep[] => (
  steps.map(step => {
    const mapped = fn(step);
    return {
      ...mapped,
      ...(mapped.thenSteps ? { thenSteps: mapSteps(mapped.thenSteps, fn) } : {}),
      ...(mapped.elseSteps ? { elseSteps: mapSteps(mapped.elseSteps, fn) } : {}),
      ...(mapped.childSteps ? { childSteps: mapSteps(mapped.childSteps, fn) } : {}),
    };
  })
);

/** 统计 Workflow 的步骤数（含嵌套）、引用的已保存请求和 inline 请求数量。 */
export const summarizeWorkflow = (workflow: WorkflowDefinition) => {
  let steps = 0;
  let inline = 0;
  const requestIds = new Set<string>();

  const walk = (list: WorkflowStep[]) => {
    for (const step of list) {
      steps++;
      if (isReferenceStep(step)) {
        requestIds.add(step.requestId!);
      } else if (step.type === 'request') {
        inline++;
      }
      childStepLists(step).forEach(walk);
    }
  };

  walk(workflow.steps || []);
  return { steps, inline, requestIds };
};

export const collectWorkflowRequestIds = (workflows: WorkflowDefinition[]): Set<string> => {
  const ids = new Set<string>();
  workflows.forEach(workflow => summarizeWorkflow(workflow).requestIds.forEach(id => ids.add(id)));
  return ids;
};

/**
 * 把引用步骤转成 inline 请求：requestId 不在 keepIds 中、且能在 requestMap 找到请求时，
 * 用应用了步骤覆盖配置后的请求副本作为 inlineRequest。找不到请求的步骤保持不变。
 */
export const inlineWorkflowReferences = (
  workflow: WorkflowDefinition,
  requestMap: Map<string, Request>,
  keepIds: Set<string>
): WorkflowDefinition => ({
  ...workflow,
  steps: mapSteps(workflow.steps || [], step => {
    if (!isReferenceStep(step) || keepIds.has(step.requestId!)) return { ...step };
    const request = requestMap.get(step.requestId!);
    if (!request) return { ...step };

    const resolved = applyWorkflowRequestOverrides(cloneJson(request), step.requestOverrides);
    const { requestId: _requestId, requestOverrides: _requestOverrides, ...rest } = step;
    return {
      ...rest,
      requestSource: 'inline',
      inlineRequest: { ...resolved, id: generateId(), collectionId: undefined, folderId: undefined },
    };
  }),
});

/** 导入时为 Workflow 生成新 ID，并把引用步骤的 requestId 换成导入后的新请求 ID。 */
export const remapWorkflow = (
  workflow: WorkflowDefinition,
  requestIdMap: Map<string, string>
): WorkflowDefinition => {
  const now = new Date().toISOString();
  return {
    ...workflow,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
    steps: mapSteps(workflow.steps || [], step => (
      isReferenceStep(step) && requestIdMap.has(step.requestId!)
        ? { ...step, requestId: requestIdMap.get(step.requestId!) }
        : { ...step }
    )),
  };
};

export const isWorkflowDefinition = (workflow: unknown): workflow is WorkflowDefinition => {
  if (!workflow || typeof workflow !== 'object') return false;
  const value = workflow as Record<string, unknown>;
  return typeof value.id === 'string' && typeof value.name === 'string' && Array.isArray(value.steps);
};
