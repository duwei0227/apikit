import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowsStore } from '@/stores/workflows';
import { httpbinUrl } from '../helpers/httpbin';
import { condition, controlStep, emptyTests, makeRequest, requestStep, workflow } from '../helpers/workflowFactory';

describe('workflow control steps', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('WF-CTRL-001 runs if then and else branches', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      requestStep({ inlineRequest: makeRequest({ url: httpbinUrl('/status/200'), tests: emptyTests() }) }),
      controlStep('if', {
        condition: condition({ expectedValue: '200' }),
        thenSteps: [requestStep({ name: 'then branch' })],
        elseSteps: [requestStep({ name: 'else branch skipped' })],
      }),
      controlStep('if', {
        condition: condition({ expectedValue: '201' }),
        thenSteps: [requestStep({ name: 'then branch skipped' })],
        elseSteps: [requestStep({ name: 'else branch' })],
      }),
    ]);

    await store.runWorkflow(definition);

    const names = store.getWorkflowLogs(definition.id).map(log => log.stepName);
    expect(names).toContain('then branch');
    expect(names).toContain('else branch');
    expect(names).not.toContain('then branch skipped');
    expect(names).not.toContain('else branch skipped');
  });

  it('WF-CTRL-002 fails if when no else branch exists and condition is false', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      requestStep({ inlineRequest: makeRequest({ url: httpbinUrl('/status/200'), tests: emptyTests() }) }),
      controlStep('if', {
        name: 'strict if',
        condition: condition({ expectedValue: '201' }),
        thenSteps: [requestStep({ name: 'unreachable' })],
        elseSteps: [],
      }),
    ]);

    await store.runWorkflow(definition);

    const logs = store.getWorkflowLogs(definition.id);
    expect(logs.some(log => log.message.includes('no else branch'))).toBe(true);
    expect(logs.at(-1)?.status).toBe('failed');
  });

  it('WF-CTRL-003 runs for loops with iterations, max cap, and loopIndex', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      controlStep('for', {
        name: 'for max cap',
        iterations: 5,
        maxIterations: 2,
        childSteps: [
          controlStep('if', {
            name: 'for index selector',
            condition: condition({ source: 'loopIndex', field: 'value', operator: 'lessThanOrEquals', expectedValue: '2' }),
            thenSteps: [requestStep({ name: 'for body' })],
            elseSteps: [],
          }),
        ],
      }),
    ]);

    await store.runWorkflow(definition);

    const logs = store.getWorkflowLogs(definition.id);
    expect(logs.filter(log => log.message.startsWith('For iteration'))).toHaveLength(2);
    expect(logs.filter(log => log.stepName === 'for body')).toHaveLength(2);
  });

  it('WF-CTRL-004 skips while body when precondition is false', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      requestStep({ inlineRequest: makeRequest({ url: httpbinUrl('/status/200'), tests: emptyTests() }) }),
      controlStep('while', {
        name: 'false while',
        condition: condition({ expectedValue: '201' }),
        maxIterations: 3,
        childSteps: [requestStep({ name: 'while body skipped' })],
      }),
    ]);

    await store.runWorkflow(definition);

    const logs = store.getWorkflowLogs(definition.id);
    expect(logs.some(log => log.stepName === 'while body skipped')).toBe(false);
    expect(logs.some(log => log.message.startsWith('While loop completed: 0 iterations'))).toBe(true);
  });

  it('WF-CTRL-005 stops while at maxIterations without failing', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      requestStep({ inlineRequest: makeRequest({ url: httpbinUrl('/status/200'), tests: emptyTests() }) }),
      controlStep('while', {
        name: 'bounded while',
        condition: condition({ source: 'loopIndex', field: 'value', operator: 'greaterThan', expectedValue: '0' }),
        maxIterations: 2,
        childSteps: [requestStep({ name: 'while body' })],
      }),
    ]);

    await store.runWorkflow(definition);

    const logs = store.getWorkflowLogs(definition.id);
    expect(logs.filter(log => log.stepName === 'while body')).toHaveLength(2);
    expect(logs.some(log => log.status === 'stopped' && log.message.includes('reached max iterations'))).toBe(true);
    expect(logs.find(log => log.stepType === 'workflow')?.status).toBe('completed');
  });

  it('WF-CTRL-006 runs do while at least once and stops when condition becomes false', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      requestStep({ inlineRequest: makeRequest({ url: httpbinUrl('/status/200'), tests: emptyTests() }) }),
      controlStep('doWhile', {
        name: 'single do while',
        condition: condition({ expectedValue: '201' }),
        maxIterations: 3,
        childSteps: [requestStep({ name: 'do while body' })],
      }),
    ]);

    await store.runWorkflow(definition);

    const logs = store.getWorkflowLogs(definition.id);
    expect(logs.filter(log => log.stepName === 'do while body')).toHaveLength(1);
    expect(logs.some(log => log.message.startsWith('Do while loop completed: 1 iteration'))).toBe(true);
  });

  it('WF-CTRL-007 runs until at least once and completes when condition is satisfied', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      controlStep('until', {
        name: 'until loop',
        condition: condition({ expectedValue: '200' }),
        maxIterations: 3,
        childSteps: [requestStep({ name: 'until body' })],
      }),
    ]);

    await store.runWorkflow(definition);

    const logs = store.getWorkflowLogs(definition.id);
    expect(logs.filter(log => log.stepName === 'until body').length).toBeGreaterThanOrEqual(1);
    expect(logs.some(log => log.message.startsWith('Until loop completed: condition satisfied'))).toBe(true);
  });
});
