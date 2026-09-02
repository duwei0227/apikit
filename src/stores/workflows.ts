import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { storageService } from '@/services/storage';
import { areTestsPassed, cancelHttpExecution, executeHttpRequest, extractValueFromJsonPath } from '@/services/http/HttpExecutionService';
import { useRequestsStore } from '@/stores/requests';
import type { Request, WorkflowCondition, WorkflowDefinition, WorkflowRunLog, WorkflowStep } from '@/types/models';
import { generateId } from '@/utils/id-generator';
import { parseJsonPreservingNumbers } from '@/utils/jsonFormat';
import { applyWorkflowRequestOverrides } from '@/utils/workflowRequestOverrides';
import { createDefaultTestConfig, summarizeTestFailures } from '@/utils/requestTests';

export interface WorkflowRuntimeContext {
  replaceVariables?: (value: string) => string;
  setGlobalVariable?: (key: string, value: string, enabled?: boolean, description?: string) => void;
  onConsoleLog?: (log: any) => void;
}

const emptyRequest = (name: string = 'Untitled Request'): Request => ({
  id: generateId(),
  name,
  method: 'GET',
  url: '',
  params: [{ key: '', value: '', enabled: true }],
  headers: [{ key: '', value: '', enabled: true }],
  body: {
    type: 'none',
    raw: '',
    formData: [{ key: '', value: '', type: 'text', enabled: true }],
    urlencoded: [{ key: '', value: '', enabled: true }],
  },
  auth: {
    type: 'none',
    token: '',
    username: '',
    password: '',
  },
  tests: createDefaultTestConfig(),
  testsConfig: createDefaultTestConfig(),
  settings: {
    followRedirects: true,
    maxRedirectCount: 10,
    verifySsl: true,
    autoEncodeUrl: true,
    acceptEncoding: true,
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const makeLog = (
  step: WorkflowStep,
  status: WorkflowRunLog['status'],
  level: WorkflowRunLog['level'],
  message: string,
  extra: Partial<WorkflowRunLog> = {},
): WorkflowRunLog => ({
  id: generateId(),
  stepId: step.id,
  stepName: step.name,
  stepType: step.type,
  level,
  status,
  message,
  timestamp: new Date().toISOString(),
  ...extra,
});

const defaultWorkflowCondition = (): WorkflowCondition => ({
  source: 'lastResponse',
  field: 'status',
  operator: 'equals',
  expectedValue: '200',
});

const normalizeWorkflowStep = (step: WorkflowStep): WorkflowStep => {
  const normalized: WorkflowStep = {
    ...step,
    enabled: step.enabled ?? true,
  };

  if (normalized.type === 'request') {
    normalized.requestSource = normalized.requestSource || (normalized.requestId ? 'reference' : 'inline');
    if (normalized.requestSource === 'inline' && !normalized.inlineRequest) {
      normalized.inlineRequest = emptyRequest(normalized.name || 'Inline Request');
    }
    return normalized;
  }

  if (normalized.type !== 'for') {
    normalized.condition = {
      ...defaultWorkflowCondition(),
      ...(normalized.condition || {}),
    };
  }

  if (normalized.type === 'if') {
    normalized.thenSteps = (normalized.thenSteps || []).map(normalizeWorkflowStep);
    normalized.elseSteps = (normalized.elseSteps || []).map(normalizeWorkflowStep);
  }

  if (['for', 'while', 'doWhile', 'until'].includes(normalized.type)) {
    normalized.childSteps = (normalized.childSteps || []).map(normalizeWorkflowStep);
    normalized.maxIterations = normalized.maxIterations || 10;
    if (normalized.type === 'for') {
      normalized.iterations = normalized.iterations ?? 1;
    }
  }

  return normalized;
};

export const normalizeWorkflowDefinition = (workflow: WorkflowDefinition): WorkflowDefinition => ({
  ...workflow,
  steps: (workflow.steps || []).map(normalizeWorkflowStep),
});

const compareValues = (actualValue: any, operator: string, expectedValue: string): boolean => {
  switch (operator) {
    case 'equals':
      return String(actualValue) === String(expectedValue);
    case 'notEquals':
      return String(actualValue) !== String(expectedValue);
    case 'contains':
      return String(actualValue).includes(expectedValue);
    case 'notContains':
      return !String(actualValue).includes(expectedValue);
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

const responseFieldValue = (response: any, condition: WorkflowCondition) => {
  if (!response) return undefined;
  if (condition.field === 'status') return response.status;
  if (condition.field === 'body') return response.rawBody || response.body;
  if (condition.field === 'header') return response.headers?.[condition.path || ''];
  if (condition.field === 'jsonPath') {
    try {
      return extractValueFromJsonPath(parseJsonPreservingNumbers(response.rawBody), condition.path || '');
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const resolveConditionValue = (
  condition: WorkflowCondition | undefined,
  lastResponse: any,
  lastResponses: Record<string, any>,
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

export const createWorkflowRequestStep = (requestId?: string, name: string = 'Request Step'): WorkflowStep => ({
  id: generateId(),
  type: 'request',
  name,
  enabled: true,
  requestSource: requestId ? 'reference' : 'inline',
  requestId,
  inlineRequest: requestId ? undefined : emptyRequest(name),
});

type WorkflowControlStepType = 'if' | 'for' | 'while' | 'doWhile' | 'until';

export const createWorkflowControlStep = (type: WorkflowControlStepType): WorkflowStep => ({
  id: generateId(),
  type,
  name: type === 'if' ? 'If Condition' : type === 'for' ? 'For Loop' : type === 'while' ? 'While Loop' : type === 'doWhile' ? 'Do While Loop' : 'Until Loop',
  enabled: true,
  condition: type === 'for' ? undefined : {
    source: 'lastResponse',
    field: 'status',
    operator: 'equals',
    expectedValue: '200',
  },
  thenSteps: type === 'if' ? [] : undefined,
  elseSteps: type === 'if' ? [] : undefined,
  childSteps: type === 'for' || type === 'while' || type === 'doWhile' || type === 'until' ? [] : undefined,
  iterations: type === 'for' ? 1 : undefined,
  maxIterations: type === 'while' || type === 'doWhile' || type === 'until' ? 10 : 10,
});

export const useWorkflowsStore = defineStore('workflows', () => {
  const workflows = ref<WorkflowDefinition[]>([]);
  const isLoading = ref(true);
  const isRunning = ref(false);
  const runningWorkflowId = ref<string | null>(null);
  const runningStartedAt = ref<number | null>(null);
  const activeWorkflowId = ref<string | null>(null);
  const runLogs = ref<WorkflowRunLog[]>([]);
  const workflowLogsById = ref<Record<string, WorkflowRunLog[]>>({});
  const currentRequestId = ref<string | null>(null);
  const stopRequested = ref(false);
  const lastResponses = ref<Record<string, any>>({});
  const loopIndex = ref(0);
  const workflowDrafts = ref<Map<string, WorkflowDefinition>>(new Map());
  const currentRunId = ref<string>('');
  const currentWorkflowId = ref<string>('');
  const currentWorkflowName = ref<string>('');
  const logSequence = ref(0);

  const activeWorkflow = computed(() => workflows.value.find(item => item.id === activeWorkflowId.value) || null);

  async function loadWorkflows() {
    isLoading.value = true;
    try {
      workflows.value = (await storageService.loadWorkflows()).map(normalizeWorkflowDefinition);
      const drafts = await storageService.loadWorkflowDrafts();
      workflowDrafts.value = new Map(
        Object.entries(drafts).map(([id, workflow]) => [id, normalizeWorkflowDefinition(workflow)])
      );
      if (!activeWorkflowId.value && workflows.value.length > 0) {
        activeWorkflowId.value = workflows.value[0].id;
      }
    } finally {
      isLoading.value = false;
    }
  }

  async function createWorkflow(name: string = 'New Workflow') {
    const now = new Date().toISOString();
    const workflow: WorkflowDefinition = {
      id: generateId(),
      name,
      steps: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    workflows.value.unshift(workflow);
    activeWorkflowId.value = workflow.id;
    await storageService.saveWorkflow(workflow);
    return workflow;
  }

  async function saveWorkflow(workflow: WorkflowDefinition) {
    const normalizedWorkflow = normalizeWorkflowDefinition({
      ...workflow,
      updatedAt: new Date().toISOString(),
    });
    const index = workflows.value.findIndex(item => item.id === normalizedWorkflow.id);
    if (index >= 0) {
      workflows.value[index] = JSON.parse(JSON.stringify(normalizedWorkflow));
    } else {
      workflows.value.unshift(JSON.parse(JSON.stringify(normalizedWorkflow)));
    }
    await storageService.saveWorkflow(normalizedWorkflow);
    clearWorkflowDraft(normalizedWorkflow.id);
  }

  function getWorkflowDraft(id: string): WorkflowDefinition | null {
    return workflowDrafts.value.get(id) || null;
  }

  function setWorkflowDraft(workflow: WorkflowDefinition) {
    const draft = normalizeWorkflowDefinition(JSON.parse(JSON.stringify(workflow)));
    const next = new Map(workflowDrafts.value);
    next.set(workflow.id, draft);
    workflowDrafts.value = next;
    storageService.saveWorkflowDraft(draft).catch(error => {
      console.error('Failed to save workflow draft:', error);
    });
  }

  function clearWorkflowDraft(id: string) {
    const next = new Map(workflowDrafts.value);
    next.delete(id);
    workflowDrafts.value = next;
    storageService.deleteWorkflowDraft(id).catch(error => {
      console.error('Failed to delete workflow draft:', error);
    });
  }

  async function restoreWorkflowDraft(id: string) {
    clearWorkflowDraft(id);
    const workflow = workflows.value.find(item => item.id === id);
    return workflow ? normalizeWorkflowDefinition(JSON.parse(JSON.stringify(workflow))) : null;
  }

  async function deleteWorkflow(id: string) {
    await storageService.deleteWorkflow(id);
    workflows.value = workflows.value.filter(item => item.id !== id);
    if (activeWorkflowId.value === id) {
      activeWorkflowId.value = workflows.value[0]?.id || null;
    }
  }

  function addLog(log: WorkflowRunLog): WorkflowRunLog {
    const enrichedLog = {
      ...log,
      runId: log.runId || currentRunId.value,
      workflowId: log.workflowId || currentWorkflowId.value,
      workflowName: log.workflowName || currentWorkflowName.value,
      sequence: log.sequence || ++logSequence.value,
    };
    runLogs.value.push(enrichedLog);

    if (enrichedLog.workflowId) {
      const existing = workflowLogsById.value[enrichedLog.workflowId] || [];
      workflowLogsById.value = {
        ...workflowLogsById.value,
        [enrichedLog.workflowId]: [...existing, enrichedLog],
      };
    }

    return enrichedLog;
  }

  function updateLog(log: WorkflowRunLog, updates: Partial<WorkflowRunLog>): WorkflowRunLog {
    const updatedLog = { ...log, ...updates };
    runLogs.value = runLogs.value.map(item => item.id === log.id ? updatedLog : item);

    if (updatedLog.workflowId) {
      const existing = workflowLogsById.value[updatedLog.workflowId] || [];
      workflowLogsById.value = {
        ...workflowLogsById.value,
        [updatedLog.workflowId]: existing.map(item => item.id === log.id ? updatedLog : item),
      };
    }

    return updatedLog;
  }

  function getRequestStats(parentId: string) {
    const logs = currentWorkflowId.value ? workflowLogsById.value[currentWorkflowId.value] || [] : runLogs.value;
    const childrenByParent = new Map<string, WorkflowRunLog[]>();
    logs.forEach(log => {
      if (!log.parentId) return;
      const children = childrenByParent.get(log.parentId) || [];
      children.push(log);
      childrenByParent.set(log.parentId, children);
    });

    let requestCount = 0;
    let passedRequestCount = 0;
    let failedRequestCount = 0;
    const visit = (id: string) => {
      (childrenByParent.get(id) || []).forEach(log => {
        if (log.stepType === 'request') {
          requestCount++;
          if (log.status === 'passed') passedRequestCount++;
          if (log.status === 'failed') failedRequestCount++;
        }
        visit(log.id);
      });
    };
    visit(parentId);
    return { requestCount, passedRequestCount, failedRequestCount };
  }

  const loopFailureState = (label: string, iteration: number, started: number, error: any) => ({
    level: (stopRequested.value ? 'warn' : 'error') as WorkflowRunLog['level'],
    status: (stopRequested.value ? 'stopped' : 'failed') as WorkflowRunLog['status'],
    message: stopRequested.value
      ? `${label} loop stopped at iteration ${iteration}`
      : `${label} loop failed at iteration ${iteration}: ${error?.message || String(error)}`,
    completedIterations: Math.max(0, iteration - 1),
    durationMs: Date.now() - started,
  });

  async function runLoopIteration(
    step: WorkflowStep,
    context: WorkflowRuntimeContext,
    lastResponse: any,
    depth: number,
    loopLog: WorkflowRunLog,
    iteration: number,
    label: string,
    iterationTotal?: number,
    conditionDetail?: ReturnType<typeof evaluateConditionDetail>,
  ) {
    const started = Date.now();
    let iterationLog = addLog(makeLog(step, 'started', 'info', `${label} iteration ${iterationTotal ? `${iteration}/${iterationTotal}` : iteration} running`, {
      depth: depth + 1,
      parentId: loopLog.id,
      iteration,
      iterationTotal,
      condition: conditionDetail === undefined ? undefined : step.condition,
      actualValue: typeof conditionDetail === 'object' ? conditionDetail.actualValue : undefined,
      conditionResult: conditionDetail === undefined ? undefined : typeof conditionDetail === 'boolean' ? conditionDetail : conditionDetail.passed,
    }));

    try {
      const response = await runSteps(step.childSteps || [], context, lastResponse, depth + 2, iterationLog.id);
      iterationLog = updateLog(iterationLog, {
        level: 'success',
        status: 'passed',
        message: `${label} iteration ${iterationTotal ? `${iteration}/${iterationTotal}` : iteration} completed`,
        durationMs: Date.now() - started,
        ...getRequestStats(iterationLog.id),
      });
      return { response, iterationLog };
    } catch (error: any) {
      iterationLog = updateLog(iterationLog, {
        level: stopRequested.value ? 'warn' : 'error',
        status: stopRequested.value ? 'stopped' : 'failed',
        message: stopRequested.value
          ? `${label} iteration ${iterationTotal ? `${iteration}/${iterationTotal}` : iteration} stopped`
          : `${label} iteration ${iterationTotal ? `${iteration}/${iterationTotal}` : iteration} failed`,
        durationMs: Date.now() - started,
        ...getRequestStats(iterationLog.id),
      });
      throw error;
    }
  }

  function evaluateConditionDetail(condition: WorkflowCondition | undefined, lastResponse: any, context: WorkflowRuntimeContext) {
    if (!condition) return true;

    const actualValue = resolveConditionValue(condition, lastResponse, lastResponses.value, loopIndex.value, context);
    const passed = compareValues(actualValue, condition.operator, condition.expectedValue);
    return { passed, actualValue };
  }

  function evaluateCondition(condition: WorkflowCondition | undefined, lastResponse: any, context: WorkflowRuntimeContext): boolean {
    const result = evaluateConditionDetail(condition, lastResponse, context);
    return typeof result === 'boolean' ? result : result.passed;
  }

  async function resolveStepRequest(step: WorkflowStep): Promise<Request | null> {
    if (step.requestSource === 'reference' && step.requestId) {
      const request = await useRequestsStore().reloadRequestFromStorage(step.requestId);
      return request ? applyWorkflowRequestOverrides(request, step.requestOverrides) : null;
    }
    return step.inlineRequest ? JSON.parse(JSON.stringify(step.inlineRequest)) : null;
  }

  async function runRequestStep(step: WorkflowStep, context: WorkflowRuntimeContext, depth: number, parentId?: string): Promise<any> {
    const started = Date.now();
    let requestLog = addLog(makeLog(step, 'running', 'info', 'Request running', { depth, parentId }));
    let result: Awaited<ReturnType<typeof executeHttpRequest>>;

    try {
      const request = await resolveStepRequest(step);
      if (!request) {
        requestLog = updateLog(requestLog, {
          status: 'failed',
          level: 'error',
          message: 'Request not found',
          durationMs: Date.now() - started,
        });
        throw new Error(`Request not found for step ${step.name}`);
      }
      if (stopRequested.value) throw new Error('Workflow stopped');

      result = await executeHttpRequest(request, {
        replaceVariables: context.replaceVariables,
        setGlobalVariable: context.setGlobalVariable,
        onConsoleLog: context.onConsoleLog,
        onRequestStart: requestId => { currentRequestId.value = requestId; },
      });
    } catch (error: any) {
      if (requestLog.status === 'running') {
        requestLog = updateLog(requestLog, {
          status: stopRequested.value ? 'stopped' : 'failed',
          level: stopRequested.value ? 'warn' : 'error',
          message: stopRequested.value
            ? 'Request stopped'
            : `Request failed: ${error?.message || String(error)}`,
          durationMs: Date.now() - started,
        });
      }
      throw error;
    } finally {
      currentRequestId.value = null;
    }

    lastResponses.value[step.id] = result.response;

    const durationMs = Date.now() - started;
    if (!areTestsPassed(result.testResults)) {
      const failureSummary = summarizeTestFailures(result.testResults) || 'Tests failed';
      requestLog = updateLog(requestLog, {
        status: 'failed',
        level: 'error',
        message: `${failureSummary}, workflow stopped`,
        durationMs,
        request: result.consoleLog,
        response: result.response,
        testResults: result.testResults,
      });
      throw new Error(`Tests failed in step ${step.name}`);
    }

    updateLog(requestLog, {
      status: 'passed',
      level: 'success',
      message: `Request completed: ${result.response.status}`,
      durationMs,
      request: result.consoleLog,
      response: result.response,
      testResults: result.testResults,
    });
    return result.response;
  }

  async function runSteps(
    steps: WorkflowStep[],
    context: WorkflowRuntimeContext,
    lastResponse: any = null,
    depth: number = 0,
    parentId?: string,
  ): Promise<any> {
    let currentLastResponse = lastResponse;

    for (const step of steps) {
      if (stopRequested.value) throw new Error('Workflow stopped');
      if (!step.enabled) {
        addLog(makeLog(step, 'skipped', 'info', 'Step disabled', { depth, parentId }));
        continue;
      }

      if (step.type === 'request') {
        currentLastResponse = await runRequestStep(step, context, depth, parentId);
      } else if (step.type === 'if') {
        const conditionDetail = evaluateConditionDetail(step.condition, currentLastResponse, context);
        const passed = typeof conditionDetail === 'boolean' ? conditionDetail : conditionDetail.passed;
        const elseSteps = step.elseSteps || [];
        if (!passed && elseSteps.length === 0) {
          addLog(makeLog(step, 'failed', 'error', 'If condition not matched and no else branch configured, workflow stopped', {
            depth,
            parentId,
            condition: step.condition,
            actualValue: typeof conditionDetail === 'boolean' ? undefined : conditionDetail.actualValue,
            conditionResult: false,
          }));
          throw new Error(`If condition failed without else branch in step ${step.name}`);
        }

        const branchLog = addLog(makeLog(step, passed ? 'then' : 'else', 'info', passed ? 'If condition matched, then branch selected' : 'If condition not matched, else branch selected', {
          depth,
          parentId,
          condition: step.condition,
          actualValue: typeof conditionDetail === 'boolean' ? undefined : conditionDetail.actualValue,
          conditionResult: passed,
        }));
        currentLastResponse = await runSteps(passed ? step.thenSteps || [] : elseSteps, context, currentLastResponse, depth + 1, branchLog.id);
      } else if (step.type === 'for') {
        const started = Date.now();
        const iterations = Math.max(0, Math.min(step.iterations || 0, step.maxIterations || 10));
        let loopLog = addLog(makeLog(step, 'started', 'info', `For loop running: 0/${iterations} iterations`, {
          depth,
          parentId,
          iterationTotal: iterations,
          completedIterations: 0,
        }));
        try {
          for (let index = 0; index < iterations; index++) {
            if (stopRequested.value) throw new Error('Workflow stopped');
            loopIndex.value = index + 1;
            loopLog = updateLog(loopLog, {
              message: `For loop running: ${index + 1}/${iterations} iterations`,
              completedIterations: index,
            });
            const result = await runLoopIteration(step, context, currentLastResponse, depth, loopLog, index + 1, 'For', iterations);
            currentLastResponse = result.response;
            loopLog = updateLog(loopLog, {
              completedIterations: index + 1,
              ...getRequestStats(loopLog.id),
            });
          }
          loopLog = updateLog(loopLog, {
            level: 'success',
            status: 'completed',
            message: `For loop completed: ${iterations}/${iterations} iterations`,
            completedIterations: iterations,
            durationMs: Date.now() - started,
            ...getRequestStats(loopLog.id),
          });
        } catch (error: any) {
          loopLog = updateLog(loopLog, {
            ...loopFailureState('For', Math.min(iterations || 1, (loopLog.completedIterations || 0) + 1), started, error),
            ...getRequestStats(loopLog.id),
          });
          throw error;
        }
      } else if (step.type === 'while') {
        const started = Date.now();
        let loopLog = addLog(makeLog(step, 'started', 'info', 'While loop running', {
          depth,
          parentId,
          condition: step.condition,
          completedIterations: 0,
        }));
        const maxIterations = Math.max(1, step.maxIterations || 10);
        let index = 0;
        let reachedMaxIterations = false;
        let conditionDetail: ReturnType<typeof evaluateConditionDetail> = true;
        try {
          loopIndex.value = index + 1;
          conditionDetail = evaluateConditionDetail(step.condition, currentLastResponse, context);
          while (typeof conditionDetail === 'boolean' ? conditionDetail : conditionDetail.passed) {
            if (stopRequested.value) throw new Error('Workflow stopped');
            if (index >= maxIterations) {
              reachedMaxIterations = true;
              loopLog = updateLog(loopLog, {
                level: 'warn',
                status: 'stopped',
                message: `While loop stopped: reached max iterations ${maxIterations}`,
                completedIterations: index,
                durationMs: Date.now() - started,
                condition: step.condition,
                actualValue: typeof conditionDetail === 'boolean' ? undefined : conditionDetail.actualValue,
                conditionResult: true,
                ...getRequestStats(loopLog.id),
              });
              break;
            }
            loopIndex.value = index + 1;
            loopLog = updateLog(loopLog, {
              message: `While loop running: iteration ${index + 1}`,
              completedIterations: index,
            });
            const result = await runLoopIteration(step, context, currentLastResponse, depth, loopLog, index + 1, 'While', undefined, conditionDetail);
            currentLastResponse = result.response;
            index++;
            loopLog = updateLog(loopLog, {
              completedIterations: index,
              ...getRequestStats(loopLog.id),
            });
            loopIndex.value = index + 1;
            conditionDetail = evaluateConditionDetail(step.condition, currentLastResponse, context);
          }
          if (!reachedMaxIterations) {
            loopLog = updateLog(loopLog, {
              level: 'success',
              status: 'completed',
              message: `While loop completed: ${index} iteration${index === 1 ? '' : 's'}`,
              completedIterations: index,
              durationMs: Date.now() - started,
              condition: step.condition,
              actualValue: typeof conditionDetail === 'boolean' ? undefined : conditionDetail.actualValue,
              conditionResult: false,
              ...getRequestStats(loopLog.id),
            });
          }
        } catch (error: any) {
          loopLog = updateLog(loopLog, {
            ...loopFailureState('While', index + 1, started, error),
            ...getRequestStats(loopLog.id),
          });
          throw error;
        }
      } else if (step.type === 'doWhile') {
        const started = Date.now();
        let loopLog = addLog(makeLog(step, 'started', 'info', 'Do while loop running', {
          depth,
          parentId,
          condition: step.condition,
          completedIterations: 0,
        }));
        const maxIterations = Math.max(1, step.maxIterations || 10);
        let index = 0;
        let conditionDetail: ReturnType<typeof evaluateConditionDetail> = true;
        let reachedMaxIterations = false;

        try {
          do {
            if (stopRequested.value) throw new Error('Workflow stopped');
            loopIndex.value = index + 1;
            loopLog = updateLog(loopLog, {
              message: `Do while loop running: iteration ${index + 1}`,
              completedIterations: index,
            });
            const result = await runLoopIteration(step, context, currentLastResponse, depth, loopLog, index + 1, 'Do while');
            currentLastResponse = result.response;
            index++;
            loopIndex.value = index + 1;
            conditionDetail = evaluateConditionDetail(step.condition, currentLastResponse, context);
            const shouldContinue = typeof conditionDetail === 'boolean' ? conditionDetail : conditionDetail.passed;
            updateLog(result.iterationLog, {
              condition: step.condition,
              actualValue: typeof conditionDetail === 'boolean' ? undefined : conditionDetail.actualValue,
              conditionResult: shouldContinue,
            });
            loopLog = updateLog(loopLog, {
              completedIterations: index,
              ...getRequestStats(loopLog.id),
            });

            if (shouldContinue && index >= maxIterations) {
              reachedMaxIterations = true;
              loopLog = updateLog(loopLog, {
                level: 'warn',
                status: 'stopped',
                message: `Do while loop stopped: reached max iterations ${maxIterations}`,
                completedIterations: index,
                durationMs: Date.now() - started,
                condition: step.condition,
                actualValue: typeof conditionDetail === 'boolean' ? undefined : conditionDetail.actualValue,
                conditionResult: true,
                ...getRequestStats(loopLog.id),
              });
              break;
            }

            if (!shouldContinue) break;
          } while (true);

          if (!reachedMaxIterations) {
            loopLog = updateLog(loopLog, {
              level: 'success',
              status: 'completed',
              message: `Do while loop completed: ${index} iteration${index === 1 ? '' : 's'}`,
              completedIterations: index,
              durationMs: Date.now() - started,
              condition: step.condition,
              actualValue: typeof conditionDetail === 'boolean' ? undefined : conditionDetail.actualValue,
              conditionResult: typeof conditionDetail === 'boolean' ? conditionDetail : conditionDetail.passed,
              ...getRequestStats(loopLog.id),
            });
          }
        } catch (error: any) {
          loopLog = updateLog(loopLog, {
            ...loopFailureState('Do while', index + 1, started, error),
            ...getRequestStats(loopLog.id),
          });
          throw error;
        }
      } else if (step.type === 'until') {
        const started = Date.now();
        let loopLog = addLog(makeLog(step, 'started', 'info', 'Until loop running', {
          depth,
          parentId,
          condition: step.condition,
          completedIterations: 0,
        }));
        const maxIterations = Math.max(1, step.maxIterations || 10);
        let index = 0;
        let conditionDetail: ReturnType<typeof evaluateConditionDetail> = false;
        let reachedMaxIterations = false;

        try {
          do {
            if (stopRequested.value) throw new Error('Workflow stopped');
            loopIndex.value = index + 1;
            loopLog = updateLog(loopLog, {
              message: `Until loop running: iteration ${index + 1}`,
              completedIterations: index,
            });
            const result = await runLoopIteration(step, context, currentLastResponse, depth, loopLog, index + 1, 'Until');
            currentLastResponse = result.response;
            index++;
            loopIndex.value = index + 1;
            conditionDetail = evaluateConditionDetail(step.condition, currentLastResponse, context);

            const isSatisfied = typeof conditionDetail === 'boolean' ? conditionDetail : conditionDetail.passed;
            updateLog(result.iterationLog, {
              condition: step.condition,
              actualValue: typeof conditionDetail === 'boolean' ? undefined : conditionDetail.actualValue,
              conditionResult: isSatisfied,
            });
            loopLog = updateLog(loopLog, {
              completedIterations: index,
              ...getRequestStats(loopLog.id),
            });
            if (isSatisfied) break;
            if (index >= maxIterations) {
              reachedMaxIterations = true;
              loopLog = updateLog(loopLog, {
                level: 'warn',
                status: 'stopped',
                message: `Until loop stopped: reached max iterations ${maxIterations}`,
                completedIterations: index,
                durationMs: Date.now() - started,
                condition: step.condition,
                actualValue: typeof conditionDetail === 'boolean' ? undefined : conditionDetail.actualValue,
                conditionResult: false,
                ...getRequestStats(loopLog.id),
              });
              break;
            }
          } while (true);

          if (!reachedMaxIterations) {
            loopLog = updateLog(loopLog, {
              level: 'success',
              status: 'completed',
              message: `Until loop completed: condition satisfied at iteration ${index}`,
              completedIterations: index,
              durationMs: Date.now() - started,
              condition: step.condition,
              actualValue: typeof conditionDetail === 'boolean' ? undefined : conditionDetail.actualValue,
              conditionResult: typeof conditionDetail === 'boolean' ? conditionDetail : conditionDetail.passed,
              ...getRequestStats(loopLog.id),
            });
          }
        } catch (error: any) {
          loopLog = updateLog(loopLog, {
            ...loopFailureState('Until', index + 1, started, error),
            ...getRequestStats(loopLog.id),
          });
          throw error;
        }
      }
    }

    return currentLastResponse;
  }

  async function runWorkflow(workflow: WorkflowDefinition, context: WorkflowRuntimeContext = {}) {
    if (isRunning.value) return;
    const normalizedWorkflow = normalizeWorkflowDefinition(JSON.parse(JSON.stringify(workflow)));

    isRunning.value = true;
    stopRequested.value = false;
    currentRequestId.value = null;
    runningWorkflowId.value = normalizedWorkflow.id;
    runningStartedAt.value = Date.now();
    lastResponses.value = {};
    loopIndex.value = 1;
    currentRunId.value = generateId();
    currentWorkflowId.value = normalizedWorkflow.id;
    currentWorkflowName.value = normalizedWorkflow.name;
    logSequence.value = 0;
    runLogs.value = [];
    workflowLogsById.value = {
      ...workflowLogsById.value,
      [normalizedWorkflow.id]: [],
    };

    const started = Date.now();
    let workflowLog = addLog({
      id: generateId(),
      stepId: normalizedWorkflow.id,
      stepName: normalizedWorkflow.name,
      stepType: 'workflow',
      level: 'info',
      status: 'started',
      message: 'Workflow started',
      timestamp: new Date().toISOString(),
    });

    try {
      await runSteps(normalizedWorkflow.steps, context, null, 1, workflowLog.id);
      workflowLog = updateLog(workflowLog, {
        level: 'success',
        status: 'completed',
        message: 'Workflow completed',
        durationMs: Date.now() - started,
        ...getRequestStats(workflowLog.id),
      });
    } catch (error: any) {
      workflowLog = updateLog(workflowLog, {
        level: stopRequested.value ? 'warn' : 'error',
        status: stopRequested.value ? 'stopped' : 'failed',
        message: error?.message || String(error),
        durationMs: Date.now() - started,
        ...getRequestStats(workflowLog.id),
      });
    } finally {
      isRunning.value = false;
      runningWorkflowId.value = null;
      runningStartedAt.value = null;
      currentRequestId.value = null;
    }
  }

  async function stopWorkflow() {
    stopRequested.value = true;
    if (currentRequestId.value) {
      await cancelHttpExecution(currentRequestId.value);
    }
  }

  function clearLogs() {
    runLogs.value = [];
    workflowLogsById.value = {};
  }

  function clearWorkflowLogs(workflowId: string) {
    if (!workflowId) return;
    workflowLogsById.value = {
      ...workflowLogsById.value,
      [workflowId]: [],
    };
    if (currentWorkflowId.value === workflowId) {
      runLogs.value = [];
    }
  }

  function getWorkflowLogs(workflowId: string) {
    return workflowLogsById.value[workflowId] || [];
  }

  return {
    workflows,
    isLoading,
    isRunning,
    runningWorkflowId,
    runningStartedAt,
    activeWorkflowId,
    activeWorkflow,
    runLogs,
    workflowLogsById,
    loadWorkflows,
    createWorkflow,
    saveWorkflow,
    deleteWorkflow,
    runWorkflow,
    stopWorkflow,
    clearLogs,
    clearWorkflowLogs,
    getWorkflowLogs,
    getWorkflowDraft,
    setWorkflowDraft,
    clearWorkflowDraft,
    restoreWorkflowDraft,
  };
});
