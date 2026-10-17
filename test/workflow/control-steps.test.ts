import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('WF-CTRL-003 runs for loops for the configured iterations, ignoring any legacy max cap', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      controlStep('for', {
        name: 'for iterations',
        iterations: 3,
        maxIterations: 1,
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
    expect(logs.filter(log => log.message.startsWith('For iteration'))).toHaveLength(3);
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

  // loopIndex 在 until 每次循环后检查，第 n 次循环后为 n + 1
  const loopIndexAtLeast = (value: number) => condition({ source: 'loopIndex', field: 'value', operator: 'greaterThanOrEquals', expectedValue: String(value) });
  const loopIndexIs = (value: number) => condition({ source: 'loopIndex', field: 'value', operator: 'equals', expectedValue: String(value) });

  const runUntil = async (overrides: Parameters<typeof controlStep>[1]) => {
    const store = useWorkflowsStore();
    const definition = workflow([controlStep('until', { name: 'until loop', maxIterations: 10, childSteps: [], ...overrides })]);
    await store.runWorkflow(definition);
    return store.getWorkflowLogs(definition.id).find(log => log.stepName === 'until loop' && log.iteration === undefined)!;
  };

  it('WF-CTRL-008 until with all conditions stops only when they are true at the same check', async () => {
    const loop = await runUntil({ conditions: [loopIndexIs(3), loopIndexIs(5)], conditionMatch: 'all', maxIterations: 6 });
    expect(loop.status).toBe('stopped');
    expect(loop.completedIterations).toBe(6);

    const both = await runUntil({ conditions: [loopIndexAtLeast(3), loopIndexAtLeast(5)], conditionMatch: 'all' });
    expect(both.status).toBe('completed');
    expect(both.completedIterations).toBe(4);
    expect(both.conditionMatch).toBe('all');
    expect(both.conditionChecks?.map(check => check.passed)).toEqual([true, true]);
  });

  it('WF-CTRL-009 until with any condition stops at the first one that is true', async () => {
    const loop = await runUntil({ conditions: [loopIndexIs(5), loopIndexIs(3)], conditionMatch: 'any' });
    expect(loop.status).toBe('completed');
    expect(loop.completedIterations).toBe(2);
    expect(loop.conditionChecks?.map(check => check.passed)).toEqual([false, true]);
  });

  it('WF-CTRL-010 until with cumulative conditions keeps met conditions and stops when all were met', async () => {
    const loop = await runUntil({ conditions: [loopIndexIs(5), loopIndexIs(3)], conditionMatch: 'cumulative' });
    expect(loop.status).toBe('completed');
    expect(loop.completedIterations).toBe(4);
    expect(loop.conditionChecks).toMatchObject([
      { passed: true, metAtIteration: 4, actualValue: 5 },
      { passed: true, metAtIteration: 2, actualValue: 5 },
    ]);

    // 同一次检查都满足时立即停止
    const together = await runUntil({ conditions: [loopIndexIs(3), loopIndexAtLeast(2)], conditionMatch: 'cumulative' });
    expect(together.completedIterations).toBe(2);

    const never = await runUntil({ conditions: [loopIndexIs(3), loopIndexIs(99)], conditionMatch: 'cumulative', maxIterations: 4 });
    expect(never.status).toBe('stopped');
    expect(never.conditionChecks).toMatchObject([{ passed: true, metAtIteration: 2 }, { passed: false }]);
  });

  it('WF-CTRL-011 combines if and while conditions with all and any', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      controlStep('if', {
        name: 'if any',
        conditions: [loopIndexIs(9), loopIndexIs(1)],
        conditionMatch: 'any',
        thenSteps: [],
        elseSteps: [],
      }),
      controlStep('while', {
        name: 'while all',
        conditions: [loopIndexAtLeast(1), condition({ source: 'loopIndex', field: 'value', operator: 'lessThan', expectedValue: '3' })],
        conditionMatch: 'all',
        maxIterations: 10,
        childSteps: [],
      }),
    ]);
    await store.runWorkflow(definition);
    const logs = store.getWorkflowLogs(definition.id);
    expect(logs.find(log => log.stepName === 'if any')?.status).toBe('then');
    const loop = logs.find(log => log.stepName === 'while all' && log.iteration === undefined)!;
    expect(loop.status).toBe('completed');
    expect(loop.completedIterations).toBe(2);
  });

  it('WF-CTRL-012 waits delayMs between loop iterations but not before the first', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      controlStep('for', { name: 'paced for', iterations: 3, delayMs: 120, childSteps: [requestStep({ name: 'for body' })] }),
      controlStep('until', { name: 'paced until', maxIterations: 2, delayMs: 120, childSteps: [], conditions: [loopIndexIs(99)] }),
    ]);
    const started = Date.now();
    await store.runWorkflow(definition);
    const elapsed = Date.now() - started;
    // for：3 次循环等 2 次；until：2 次循环等 1 次
    expect(elapsed).toBeGreaterThanOrEqual(3 * 120 - 20);
    expect(elapsed).toBeLessThan(4 * 120 + 400);
    const logs = store.getWorkflowLogs(definition.id);
    expect(logs.filter(log => log.stepName === 'for body')).toHaveLength(3);
  });

  it('WF-CTRL-013 stops during the wait between iterations', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      controlStep('while', { name: 'slow while', maxIterations: 5, delayMs: 60_000, childSteps: [], conditions: [loopIndexAtLeast(1)] }),
    ]);
    const started = Date.now();
    const run = store.runWorkflow(definition);
    await new Promise(resolve => setTimeout(resolve, 150));
    await store.stopWorkflow();
    await run;
    expect(Date.now() - started).toBeLessThan(2000);
    const loop = store.getWorkflowLogs(definition.id).find(log => log.stepName === 'slow while' && log.iteration === undefined)!;
    expect(loop.status).toBe('stopped');
    expect(loop.completedIterations).toBe(1);
  });

  it('WF-CTRL-014 replaces variables in condition expected values and logs the replaced value', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      controlStep('until', {
        name: 'until target',
        maxIterations: 10,
        childSteps: [],
        conditions: [condition({ source: 'loopIndex', field: 'value', operator: 'equals', expectedValue: '{{target}}' })],
      }),
    ]);
    const variables: Record<string, string> = { target: '4' };
    await store.runWorkflow(definition, {
      replaceVariables: text => text.replace(/\{\{([^}]+)\}\}/g, (match, name) => variables[name.trim()] ?? match),
    });
    const loop = store.getWorkflowLogs(definition.id).find(log => log.stepName === 'until target' && log.iteration === undefined)!;
    expect(loop.status).toBe('completed');
    expect(loop.completedIterations).toBe(3);
    expect(loop.condition?.expectedValue).toBe('4');
  });

  it('WF-CTRL-015 sets global variables with replaced values, including the loop index', async () => {
    const store = useWorkflowsStore();
    const variables: Record<string, string> = { base: '10' };
    const set = vi.fn((key: string, value: string) => { variables[key] = value; });
    const definition = workflow([
      controlStep('setVariables', { name: 'reset', variables: [
        { key: 'page', value: '1', enabled: true },
        { key: 'label', value: 'start-{{base}}', enabled: true },
        { key: 'skipped', value: 'x', enabled: false },
        { key: '  ', value: 'no name', enabled: true },
      ] }),
      controlStep('for', { iterations: 2, childSteps: [
        controlStep('setVariables', { name: 'in loop', variables: [{ key: 'page', value: 'p{{$loopIndex}}', enabled: true }] }),
      ] }),
    ]);
    await store.runWorkflow(definition, {
      replaceVariables: text => text.replace(/\{\{([^}]+)\}\}/g, (match, name) => variables[name.trim()] ?? match),
      setGlobalVariable: set,
    });

    expect(set.mock.calls.map(([key, value]) => `${key}=${value}`)).toEqual(['page=1', 'label=start-10', 'page=p1', 'page=p2']);
    const reset = store.getWorkflowLogs(definition.id).find(log => log.stepName === 'reset')!;
    expect(reset).toMatchObject({ status: 'passed', message: 'Set 2 variables', setVariables: [{ key: 'page', value: '1' }, { key: 'label', value: 'start-10' }] });
  });
});
