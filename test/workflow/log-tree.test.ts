import { describe, expect, it } from 'vitest';
import type { WorkflowRunLog } from '@/types/models';
import {
  buildWorkflowLogTree,
  flattenWorkflowLogTree,
  getRunningWorkflowLogExpandedKeys,
  isWorkflowLogNearBottom,
  resolveWorkflowLogExpandedKeys,
} from '@/utils/workflowLogTree';

const log = (overrides: Partial<WorkflowRunLog>): WorkflowRunLog => ({
  id: overrides.id || 'log',
  stepId: overrides.stepId || 'step',
  stepName: overrides.stepName || 'Step',
  stepType: overrides.stepType || 'request',
  level: overrides.level || 'success',
  status: overrides.status || 'passed',
  message: overrides.message || 'done',
  timestamp: overrides.timestamp || '2026-09-01T00:00:00.000Z',
  ...overrides,
});

const makeLogs = () => [
  log({ id: 'workflow', stepType: 'workflow', sequence: 1, status: 'completed' }),
  log({ id: 'first', parentId: 'workflow', sequence: 2, stepName: 'First request' }),
  log({ id: 'loop', parentId: 'workflow', sequence: 3, stepType: 'for', stepName: 'Loop', status: 'completed' }),
  log({ id: 'iteration', parentId: 'loop', sequence: 4, stepType: 'for', stepName: 'Loop', iteration: 1 }),
  log({ id: 'nested', parentId: 'iteration', sequence: 5, stepName: 'Nested request' }),
  log({ id: 'last', parentId: 'workflow', sequence: 6, stepName: 'Last request' }),
];

describe('workflow log tree', () => {
  it('builds stable hierarchy paths while preserving sequence order', () => {
    const rows = flattenWorkflowLogTree(buildWorkflowLogTree(makeLogs()));
    expect(Object.fromEntries(rows.map(row => [row.id, row.treePath]))).toEqual({
      first: '1',
      loop: '2',
      iteration: '2.1',
      nested: '2.1.1',
      last: '3',
    });
  });

  it('hides the workflow root, collapses top-level controls by default, and preserves manual choices', () => {
    const nodes = buildWorkflowLogTree(makeLogs());
    expect(nodes.map(node => node.key)).toEqual(['first', 'loop', 'last']);
    expect(resolveWorkflowLogExpandedKeys({}, nodes, true)).toEqual({});
    expect(resolveWorkflowLogExpandedKeys({ loop: true }, nodes, false)).toEqual({
      loop: true,
    });
  });

  it('automatically expands every ancestor of a failed request', () => {
    const failedLogs = makeLogs().map(item => item.id === 'nested'
      ? { ...item, status: 'failed' as const, level: 'error' as const }
      : item);
    const keys = resolveWorkflowLogExpandedKeys({}, buildWorkflowLogTree(failedLogs), true);
    expect(keys).toMatchObject({ loop: true, iteration: true });
  });

  it('only expands the latest running iteration path', () => {
    const runningLogs = makeLogs().map(item => {
      if (item.id === 'loop') return { ...item, status: 'started' as const };
      if (item.id === 'iteration') return { ...item, status: 'passed' as const };
      if (item.id === 'nested') return { ...item, status: 'passed' as const };
      return item;
    });
    runningLogs.push(
      log({ id: 'iteration-2', parentId: 'loop', sequence: 7, stepType: 'for', iteration: 2, status: 'started' }),
      log({ id: 'nested-2', parentId: 'iteration-2', sequence: 8, status: 'started' }),
    );

    expect(getRunningWorkflowLogExpandedKeys(buildWorkflowLogTree(runningLogs))).toEqual({
      loop: true,
      'iteration-2': true,
    });
  });

  it('expands a nested active path and removes it after successful completion', () => {
    const nestedLogs = [
      log({ id: 'workflow', stepType: 'workflow', sequence: 1, status: 'started' }),
      log({ id: 'outer', parentId: 'workflow', sequence: 2, stepType: 'for', status: 'started' }),
      log({ id: 'outer-iteration', parentId: 'outer', sequence: 3, stepType: 'for', iteration: 1, status: 'started' }),
      log({ id: 'inner', parentId: 'outer-iteration', sequence: 4, stepType: 'while', status: 'started' }),
      log({ id: 'inner-iteration', parentId: 'inner', sequence: 5, stepType: 'while', iteration: 1, status: 'started' }),
      log({ id: 'request', parentId: 'inner-iteration', sequence: 6, status: 'running' }),
    ];
    const nodes = buildWorkflowLogTree(nestedLogs);
    expect(getRunningWorkflowLogExpandedKeys(nodes)).toEqual({
      outer: true,
      'outer-iteration': true,
      inner: true,
      'inner-iteration': true,
    });

    const completedNodes = buildWorkflowLogTree(nestedLogs.map(item => ({
      ...item,
      status: 'completed' as const,
    })));
    expect(getRunningWorkflowLogExpandedKeys(completedNodes)).toEqual({});
  });

  it('combines manual, running, and problem expansion states', () => {
    const logs = makeLogs().map(item => item.id === 'nested'
      ? { ...item, status: 'failed' as const, level: 'error' as const }
      : item.id === 'loop'
        ? { ...item, status: 'started' as const }
        : item);
    expect(resolveWorkflowLogExpandedKeys({ last: true }, buildWorkflowLogTree(logs), false, true)).toMatchObject({
      last: true,
      loop: true,
      iteration: true,
    });
  });

  it('detects whether the scroll viewport is close enough to the bottom', () => {
    expect(isWorkflowLogNearBottom(668, 300, 1000)).toBe(true);
    expect(isWorkflowLogNearBottom(650, 300, 1000)).toBe(false);
  });
});
