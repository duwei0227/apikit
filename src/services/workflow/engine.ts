// Workflow 执行引擎：按步骤执行请求、条件分支和循环，并写入运行日志。
// 不依赖 Pinia：停止标志、日志记录、加载已保存的请求都由调用方注入。

import { areTestsPassed, executeHttpRequest } from '@/services/http/HttpExecutionService';
import type { ConsoleLog, HttpResponseView, Request, WorkflowConditionCheck, WorkflowDefinition, WorkflowRunLog, WorkflowStep } from '@/types/models';
import { generateId } from '@/utils/id-generator';
import { summarizeTestFailures } from '@/utils/requestTests';
import { applyWorkflowRequestOverrides } from '@/utils/workflowRequestOverrides';
import { combineConditionChecks, compareValues, resolveConditionValue } from './conditions';
import { defaultMaxLoopIterations, getConditionMatch, getStepConditions } from './definition';
import type { RunLogRecorder } from './runLog';
import { cloneJson } from '@/utils/clone';
import { replaceLoopIndex } from '@/services/variables/dynamicVariables';

export interface WorkflowRuntimeContext {
  replaceVariables?: (value: string) => string;
  setGlobalVariable?: (key: string, value: string, enabled?: boolean, description?: string) => void;
  onConsoleLog?: (log: ConsoleLog) => void;
}

/** 条件判断结果：passed 为所有条件按组合方式合并后的结果；没有条件时为 true */
interface ConditionEvaluation {
  passed: boolean;
  checks: WorkflowConditionCheck[];
}

/** cumulative 模式的进度：每个条件首次满足时的循环次数，在一次循环步骤开始时重置 */
interface CumulativeProgress {
  metAt: Array<number | undefined>;
  iteration: number;
}

/** 写入日志的条件字段；evaluation 缺省时只记录条件本身 */
const conditionLogFields = (step: WorkflowStep, evaluation?: ConditionEvaluation): Partial<WorkflowRunLog> => {
  const conditions = getStepConditions(step);
  if (conditions.length === 0) return {};
  const multiple = conditions.length > 1;
  return {
    condition: evaluation?.checks[0]?.condition ?? conditions[0],
    ...(multiple ? { conditionMatch: getConditionMatch(step) } : {}),
    ...(evaluation ? {
      actualValue: multiple ? undefined : evaluation.checks[0]?.actualValue,
      conditionResult: evaluation.passed,
      ...(multiple ? { conditionChecks: evaluation.checks } : {}),
    } : {}),
  };
};

const errorText = (error: unknown) => (error as Error | null)?.message || String(error);

export interface WorkflowEngineHooks {
  log: RunLogRecorder;
  isStopRequested: () => boolean;
  /** 读取 Workflow 引用的已保存请求（有未保存的修改时用修改后的版本） */
  loadRequest: (requestId: string) => Promise<Request | null>;
  /** 请求开始和结束，用于停止 Workflow 时取消正在进行的请求 */
  onRequestStart?: (requestId: string) => void;
  onRequestEnd?: () => void;
}

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

export const createWorkflowEngine = (context: WorkflowRuntimeContext, hooks: WorkflowEngineHooks) => {
  const { log } = hooks;
  // 每次运行独立的状态：各请求步骤的响应（供条件读取）和当前循环序号
  const lastResponses: Record<string, HttpResponseView> = {};
  let loopIndex = 1;
  // 正在执行的各层循环的序号（从 1 开始），请求中的 {{$loopIndex}} 取最内层
  const runningIterations: number[] = [];

  /** 在循环中时先把 {{$loopIndex}} 换成当前序号，再交给变量解析 */
  const withLoopIndex = (replaceVariables?: (value: string) => string) => {
    const current = runningIterations[runningIterations.length - 1];
    if (current === undefined) return replaceVariables;
    return (value: string) => {
      const replaced = replaceLoopIndex(value, current);
      return replaceVariables ? replaceVariables(replaced) : replaced;
    };
  };

  const loopFailureState = (label: string, iteration: number, started: number, error: unknown) => ({
    level: (hooks.isStopRequested() ? 'warn' : 'error') as WorkflowRunLog['level'],
    status: (hooks.isStopRequested() ? 'stopped' : 'failed') as WorkflowRunLog['status'],
    message: hooks.isStopRequested()
      ? `${label} loop stopped at iteration ${iteration}`
      : `${label} loop failed at iteration ${iteration}: ${errorText(error)}`,
    completedIterations: Math.max(0, iteration - 1),
    durationMs: Date.now() - started,
  });

  async function runLoopIteration(
    step: WorkflowStep,
    context: WorkflowRuntimeContext,
    lastResponse: HttpResponseView | null,
    depth: number,
    loopLog: WorkflowRunLog,
    iteration: number,
    label: string,
    iterationTotal?: number,
    evaluation?: ConditionEvaluation,
  ) {
    const started = Date.now();
    let iterationLog = log.add(makeLog(step, 'started', 'info', `${label} iteration ${iterationTotal ? `${iteration}/${iterationTotal}` : iteration} running`, {
      depth: depth + 1,
      parentId: loopLog.id,
      iteration,
      iterationTotal,
      ...(evaluation ? conditionLogFields(step, evaluation) : {}),
    }));

    try {
      runningIterations.push(iteration);
      let response: HttpResponseView | null;
      try {
        response = await runSteps(step.childSteps || [], context, lastResponse, depth + 2, iterationLog.id);
      } finally {
        runningIterations.pop();
      }
      iterationLog = log.update(iterationLog, {
        level: 'success',
        status: 'passed',
        message: `${label} iteration ${iterationTotal ? `${iteration}/${iterationTotal}` : iteration} completed`,
        durationMs: Date.now() - started,
        ...log.stats(iterationLog.id),
      });
      return { response, iterationLog };
    } catch (error) {
      iterationLog = log.update(iterationLog, {
        level: hooks.isStopRequested() ? 'warn' : 'error',
        status: hooks.isStopRequested() ? 'stopped' : 'failed',
        message: hooks.isStopRequested()
          ? `${label} iteration ${iterationTotal ? `${iteration}/${iterationTotal}` : iteration} stopped`
          : `${label} iteration ${iterationTotal ? `${iteration}/${iterationTotal}` : iteration} failed`,
        durationMs: Date.now() - started,
        ...log.stats(iterationLog.id),
      });
      throw error;
    }
  }

  function evaluateConditions(
    step: WorkflowStep,
    lastResponse: HttpResponseView | null,
    context: WorkflowRuntimeContext,
    progress?: CumulativeProgress,
  ): ConditionEvaluation {
    const match = getConditionMatch(step);
    const cumulative = match === 'cumulative' ? progress : undefined;
    const checks = getStepConditions(step).map((rawCondition, index): WorkflowConditionCheck => {
      // 期望值可以使用 {{变量}}；日志中记录替换后的值
      const replaceVariables = withLoopIndex(context.replaceVariables);
      const expectedValue = rawCondition.expectedValue && replaceVariables
        ? replaceVariables(rawCondition.expectedValue)
        : rawCondition.expectedValue;
      const condition = { ...rawCondition, expectedValue };
      const actualValue = resolveConditionValue(condition, lastResponse, lastResponses, loopIndex, context);
      const passed = compareValues(actualValue, condition.operator, expectedValue);
      if (!cumulative) return { condition, actualValue, passed };
      // 满足过的条件保持满足
      if (passed && cumulative.metAt[index] === undefined) cumulative.metAt[index] = cumulative.iteration;
      const metAtIteration = cumulative.metAt[index];
      return { condition, actualValue, passed: metAtIteration !== undefined, ...(metAtIteration !== undefined ? { metAtIteration } : {}) };
    });
    return { passed: combineConditionChecks(match, checks), checks };
  }

  /** 循环之间等待 step.delayMs；期间每 100ms 检查一次停止请求 */
  async function waitBetweenIterations(step: WorkflowStep, index: number) {
    if (index === 0 || !step.delayMs) return;
    const until = Date.now() + step.delayMs;
    while (Date.now() < until) {
      if (hooks.isStopRequested()) throw new Error('Workflow stopped');
      await new Promise(resolve => setTimeout(resolve, Math.min(100, until - Date.now())));
    }
    if (hooks.isStopRequested()) throw new Error('Workflow stopped');
  }

  async function resolveStepRequest(step: WorkflowStep): Promise<Request | null> {
    if (step.requestSource === 'reference' && step.requestId) {
      const request = await hooks.loadRequest(step.requestId);
      return request ? applyWorkflowRequestOverrides(request, step.requestOverrides) : null;
    }
    return step.inlineRequest ? cloneJson(step.inlineRequest) : null;
  }

  async function runRequestStep(step: WorkflowStep, context: WorkflowRuntimeContext, depth: number, parentId?: string): Promise<HttpResponseView> {
    const started = Date.now();
    let requestLog = log.add(makeLog(step, 'running', 'info', 'Request running', { depth, parentId }));
    let result: Awaited<ReturnType<typeof executeHttpRequest>>;

    try {
      const request = await resolveStepRequest(step);
      if (!request) {
        requestLog = log.update(requestLog, {
          status: 'failed',
          level: 'error',
          message: 'Request not found',
          durationMs: Date.now() - started,
        });
        throw new Error(`Request not found for step ${step.name}`);
      }
      if (hooks.isStopRequested()) throw new Error('Workflow stopped');

      result = await executeHttpRequest(request, {
        replaceVariables: withLoopIndex(context.replaceVariables),
        setGlobalVariable: context.setGlobalVariable,
        onConsoleLog: context.onConsoleLog,
        onRequestStart: requestId => hooks.onRequestStart?.(requestId),
      });
    } catch (error) {
      if (requestLog.status === 'running') {
        requestLog = log.update(requestLog, {
          status: hooks.isStopRequested() ? 'stopped' : 'failed',
          level: hooks.isStopRequested() ? 'warn' : 'error',
          message: hooks.isStopRequested()
            ? 'Request stopped'
            : `Request failed: ${errorText(error)}`,
          durationMs: Date.now() - started,
        });
      }
      throw error;
    } finally {
      hooks.onRequestEnd?.();
    }

    lastResponses[step.id] = result.response;

    const durationMs = Date.now() - started;
    if (!areTestsPassed(result.testResults)) {
      const failureSummary = summarizeTestFailures(result.testResults) || 'Tests failed';
      requestLog = log.update(requestLog, {
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

    log.update(requestLog, {
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

  /** 设置全局变量；值中的 {{变量}} 和 {{$loopIndex}} 先替换 */
  function runSetVariablesStep(step: WorkflowStep, context: WorkflowRuntimeContext, depth: number, parentId?: string) {
    const replaceVariables = withLoopIndex(context.replaceVariables);
    const assigned = (step.variables || [])
      .filter(variable => variable.enabled !== false && variable.key.trim())
      .map(variable => ({
        key: variable.key.trim(),
        value: replaceVariables ? replaceVariables(variable.value) : variable.value,
      }));
    assigned.forEach(({ key, value }) => context.setGlobalVariable?.(key, value));
    log.add(makeLog(step, 'passed', 'success', `Set ${assigned.length} variable${assigned.length === 1 ? '' : 's'}`, {
      depth,
      parentId,
      setVariables: assigned,
    }));
  }

  async function runSteps(
    steps: WorkflowStep[],
    context: WorkflowRuntimeContext,
    lastResponse: HttpResponseView | null = null,
    depth: number = 0,
    parentId?: string,
  ): Promise<HttpResponseView | null> {
    let currentLastResponse = lastResponse;

    for (const step of steps) {
      if (hooks.isStopRequested()) throw new Error('Workflow stopped');
      if (!step.enabled) {
        log.add(makeLog(step, 'skipped', 'info', 'Step disabled', { depth, parentId }));
        continue;
      }

      if (step.type === 'request') {
        currentLastResponse = await runRequestStep(step, context, depth, parentId);
      } else if (step.type === 'setVariables') {
        runSetVariablesStep(step, context, depth, parentId);
      } else if (step.type === 'if') {
        const conditionDetail = evaluateConditions(step, currentLastResponse, context);
        const passed = conditionDetail.passed;
        const elseSteps = step.elseSteps || [];
        if (!passed && elseSteps.length === 0) {
          log.add(makeLog(step, 'failed', 'error', 'If condition not matched and no else branch configured, workflow stopped', {
            depth,
            parentId,
            ...conditionLogFields(step, conditionDetail),
          }));
          throw new Error(`If condition failed without else branch in step ${step.name}`);
        }

        const branchLog = log.add(makeLog(step, passed ? 'then' : 'else', 'info', passed ? 'If condition matched, then branch selected' : 'If condition not matched, else branch selected', {
          depth,
          parentId,
          ...conditionLogFields(step, conditionDetail),
        }));
        currentLastResponse = await runSteps(passed ? step.thenSteps || [] : elseSteps, context, currentLastResponse, depth + 1, branchLog.id);
      } else if (step.type === 'for') {
        const started = Date.now();
        const iterations = Math.max(0, step.iterations || 0);
        let loopLog = log.add(makeLog(step, 'started', 'info', `For loop running: 0/${iterations} iterations`, {
          depth,
          parentId,
          iterationTotal: iterations,
          completedIterations: 0,
        }));
        try {
          for (let index = 0; index < iterations; index++) {
            if (hooks.isStopRequested()) throw new Error('Workflow stopped');
            await waitBetweenIterations(step, index);
            loopIndex = index + 1;
            loopLog = log.update(loopLog, {
              message: `For loop running: ${index + 1}/${iterations} iterations`,
              completedIterations: index,
            });
            const result = await runLoopIteration(step, context, currentLastResponse, depth, loopLog, index + 1, 'For', iterations);
            currentLastResponse = result.response;
            loopLog = log.update(loopLog, {
              completedIterations: index + 1,
              ...log.stats(loopLog.id),
            });
          }
          loopLog = log.update(loopLog, {
            level: 'success',
            status: 'completed',
            message: `For loop completed: ${iterations}/${iterations} iterations`,
            completedIterations: iterations,
            durationMs: Date.now() - started,
            ...log.stats(loopLog.id),
          });
        } catch (error) {
          loopLog = log.update(loopLog, {
            ...loopFailureState('For', Math.min(iterations || 1, (loopLog.completedIterations || 0) + 1), started, error),
            ...log.stats(loopLog.id),
          });
          throw error;
        }
      } else if (step.type === 'while') {
        const started = Date.now();
        let loopLog = log.add(makeLog(step, 'started', 'info', 'While loop running', {
          depth,
          parentId,
          ...conditionLogFields(step),
          completedIterations: 0,
        }));
        const maxIterations = Math.max(1, step.maxIterations || defaultMaxLoopIterations);
        let index = 0;
        let reachedMaxIterations = false;
        let conditionDetail: ConditionEvaluation | undefined;
        try {
          loopIndex = index + 1;
          conditionDetail = evaluateConditions(step, currentLastResponse, context);
          while (conditionDetail.passed) {
            if (hooks.isStopRequested()) throw new Error('Workflow stopped');
            if (index >= maxIterations) {
              reachedMaxIterations = true;
              loopLog = log.update(loopLog, {
                level: 'warn',
                status: 'stopped',
                message: `While loop stopped: reached max iterations ${maxIterations}`,
                completedIterations: index,
                durationMs: Date.now() - started,
                ...conditionLogFields(step, conditionDetail),
                ...log.stats(loopLog.id),
              });
              break;
            }
            await waitBetweenIterations(step, index);
            loopIndex = index + 1;
            loopLog = log.update(loopLog, {
              message: `While loop running: iteration ${index + 1}`,
              completedIterations: index,
            });
            const result = await runLoopIteration(step, context, currentLastResponse, depth, loopLog, index + 1, 'While', undefined, conditionDetail);
            currentLastResponse = result.response;
            index++;
            loopLog = log.update(loopLog, {
              completedIterations: index,
              ...log.stats(loopLog.id),
            });
            loopIndex = index + 1;
            conditionDetail = evaluateConditions(step, currentLastResponse, context);
          }
          if (!reachedMaxIterations) {
            loopLog = log.update(loopLog, {
              level: 'success',
              status: 'completed',
              message: `While loop completed: ${index} iteration${index === 1 ? '' : 's'}`,
              completedIterations: index,
              durationMs: Date.now() - started,
              ...conditionLogFields(step, conditionDetail),
              ...log.stats(loopLog.id),
            });
          }
        } catch (error) {
          loopLog = log.update(loopLog, {
            ...loopFailureState('While', index + 1, started, error),
            ...log.stats(loopLog.id),
          });
          throw error;
        }
      } else if (step.type === 'doWhile') {
        const started = Date.now();
        let loopLog = log.add(makeLog(step, 'started', 'info', 'Do while loop running', {
          depth,
          parentId,
          ...conditionLogFields(step),
          completedIterations: 0,
        }));
        const maxIterations = Math.max(1, step.maxIterations || defaultMaxLoopIterations);
        let index = 0;
        let conditionDetail: ConditionEvaluation | undefined;
        let reachedMaxIterations = false;

        try {
          do {
            if (hooks.isStopRequested()) throw new Error('Workflow stopped');
            await waitBetweenIterations(step, index);
            loopIndex = index + 1;
            loopLog = log.update(loopLog, {
              message: `Do while loop running: iteration ${index + 1}`,
              completedIterations: index,
            });
            const result = await runLoopIteration(step, context, currentLastResponse, depth, loopLog, index + 1, 'Do while');
            currentLastResponse = result.response;
            index++;
            loopIndex = index + 1;
            conditionDetail = evaluateConditions(step, currentLastResponse, context);
            const shouldContinue = conditionDetail.passed;
            log.update(result.iterationLog, {
              ...conditionLogFields(step, conditionDetail),
            });
            loopLog = log.update(loopLog, {
              completedIterations: index,
              ...log.stats(loopLog.id),
            });

            if (shouldContinue && index >= maxIterations) {
              reachedMaxIterations = true;
              loopLog = log.update(loopLog, {
                level: 'warn',
                status: 'stopped',
                message: `Do while loop stopped: reached max iterations ${maxIterations}`,
                completedIterations: index,
                durationMs: Date.now() - started,
                ...conditionLogFields(step, conditionDetail),
                ...log.stats(loopLog.id),
              });
              break;
            }

            if (!shouldContinue) break;
          } while (true);

          if (!reachedMaxIterations) {
            loopLog = log.update(loopLog, {
              level: 'success',
              status: 'completed',
              message: `Do while loop completed: ${index} iteration${index === 1 ? '' : 's'}`,
              completedIterations: index,
              durationMs: Date.now() - started,
              ...conditionLogFields(step, conditionDetail),
              ...log.stats(loopLog.id),
            });
          }
        } catch (error) {
          loopLog = log.update(loopLog, {
            ...loopFailureState('Do while', index + 1, started, error),
            ...log.stats(loopLog.id),
          });
          throw error;
        }
      } else if (step.type === 'until') {
        const started = Date.now();
        let loopLog = log.add(makeLog(step, 'started', 'info', 'Until loop running', {
          depth,
          parentId,
          ...conditionLogFields(step),
          completedIterations: 0,
        }));
        const maxIterations = Math.max(1, step.maxIterations || defaultMaxLoopIterations);
        let index = 0;
        let conditionDetail: ConditionEvaluation | undefined;
        const progress: CumulativeProgress = { metAt: [], iteration: 0 };
        let reachedMaxIterations = false;

        try {
          do {
            if (hooks.isStopRequested()) throw new Error('Workflow stopped');
            await waitBetweenIterations(step, index);
            loopIndex = index + 1;
            loopLog = log.update(loopLog, {
              message: `Until loop running: iteration ${index + 1}`,
              completedIterations: index,
            });
            const result = await runLoopIteration(step, context, currentLastResponse, depth, loopLog, index + 1, 'Until');
            currentLastResponse = result.response;
            index++;
            loopIndex = index + 1;
            progress.iteration = index;
            conditionDetail = evaluateConditions(step, currentLastResponse, context, progress);

            const isSatisfied = conditionDetail.passed;
            log.update(result.iterationLog, {
              ...conditionLogFields(step, conditionDetail),
            });
            loopLog = log.update(loopLog, {
              completedIterations: index,
              ...log.stats(loopLog.id),
            });
            if (isSatisfied) break;
            if (index >= maxIterations) {
              reachedMaxIterations = true;
              loopLog = log.update(loopLog, {
                level: 'warn',
                status: 'stopped',
                message: `Until loop stopped: reached max iterations ${maxIterations}`,
                completedIterations: index,
                durationMs: Date.now() - started,
                ...conditionLogFields(step, conditionDetail),
                ...log.stats(loopLog.id),
              });
              break;
            }
          } while (true);

          if (!reachedMaxIterations) {
            loopLog = log.update(loopLog, {
              level: 'success',
              status: 'completed',
              message: `Until loop completed: condition satisfied at iteration ${index}`,
              completedIterations: index,
              durationMs: Date.now() - started,
              ...conditionLogFields(step, conditionDetail),
              ...log.stats(loopLog.id),
            });
          }
        } catch (error) {
          loopLog = log.update(loopLog, {
            ...loopFailureState('Until', index + 1, started, error),
            ...log.stats(loopLog.id),
          });
          throw error;
        }
      }
    }

    return currentLastResponse;
  }

  /** 运行整个 Workflow：写入顶层日志，结束时汇总状态和请求数；失败或停止不会抛出 */
  async function run(workflow: WorkflowDefinition): Promise<WorkflowRunLog> {
    const started = Date.now();
    let workflowLog = log.add({
      id: generateId(),
      stepId: workflow.id,
      stepName: workflow.name,
      stepType: 'workflow',
      level: 'info',
      status: 'started',
      message: 'Workflow started',
      timestamp: new Date().toISOString(),
    });

    try {
      await runSteps(workflow.steps, context, null, 1, workflowLog.id);
      workflowLog = log.update(workflowLog, {
        level: 'success',
        status: 'completed',
        message: 'Workflow completed',
        durationMs: Date.now() - started,
        ...log.stats(workflowLog.id),
      });
    } catch (error) {
      workflowLog = log.update(workflowLog, {
        level: hooks.isStopRequested() ? 'warn' : 'error',
        status: hooks.isStopRequested() ? 'stopped' : 'failed',
        message: errorText(error),
        durationMs: Date.now() - started,
        ...log.stats(workflowLog.id),
      });
    }
    return workflowLog;
  }

  return { run };
};
