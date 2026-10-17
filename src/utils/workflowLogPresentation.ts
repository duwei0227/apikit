import type { RequestTestResults, WorkflowCondition, WorkflowConditionMatch, WorkflowRunLog } from '@/types/models';

export type WorkflowLogSeverity = 'success' | 'warn' | 'danger' | 'secondary';

export type WorkflowLogDiagnosticSummary = {
  kind: 'condition' | 'tests';
  label: string;
  title: string;
  severity: WorkflowLogSeverity;
};

export type WorkflowConditionOutcome = {
  badge: string;
  label: string;
  title: string;
  severity: WorkflowLogSeverity;
};

export const formatWorkflowLogValue = (value: unknown) => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

export const formatConditionTarget = (condition?: WorkflowCondition) => {
  if (!condition) return '-';
  const source = condition.source || '';
  const field = condition.field && condition.field !== 'value' ? `.${condition.field}` : '';
  const path = condition.path ? `.${condition.path}` : '';
  return `${source}${field}${path}` || '-';
};

export const formatWorkflowConditionTarget = (log: WorkflowRunLog) => formatConditionTarget(log.condition);

export const CONDITION_MATCH_LABELS: Record<WorkflowConditionMatch, string> = {
  all: 'All conditions are true at once',
  any: 'Any condition is true',
  cumulative: 'Each condition has been met (any order)',
};

/** 条件结果的简短说明：一个条件时为取到的值，多个条件时为满足的个数 */
export const formatWorkflowConditionActual = (log: WorkflowRunLog) => {
  const checks = log.conditionChecks;
  if (!checks?.length) return `actual: ${formatWorkflowLogValue(log.actualValue)}`;
  const passed = checks.filter(check => check.passed).length;
  const noun = log.conditionMatch === 'cumulative' ? 'met' : 'true';
  return `${passed}/${checks.length} conditions ${noun}`;
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

const notEvaluatedOutcome: WorkflowConditionOutcome = {
  badge: 'not evaluated',
  label: 'Condition not evaluated',
  title: 'Condition not evaluated',
  severity: 'secondary',
};

const loopNouns: Record<string, string> = {
  while: 'While',
  doWhile: 'Do while',
  until: 'Until',
};

const completedIterations = (log: WorkflowRunLog) => log.completedIterations ?? log.iteration ?? 0;

const untilOutcome = (log: WorkflowRunLog, actual: string): WorkflowConditionOutcome => {
  if (log.status === 'stopped') {
    return {
      badge: 'max iterations',
      label: 'Condition not met · max iterations',
      title: `Until condition never satisfied within ${completedIterations(log)} iterations · loop stopped by max iterations · ${actual}`,
      severity: 'warn',
    };
  }
  return log.conditionResult
    ? {
      badge: 'met',
      label: `Condition met · ${actual}`,
      title: `Until condition satisfied · exit loop · ${actual}`,
      severity: 'success',
    }
    : {
      badge: 'not met',
      label: `Condition not met · ${actual}`,
      title: `Until condition not met yet · continue iterating · ${actual}`,
      severity: 'secondary',
    };
};

const repeatWhileOutcome = (log: WorkflowRunLog, actual: string, noun: string): WorkflowConditionOutcome => {
  if (log.status === 'stopped') {
    return {
      badge: 'max iterations',
      label: 'Condition still holds · max iterations',
      title: `${noun} condition still holds after ${completedIterations(log)} iterations · loop stopped by max iterations · ${actual}`,
      severity: 'warn',
    };
  }
  return log.conditionResult
    ? {
      badge: 'holds',
      label: `Condition holds · ${actual}`,
      title: `${noun} condition holds · continue iterating · ${actual}`,
      severity: 'secondary',
    }
    : {
      badge: 'ended',
      label: `Condition ended · ${actual}`,
      title: `${noun} condition no longer holds · exit loop · ${actual}`,
      severity: 'success',
    };
};

const branchOutcome = (log: WorkflowRunLog, actual: string, errored: boolean): WorkflowConditionOutcome => {
  if (log.conditionResult) {
    return {
      badge: 'matched',
      label: `Condition matched · ${actual}`,
      title: `Condition matched · then branch selected · ${actual}`,
      severity: 'success',
    };
  }
  return errored
    ? {
      badge: 'not matched',
      label: 'Condition not matched · no else branch',
      title: `Condition not matched and no else branch configured · workflow stopped · ${actual}`,
      severity: 'danger',
    }
    : {
      badge: 'not matched',
      label: `Condition not matched · ${actual}`,
      title: `Condition not matched · else branch selected · ${actual}`,
      severity: 'secondary',
    };
};

// conditionResult is a raw boolean whose meaning depends on the step type: for until it means
// "target reached", for while/do-while "keep looping", for if "take the then branch". Only a
// genuinely failed row (level/status) may surface as danger.
export const getWorkflowConditionOutcome = (log: WorkflowRunLog): WorkflowConditionOutcome | null => {
  if (!log.condition) return null;
  if (log.conditionResult === undefined) return notEvaluatedOutcome;

  const actual = formatWorkflowConditionActual(log);
  const errored = log.level === 'error' || log.status === 'failed';
  const outcome = log.stepType === 'until'
    ? untilOutcome(log, actual)
    : log.stepType === 'while' || log.stepType === 'doWhile'
      ? repeatWhileOutcome(log, actual, loopNouns[log.stepType])
      : branchOutcome(log, actual, errored);

  return errored ? { ...outcome, severity: 'danger' } : outcome;
};

export const getWorkflowLogDiagnosticSummaries = (log: WorkflowRunLog): WorkflowLogDiagnosticSummary[] => {
  const summaries: WorkflowLogDiagnosticSummary[] = [];

  const conditionOutcome = getWorkflowConditionOutcome(log);
  if (conditionOutcome) {
    summaries.push({
      kind: 'condition',
      label: conditionOutcome.label,
      title: conditionOutcome.title,
      severity: conditionOutcome.severity,
    });
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
  log.request || log.response || log.testResults || log.condition || log.setVariables?.length,
);
