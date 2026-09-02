import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowsStore } from '@/stores/workflows';
import { httpbinUrl } from '../helpers/httpbin';
import { condition, controlStep, emptyTests, makeRequest, requestStep, workflow } from '../helpers/workflowFactory';

describe('workflow conditions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('WF-COND-001 evaluates lastResponse status, body, header, and jsonPath fields', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      requestStep({
        id: 'json-step',
        inlineRequest: makeRequest({
          url: httpbinUrl('/response-headers?x-apikit=yes&Content-Type=application/json'),
          tests: emptyTests(),
        }),
      }),
      controlStep('if', {
        name: 'status then',
        condition: condition({ field: 'status', operator: 'equals', expectedValue: '200' }),
        thenSteps: [requestStep({ name: 'status branch' })],
        elseSteps: [],
      }),
      requestStep({
        id: 'header-step',
        inlineRequest: makeRequest({
          url: httpbinUrl('/response-headers?x-apikit=yes&Content-Type=application/json'),
          tests: emptyTests(),
        }),
      }),
      controlStep('if', {
        name: 'header then',
        condition: condition({ field: 'header', path: 'content-type', operator: 'contains', expectedValue: 'application/json' }),
        thenSteps: [requestStep({ name: 'header branch' })],
        elseSteps: [],
      }),
      requestStep({
        id: 'body-step',
        inlineRequest: makeRequest({
          url: httpbinUrl('/html'),
          tests: emptyTests(),
        }),
      }),
      controlStep('if', {
        name: 'body then',
        condition: condition({ field: 'body', operator: 'contains', expectedValue: 'Herman' }),
        thenSteps: [requestStep({ name: 'body branch' })],
        elseSteps: [],
      }),
      requestStep({
        id: 'slideshow-step',
        inlineRequest: makeRequest({ url: httpbinUrl('/json'), tests: emptyTests() }),
      }),
      controlStep('if', {
        name: 'jsonPath then',
        condition: condition({ field: 'jsonPath', path: '$.slideshow.title', operator: 'contains', expectedValue: 'Sample' }),
        thenSteps: [requestStep({ name: 'jsonPath branch' })],
        elseSteps: [],
      }),
    ]);

    await store.runWorkflow(definition);

    const names = store.getWorkflowLogs(definition.id).map(log => log.stepName);
    expect(names).toContain('status branch');
    expect(names).toContain('header branch');
    expect(names).toContain('body branch');
    expect(names).toContain('jsonPath branch');
  });

  it('WF-COND-002 evaluates stepResponse, globalVariable, and loopIndex condition sources', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      requestStep({
        id: 'created-step',
        inlineRequest: makeRequest({ url: httpbinUrl('/status/201'), tests: emptyTests() }),
      }),
      controlStep('if', {
        name: 'step response branch selector',
        condition: condition({ source: 'stepResponse', stepId: 'created-step', field: 'status', operator: 'equals', expectedValue: '201' }),
        thenSteps: [requestStep({ name: 'step response branch' })],
        elseSteps: [],
      }),
      controlStep('if', {
        name: 'global variable branch selector',
        condition: condition({ source: 'globalVariable', field: 'value', path: 'ENV_STATUS', operator: 'equals', expectedValue: 'ready' }),
        thenSteps: [requestStep({ name: 'global variable branch' })],
        elseSteps: [],
      }),
      controlStep('for', {
        name: 'loop source',
        iterations: 2,
        maxIterations: 2,
        childSteps: [
          controlStep('if', {
            name: 'loop index branch selector',
            condition: condition({ source: 'loopIndex', field: 'value', operator: 'equals', expectedValue: '2' }),
            thenSteps: [requestStep({ name: 'loop index branch' })],
            elseSteps: [requestStep({ name: 'loop index else' })],
          }),
        ],
      }),
    ]);

    await store.runWorkflow(definition, {
      replaceVariables: value => value === '{{ENV_STATUS}}' ? 'ready' : value,
    });

    const names = store.getWorkflowLogs(definition.id).map(log => log.stepName);
    expect(names).toContain('step response branch');
    expect(names).toContain('global variable branch');
    expect(names).toContain('loop index branch');
    expect(names).toContain('loop index else');
  });

  it.each([
    ['equals', '200', true],
    ['notEquals', '201', true],
    ['contains', '20', true],
    ['notContains', 'xyz', true],
    ['exists', '', true],
    ['notExists', '', false],
    ['greaterThan', '199', true],
    ['lessThan', '201', true],
    ['greaterThanOrEquals', '200', true],
    ['lessThanOrEquals', '200', true],
  ])('WF-COND-003 evaluates operator %s', async (operator, expectedValue, shouldUseThen) => {
    const store = useWorkflowsStore();
    const field = 'status';
    const url = httpbinUrl('/status/200');
    const definition = workflow([
      requestStep({
        inlineRequest: makeRequest({ url, tests: emptyTests() }),
      }),
      controlStep('if', {
        name: `${operator} selector`,
        condition: condition({ field: field as any, operator, expectedValue }),
        thenSteps: [requestStep({ name: `${operator} then` })],
        elseSteps: [requestStep({ name: `${operator} else` })],
      }),
    ]);

    await store.runWorkflow(definition);

    const names = store.getWorkflowLogs(definition.id).map(log => log.stepName);
    expect(names).toContain(shouldUseThen ? `${operator} then` : `${operator} else`);
  });
});
