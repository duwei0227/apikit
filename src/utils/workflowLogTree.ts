import type { WorkflowRunLog } from '@/types/models';

export type WorkflowLogTreeRow = WorkflowRunLog & {
  treeDepth: number;
  treePath: string;
  hasChildren: boolean;
  lifecycleDepth?: number;
};

export type WorkflowLogTreeNode = {
  key: string;
  data: WorkflowLogTreeRow;
  children: WorkflowLogTreeNode[];
};

const lifecycleStepTypes = new Set(['workflow', 'for', 'while', 'doWhile', 'until']);

export const buildWorkflowLogTree = (sourceLogs: WorkflowRunLog[]): WorkflowLogTreeNode[] => {
  const logs = [...sourceLogs].sort((left, right) => (left.sequence || 0) - (right.sequence || 0));
  const byParent = new Map<string, WorkflowRunLog[]>();
  const byId = new Map(logs.map(log => [log.id, log]));

  logs.forEach(log => {
    const parentKey = log.parentId && byId.has(log.parentId) ? log.parentId : '';
    const siblings = byParent.get(parentKey) || [];
    siblings.push(log);
    byParent.set(parentKey, siblings);
  });

  const buildNodes = (
    siblings: WorkflowRunLog[],
    treeDepth: number,
    parentPath: string,
  ): WorkflowLogTreeNode[] => siblings.map((log, index) => {
    const children = byParent.get(log.id) || [];
    const treePath = parentPath ? `${parentPath}.${index + 1}` : String(index + 1);
    const lifecycleDepth = lifecycleStepTypes.has(log.stepType) && log.iteration === undefined
      ? treeDepth
      : undefined;
    return {
      key: log.id,
      data: {
        ...log,
        treeDepth,
        treePath,
        hasChildren: children.length > 0,
        lifecycleDepth,
      },
      children: buildNodes(children, treeDepth + 1, treePath),
    };
  });

  const rootLogs = byParent.get('') || [];
  const workflowRoots = rootLogs.filter(log => log.stepType === 'workflow');
  const visibleRoots = workflowRoots.length > 0
    ? workflowRoots.flatMap(log => byParent.get(log.id) || [])
    : rootLogs;
  return buildNodes(visibleRoots, 0, '');
};

export const flattenWorkflowLogTree = (nodes: WorkflowLogTreeNode[]): WorkflowLogTreeRow[] => (
  nodes.flatMap(node => [node.data, ...flattenWorkflowLogTree(node.children)])
);

export const getProblemWorkflowLogExpandedKeys = (nodes: WorkflowLogTreeNode[]) => {
  const keys: Record<string, boolean> = {};
  const visit = (node: WorkflowLogTreeNode): boolean => {
    const childHasProblem = node.children.some(visit);
    const hasProblem = ['failed', 'stopped'].includes(node.data.status) || childHasProblem;
    if (hasProblem && node.children.length > 0) keys[node.key] = true;
    return hasProblem;
  };
  nodes.forEach(visit);
  return keys;
};

export const getRunningWorkflowLogExpandedKeys = (nodes: WorkflowLogTreeNode[]) => {
  let latestRunningSequence = -1;
  let latestRunningPath: WorkflowLogTreeNode[] = [];

  const visit = (node: WorkflowLogTreeNode, ancestors: WorkflowLogTreeNode[]) => {
    const path = [...ancestors, node];
    const sequence = node.data.sequence || 0;
    if (node.data.status === 'started' && sequence >= latestRunningSequence) {
      latestRunningSequence = sequence;
      latestRunningPath = path;
    }
    node.children.forEach(child => visit(child, path));
  };
  nodes.forEach(node => visit(node, []));

  return Object.fromEntries(
    latestRunningPath
      .filter(node => node.children.length > 0)
      .map(node => [node.key, true]),
  );
};

export const resolveWorkflowLogExpandedKeys = (
  manual: Record<string, boolean>,
  nodes: WorkflowLogTreeNode[],
  isNewTree: boolean,
  followLatest: boolean = false,
) => ({
  ...(isNewTree ? {} : manual),
  ...(followLatest ? getRunningWorkflowLogExpandedKeys(nodes) : {}),
  ...getProblemWorkflowLogExpandedKeys(nodes),
});

export const isWorkflowLogNearBottom = (
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold: number = 32,
) => scrollHeight - clientHeight - scrollTop <= threshold;
