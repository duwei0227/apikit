import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowRunLog } from '@/types/models';
import { useWorkflowsStore } from '@/stores/workflows';
import { httpbinUrl } from '../helpers/httpbin';
import { condition, controlStep, makeRequest, passingStatusTest, requestStep, workflow } from '../helpers/workflowFactory';

// 按改造前的算法从最终日志重新统计某条日志下的请求数，用来核对增量统计
const recount = (logs: WorkflowRunLog[], parentId: string) => {
  const children = new Map<string, WorkflowRunLog[]>();
  logs.forEach(log => {
    if (!log.parentId) return;
    children.set(log.parentId, [...(children.get(log.parentId) || []), log]);
  });
  const stats = { requestCount: 0, passedRequestCount: 0, failedRequestCount: 0 };
  const visit = (id: string) => (children.get(id) || []).forEach(log => {
    if (log.stepType === 'request' && log.status !== 'skipped') {
      stats.requestCount++;
      if (log.status === 'passed') stats.passedRequestCount++;
      if (log.status === 'failed') stats.failedRequestCount++;
    }
    visit(log.id);
  });
  visit(parentId);
  return stats;
};

const ok = () => requestStep({ inlineRequest: makeRequest({ url: httpbinUrl('/get'), tests: passingStatusTest('200') }) });

describe('workflow log statistics', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('WF-STATS-001 keeps request counts in sync across nested loops, branches, skipped and failed steps', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      ok(),
      requestStep({ enabled: false }),
      controlStep('for', {
        iterations: 3,
        childSteps: [
          ok(),
          controlStep('if', { condition: condition({ expectedValue: '200' }), thenSteps: [ok()], elseSteps: [] }),
        ],
      }),
      controlStep('while', {
        condition: condition({ source: 'loopIndex', field: 'value', operator: 'lessThan', expectedValue: '3' }),
        maxIterations: 5,
        childSteps: [ok()],
      }),
      requestStep({ inlineRequest: makeRequest({ url: httpbinUrl('/status/500'), tests: passingStatusTest('200') }) }),
    ]);

    await store.runWorkflow(definition);
    const logs = store.getWorkflowLogs(definition.id);
    const summary = logs.find(log => log.stepType === 'workflow')!;

    expect(summary.status).toBe('failed');
    expect(summary).toMatchObject({ requestCount: 10, passedRequestCount: 9, failedRequestCount: 1 });

    const withStats = logs.filter(log => log.requestCount !== undefined);
    expect(withStats.length).toBeGreaterThan(5);
    for (const log of withStats) {
      expect({
        requestCount: log.requestCount,
        passedRequestCount: log.passedRequestCount,
        failedRequestCount: log.failedRequestCount,
      }).toEqual(recount(logs, log.id));
    }

    // 两份日志列表是同一组对象，顺序一致
    expect(store.runLogs.map(log => log.id)).toEqual(logs.map(log => log.id));
  });

  it('WF-STATS-002 starts each run with fresh statistics', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([controlStep('for', { iterations: 2, childSteps: [ok()] })]);
    await store.runWorkflow(definition);
    await store.runWorkflow(definition);
    const summary = store.getWorkflowLogs(definition.id).find(log => log.stepType === 'workflow')!;
    expect(summary).toMatchObject({ status: 'completed', requestCount: 2, passedRequestCount: 2 });
  });
});
