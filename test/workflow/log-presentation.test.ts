import { describe, expect, it } from 'vitest';
import type { WorkflowRunLog } from '@/types/models';
import {
  canInspectWorkflowLog,
  formatWorkflowConditionTarget,
  getWorkflowLogDiagnosticSummaries,
} from '@/utils/workflowLogPresentation';

const log = (overrides: Partial<WorkflowRunLog> = {}): WorkflowRunLog => ({
  id: 'log',
  stepId: 'step',
  stepName: 'Step',
  stepType: 'request',
  level: 'success',
  status: 'passed',
  message: 'done',
  timestamp: '2026-09-01T00:00:00.000Z',
  ...overrides,
});

const condition = {
  source: 'lastResponse' as const,
  field: 'jsonPath' as const,
  path: '$.items.length',
  operator: 'greaterThan',
  expectedValue: '0',
};

describe('workflow log presentation', () => {
  it('summarizes branch conditions without treating the else path as a failure', () => {
    expect(getWorkflowLogDiagnosticSummaries(log({ stepType: 'if', status: 'then', condition, actualValue: 5, conditionResult: true }))[0]).toMatchObject({
      label: 'Condition matched · actual: 5',
      severity: 'success',
    });
    expect(getWorkflowLogDiagnosticSummaries(log({ stepType: 'if', status: 'else', condition, actualValue: 0, conditionResult: false }))[0]).toMatchObject({
      label: 'Condition not matched · actual: 0',
      severity: 'secondary',
    });
    expect(getWorkflowLogDiagnosticSummaries(log({ stepType: 'if', level: 'error', status: 'failed', condition, actualValue: 0, conditionResult: false }))[0]).toMatchObject({
      label: 'Condition not matched · no else branch',
      severity: 'danger',
    });
    expect(getWorkflowLogDiagnosticSummaries(log({ condition }))[0]).toMatchObject({
      label: 'Condition not evaluated',
      severity: 'secondary',
    });
    expect(formatWorkflowConditionTarget(log({ condition }))).toBe('lastResponse.jsonPath.$.items.length');
  });

  it('reports until iterations as pending rather than failed', () => {
    expect(getWorkflowLogDiagnosticSummaries(log({ stepType: 'until', iteration: 2, condition, actualValue: 0, conditionResult: false }))[0]).toMatchObject({
      label: 'Condition not met · actual: 0',
      severity: 'secondary',
    });
    expect(getWorkflowLogDiagnosticSummaries(log({ stepType: 'until', status: 'completed', completedIterations: 3, condition, actualValue: 3, conditionResult: true }))[0]).toMatchObject({
      label: 'Condition met · actual: 3',
      severity: 'success',
    });
    expect(getWorkflowLogDiagnosticSummaries(log({ stepType: 'until', level: 'warn', status: 'stopped', completedIterations: 10, condition, actualValue: 0, conditionResult: false }))[0]).toMatchObject({
      label: 'Condition not met · max iterations',
      severity: 'warn',
    });
  });

  it('reports while and do-while loop exits as normal termination', () => {
    expect(getWorkflowLogDiagnosticSummaries(log({ stepType: 'while', iteration: 2, condition, actualValue: 5, conditionResult: true }))[0]).toMatchObject({
      label: 'Condition holds · actual: 5',
      severity: 'secondary',
    });
    expect(getWorkflowLogDiagnosticSummaries(log({ stepType: 'while', status: 'completed', completedIterations: 3, condition, actualValue: 0, conditionResult: false }))[0]).toMatchObject({
      label: 'Condition ended · actual: 0',
      severity: 'success',
    });
    expect(getWorkflowLogDiagnosticSummaries(log({ stepType: 'doWhile', status: 'completed', completedIterations: 3, condition, actualValue: 0, conditionResult: false }))[0]).toMatchObject({
      label: 'Condition ended · actual: 0',
      severity: 'success',
    });
    expect(getWorkflowLogDiagnosticSummaries(log({ stepType: 'doWhile', level: 'warn', status: 'stopped', completedIterations: 10, condition, actualValue: 5, conditionResult: true }))[0]).toMatchObject({
      label: 'Condition still holds · max iterations',
      severity: 'warn',
    });
  });

  it('summarizes request assertions without including variable extraction results', () => {
    const summaries = getWorkflowLogDiagnosticSummaries(log({
      testResults: {
        statusCode: [{ index: 0, passed: true, message: 'ok', description: '', actualValue: 200, operator: 'equals', expectedValue: '200' }],
        jsonFields: [{ index: 0, passed: false, message: 'wrong value', description: '', actualValue: 'draft', operator: 'equals', expectedValue: 'ready', jsonPath: '$.status' }],
        globalVars: [{ index: 0, success: true, message: 'saved', description: '' }],
      },
    }));
    expect(summaries).toEqual([expect.objectContaining({
      label: 'Tests 1/2 failed',
      severity: 'danger',
    })]);
  });

  it('only exposes details for logs with diagnostic data', () => {
    expect(canInspectWorkflowLog(log({ stepType: 'for' }))).toBe(false);
    expect(canInspectWorkflowLog(log({ stepType: 'while', condition }))).toBe(true);
    expect(canInspectWorkflowLog(log({ testResults: { statusCode: [], jsonFields: [], globalVars: [] } }))).toBe(true);
  });

  it('summarizes several conditions by how many are true or met', () => {
    const condition = { source: 'loopIndex', field: 'value', operator: 'equals', expectedValue: '3' } as const;
    const cumulative = log({
      stepType: 'until',
      status: 'completed',
      condition,
      conditionResult: true,
      conditionMatch: 'cumulative',
      conditionChecks: [
        { condition, actualValue: 5, passed: true, metAtIteration: 2 },
        { condition, actualValue: 5, passed: true, metAtIteration: 4 },
      ],
    });
    expect(getWorkflowLogDiagnosticSummaries(cumulative)[0].label).toBe('Condition met · 2/2 conditions met');

    const any = log({
      stepType: 'if',
      status: 'then',
      condition,
      conditionResult: true,
      conditionMatch: 'any',
      conditionChecks: [{ condition, actualValue: 1, passed: false }, { condition, actualValue: 3, passed: true }],
    });
    expect(getWorkflowLogDiagnosticSummaries(any)[0].label).toBe('Condition matched · 1/2 conditions true');
  });
});
