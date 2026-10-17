import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRunLog } from '@/types/models';
import { createWorkflowEngine } from '@/services/workflow/engine';
import { RunLogRecorder } from '@/services/workflow/runLog';
import { normalizeWorkflowDefinition } from '@/services/workflow/definition';
import { httpbinUrl } from '../helpers/httpbin';
import { condition, controlStep, makeRequest, passingStatusTest, requestStep, workflow } from '../helpers/workflowFactory';

// 不创建 Pinia：引擎只依赖注入的日志记录器和回调
const setup = (overrides: Partial<Parameters<typeof createWorkflowEngine>[1]> = {}) => {
  const logs: WorkflowRunLog[] = [];
  const log = new RunLogRecorder({ runId: 'run-1', workflowId: 'wf', workflowName: 'WF', lists: () => [logs] });
  const hooks = {
    log,
    isStopRequested: () => false,
    loadRequest: vi.fn(async () => null),
    onRequestStart: vi.fn(),
    onRequestEnd: vi.fn(),
    ...overrides,
  };
  return { logs, hooks, engine: createWorkflowEngine({}, hooks) };
};

describe('workflow engine', () => {
  it('ENGINE-001 runs saved requests with overrides and reports request lifecycle', async () => {
    const saved = makeRequest({ id: 'saved', url: httpbinUrl('/status/500'), tests: passingStatusTest('200') });
    const { logs, hooks, engine } = setup({ loadRequest: vi.fn(async () => saved) });
    const definition = normalizeWorkflowDefinition(workflow([
      requestStep({ id: 'login', requestSource: 'reference', requestId: 'saved', requestOverrides: { url: httpbinUrl('/get') } }),
      controlStep('if', {
        condition: condition({ source: 'stepResponse', stepId: 'login', expectedValue: '200' }),
        thenSteps: [requestStep({ inlineRequest: makeRequest({ url: httpbinUrl('/get'), tests: passingStatusTest('200') }) })],
        elseSteps: [],
      }),
    ]));

    const summary = await engine.run(definition);
    expect(hooks.loadRequest).toHaveBeenCalledWith('saved');
    expect(summary).toMatchObject({ status: 'completed', requestCount: 2, passedRequestCount: 2, workflowId: 'wf', runId: 'run-1' });
    expect(hooks.onRequestStart).toHaveBeenCalledTimes(2);
    expect(hooks.onRequestEnd).toHaveBeenCalledTimes(2);
    expect(logs.map(log => log.sequence)).toEqual(logs.map((_, index) => index + 1));
    expect(logs.find(log => log.status === 'then')).toBeTruthy();
  });

  it('ENGINE-002 stops between iterations when a stop is requested', async () => {
    let stop = false;
    const { engine } = setup({
      isStopRequested: () => stop,
      onRequestEnd: () => { stop = true; },
    });
    const definition = normalizeWorkflowDefinition(workflow([
      controlStep('for', { iterations: 5, childSteps: [requestStep({ inlineRequest: makeRequest({ url: httpbinUrl('/get') }) })] }),
    ]));

    const summary = await engine.run(definition);
    expect(summary).toMatchObject({ status: 'stopped', level: 'warn', requestCount: 1 });
  });

  it('ENGINE-003 keeps loop index and step responses per run', async () => {
    const run = async () => {
      const { logs, engine } = setup();
      await engine.run(normalizeWorkflowDefinition(workflow([
        controlStep('while', {
          condition: condition({ source: 'loopIndex', field: 'value', operator: 'lessThanOrEquals', expectedValue: '2' }),
          childSteps: [requestStep({ inlineRequest: makeRequest({ url: httpbinUrl('/get') }) })],
        }),
      ])));
      return logs.find(log => log.stepType === 'while');
    };
    // 两次独立运行互不影响
    expect((await run())?.completedIterations).toBe(2);
    expect((await run())?.completedIterations).toBe(2);
  });
});
