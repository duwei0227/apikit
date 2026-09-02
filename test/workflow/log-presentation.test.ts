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
  it('summarizes passed, failed, and unevaluated conditions', () => {
    expect(getWorkflowLogDiagnosticSummaries(log({ condition, actualValue: 5, conditionResult: true }))[0]).toMatchObject({
      label: 'Condition passed · actual: 5',
      severity: 'success',
    });
    expect(getWorkflowLogDiagnosticSummaries(log({ condition, actualValue: 0, conditionResult: false }))[0]).toMatchObject({
      label: 'Condition failed · actual: 0',
      severity: 'danger',
    });
    expect(getWorkflowLogDiagnosticSummaries(log({ condition }))[0]).toMatchObject({
      label: 'Condition not evaluated',
      severity: 'secondary',
    });
    expect(formatWorkflowConditionTarget(log({ condition }))).toBe('lastResponse.jsonPath.$.items.length');
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
});
