import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowsStore } from '@/stores/workflows';
import { condition, controlStep, makeRequest, passingStatusTest, requestStep, workflow } from '../helpers/workflowFactory';

describe('workflow logs', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('WF-LOG-001 records workflow to loop to iteration to request parent hierarchy', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      controlStep('for', {
        name: 'parent loop',
        iterations: 1,
        maxIterations: 1,
        childSteps: [requestStep({ name: 'child request' })],
      }),
    ]);

    await store.runWorkflow(definition);

    const logs = store.getWorkflowLogs(definition.id);
    const workflowStart = logs.find(log => log.stepType === 'workflow');
    const loopStart = logs.find(log => log.stepName === 'parent loop' && log.stepType === 'for' && log.iteration === undefined);
    const iteration = logs.find(log => log.stepName === 'parent loop' && log.iteration === 1);
    const request = logs.find(log => log.stepName === 'child request');

    expect(loopStart?.parentId).toBe(workflowStart?.id);
    expect(iteration?.parentId).toBe(loopStart?.id);
    expect(request?.parentId).toBe(iteration?.id);
  });

  it('WF-LOG-002 keeps one terminal lifecycle row per workflow and loop', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      controlStep('while', {
        name: 'bounded while',
        condition: condition({ source: 'loopIndex', field: 'value', operator: 'lessThan', expectedValue: '1' }),
        maxIterations: 1,
        childSteps: [requestStep({ name: 'not reached' })],
      }),
    ]);

    await store.runWorkflow(definition);

    const logs = store.getWorkflowLogs(definition.id);
    expect(logs.filter(log => log.stepType === 'workflow')).toHaveLength(1);
    expect(logs.filter(log => log.stepType === 'while' && log.iteration === undefined)).toHaveLength(1);
    expect(logs.filter(log => log.stepType === 'workflow')[0].status).toBe('completed');
    expect(logs.filter(log => log.stepType === 'while')[0]).toMatchObject({
      status: 'completed',
      completedIterations: 0,
    });
  });

  it('WF-LOG-003 treats max iteration guard as stopped warning, not failed', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      requestStep(),
      controlStep('while', {
        name: 'guarded while',
        condition: condition({ expectedValue: '200' }),
        maxIterations: 1,
        childSteps: [requestStep({ name: 'guarded body' })],
      }),
    ]);

    await store.runWorkflow(definition);

    const guardLog = store.getWorkflowLogs(definition.id).find(log => log.message.includes('reached max iterations'));
    expect(guardLog).toMatchObject({ status: 'stopped', level: 'warn' });
    expect(store.getWorkflowLogs(definition.id).find(log => log.stepType === 'workflow')?.status).toBe('completed');
  });

  it('WF-LOG-004 records one loop row and one row per iteration', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      controlStep('for', {
        name: 'five iterations',
        iterations: 5,
        maxIterations: 5,
        childSteps: [requestStep({ name: 'loop request' })],
      }),
    ]);

    await store.runWorkflow(definition);

    const logs = store.getWorkflowLogs(definition.id);
    const loopLogs = logs.filter(log => log.stepName === 'five iterations');
    const summary = loopLogs.find(log => log.iteration === undefined);
    expect(loopLogs.filter(log => log.iteration !== undefined)).toHaveLength(5);
    expect(summary).toMatchObject({
      status: 'completed',
      iterationTotal: 5,
      completedIterations: 5,
      requestCount: 5,
      passedRequestCount: 5,
    });
    expect(loopLogs.every(log => log.durationMs !== undefined)).toBe(true);
  });

  it('WF-LOG-005 marks the active iteration and loop failed when a child fails', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      controlStep('for', {
        name: 'failing loop',
        iterations: 3,
        maxIterations: 3,
        childSteps: [requestStep({ inlineRequest: undefined, requestSource: 'reference', requestId: 'missing' })],
      }),
    ]);

    await store.runWorkflow(definition);

    const logs = store.getWorkflowLogs(definition.id);
    expect(logs.find(log => log.stepName === 'failing loop' && log.iteration === undefined)?.status).toBe('failed');
    expect(logs.find(log => log.stepName === 'failing loop' && log.iteration === 1)?.status).toBe('failed');
    expect(logs.filter(log => log.stepName === 'failing loop' && log.iteration !== undefined)).toHaveLength(1);
    expect(logs.find(log => log.stepType === 'workflow')?.status).toBe('failed');
  });

  it('WF-LOG-006 marks the workflow and loop stopped when the user stops between iterations', async () => {
    const store = useWorkflowsStore();
    const request = makeRequest({
      tests: {
        ...passingStatusTest('200'),
        globalVariables: [{
          enabled: true,
          variableName: 'stopAfterFirst',
          valueType: 'customValue',
          jsonPath: '',
          customValue: 'yes',
          description: '',
        }],
      },
    });
    const definition = workflow([
      controlStep('for', {
        name: 'stoppable loop',
        iterations: 3,
        maxIterations: 3,
        childSteps: [requestStep({ inlineRequest: request })],
      }),
    ]);

    await store.runWorkflow(definition, {
      setGlobalVariable: () => { void store.stopWorkflow(); },
    });

    const logs = store.getWorkflowLogs(definition.id);
    expect(logs.find(log => log.stepType === 'workflow')?.status).toBe('stopped');
    expect(logs.find(log => log.stepName === 'stoppable loop' && log.iteration === undefined)).toMatchObject({
      status: 'stopped',
      completedIterations: 1,
    });
    expect(logs.filter(log => log.stepName === 'stoppable loop' && log.iteration !== undefined)).toHaveLength(1);
  });
});
