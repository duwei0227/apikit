import type { RequestTestResults, WorkflowRunLog } from '@/types/models';

export type WorkflowLogDiagnosticSummary = {
  kind: 'condition' | 'tests';
  label: string;
  title: string;
  severity: 'success' | 'danger' | 'secondary';
};

export const formatWorkflowLogValue = (value: any) => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

export const formatWorkflowConditionTarget = (log: WorkflowRunLog) => {
  if (!log.condition) return '-';
  const source = log.condition.source || '';
  const field = log.condition.field && log.condition.field !== 'value' ? `.${log.condition.field}` : '';
  const path = log.condition.path ? `.${log.condition.path}` : '';
  return `${source}${field}${path}` || '-';
};

export const getRequestTestStats = (testResults?: RequestTestResults) => {
  if (!testResults) return undefined;
  const assertions = [...(testResults.statusCode || []), ...(testResults.jsonFields || [])];
  const passed = assertions.filter(result => result.passed).length;
  return {
    passed,
    total: assertions.length,
    failed: assertions.length - passed,
  };
};

export const getWorkflowLogDiagnosticSummaries = (log: WorkflowRunLog): WorkflowLogDiagnosticSummary[] => {
  const summaries: WorkflowLogDiagnosticSummary[] = [];

  if (log.condition) {
    const actual = formatWorkflowLogValue(log.actualValue);
    if (log.conditionResult === undefined) {
      summaries.push({
        kind: 'condition',
        label: 'Condition not evaluated',
        title: 'Condition not evaluated',
        severity: 'secondary',
      });
    } else {
      const result = log.conditionResult ? 'passed' : 'failed';
      summaries.push({
        kind: 'condition',
        label: `Condition ${result} · actual: ${actual}`,
        title: `Condition ${result} · actual: ${actual}`,
        severity: log.conditionResult ? 'success' : 'danger',
      });
    }
  }

  const testStats = getRequestTestStats(log.testResults);
  if (testStats && testStats.total > 0) {
    const result = testStats.failed > 0 ? 'failed' : 'passed';
    summaries.push({
      kind: 'tests',
      label: `Tests ${testStats.passed}/${testStats.total} ${result}`,
      title: `Tests ${testStats.passed}/${testStats.total} ${result}`,
      severity: testStats.failed > 0 ? 'danger' : 'success',
    });
  }

  return summaries;
};

export const canInspectWorkflowLog = (log: WorkflowRunLog) => Boolean(
  log.request || log.response || log.testResults || log.condition,
);
