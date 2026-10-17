// Workflow 运行日志：写入、原地更新日志，并在写入时沿父级累加请求统计，
// 避免每条日志都复制整个数组、每次统计都遍历全部日志。

import type { WorkflowRunLog } from '@/types/models';

export interface RequestStats {
  requestCount: number;
  passedRequestCount: number;
  failedRequestCount: number;
}

export interface RunLogTarget {
  runId: string;
  workflowId: string;
  workflowName: string;
  /** 写入日志的列表（如当前运行日志和该 Workflow 的日志），同一次运行中顺序相同 */
  lists: () => WorkflowRunLog[][];
}

// 一条日志对上级统计的贡献；被禁用而跳过的请求步骤没有执行，不计入请求数
const requestContribution = (log: WorkflowRunLog | undefined): RequestStats => {
  const counted = Boolean(log) && log!.stepType === 'request' && log!.status !== 'skipped';
  return {
    requestCount: counted ? 1 : 0,
    passedRequestCount: counted && log!.status === 'passed' ? 1 : 0,
    failedRequestCount: counted && log!.status === 'failed' ? 1 : 0,
  };
};

const replaceInList = (list: WorkflowRunLog[], index: number | undefined, log: WorkflowRunLog) => {
  // 列表中途被清空过时退回按 id 查找
  const position = index !== undefined && list[index]?.id === log.id
    ? index
    : list.findIndex(item => item.id === log.id);
  if (position !== -1) list[position] = log;
};

export class RunLogRecorder {
  private sequence = 0;
  private readonly indexById = new Map<string, number>();
  private readonly parentIdById = new Map<string, string | undefined>();
  private readonly statsById = new Map<string, RequestStats>();
  private readonly latestById = new Map<string, WorkflowRunLog>();

  constructor(private readonly target: RunLogTarget) {}

  add(log: WorkflowRunLog): WorkflowRunLog {
    const enrichedLog = {
      ...log,
      runId: log.runId || this.target.runId,
      workflowId: log.workflowId || this.target.workflowId,
      workflowName: log.workflowName || this.target.workflowName,
      sequence: log.sequence || ++this.sequence,
    };
    const lists = this.target.lists();
    this.indexById.set(enrichedLog.id, lists[0]?.length ?? 0);
    this.parentIdById.set(enrichedLog.id, enrichedLog.parentId);
    this.latestById.set(enrichedLog.id, enrichedLog);
    lists.forEach(list => list.push(enrichedLog));
    this.applyStats(undefined, enrichedLog);
    return enrichedLog;
  }

  /** 返回更新后的新对象；已持有的旧对象不会被修改 */
  update(log: WorkflowRunLog, updates: Partial<WorkflowRunLog>): WorkflowRunLog {
    const previous = this.latestById.get(log.id) || log;
    const updatedLog = { ...log, ...updates };
    const index = this.indexById.get(log.id);
    this.target.lists().forEach(list => replaceInList(list, index, updatedLog));
    this.latestById.set(log.id, updatedLog);
    this.applyStats(previous, updatedLog);
    return updatedLog;
  }

  /** 某条日志下所有请求步骤的数量、通过数和失败数 */
  stats(logId: string): RequestStats {
    return { requestCount: 0, passedRequestCount: 0, failedRequestCount: 0, ...this.statsById.get(logId) };
  }

  private applyStats(previous: WorkflowRunLog | undefined, next: WorkflowRunLog) {
    const before = requestContribution(previous);
    const after = requestContribution(next);
    const delta = {
      requestCount: after.requestCount - before.requestCount,
      passedRequestCount: after.passedRequestCount - before.passedRequestCount,
      failedRequestCount: after.failedRequestCount - before.failedRequestCount,
    };
    if (!delta.requestCount && !delta.passedRequestCount && !delta.failedRequestCount) return;

    let ancestorId = this.parentIdById.get(next.id);
    while (ancestorId) {
      const stats = this.statsById.get(ancestorId) || { requestCount: 0, passedRequestCount: 0, failedRequestCount: 0 };
      stats.requestCount += delta.requestCount;
      stats.passedRequestCount += delta.passedRequestCount;
      stats.failedRequestCount += delta.failedRequestCount;
      this.statsById.set(ancestorId, stats);
      ancestorId = this.parentIdById.get(ancestorId);
    }
  }
}
