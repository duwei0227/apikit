// 请求日志和 Workflow 运行日志

import { useConsoleLogsStore } from '@/stores/consoleLogs';
import { useWorkflowsStore } from '@/stores/workflows';
import type { ConsoleLogSummary } from '@/types/models';
import { pageLogBody } from '../logBodyPagination';
import { requireWorkflow } from '../lookups';
import { fail, requireString, optionalString, hideSensitiveHeaders, describeStreamResult, unresolvedVariablesOf, describeLog, summarizeTests } from '../shared';
import {
  MAX_LOG_ENTRIES,
  DEFAULT_LOG_BODY_PAGE_CHARS,
  DEFAULT_REQUEST_LOG_LIMIT,
  MAX_BODY_CHARS,
  MAX_REQUEST_LOG_LIMIT,
  type McpToolHandler,
} from '../types';

function matchesStatus(status: number, filter: string): boolean {
  const value = filter.trim().toLowerCase();
  const classMatch = value.match(/^([1-5])xx$/);
  if (classMatch) return Math.floor(status / 100) === Number(classMatch[1]);
  if (!/^\d+$/.test(value)) fail('status must be a status code such as "404" or a class such as "4xx"');
  return status === Number(value);
}

function describeRequestLogSummary(log: ConsoleLogSummary) {
  const time = Number(log.endTime || log.startTime);
  return {
    logId: String(log.id),
    time: Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : undefined,
    method: log.method,
    url: log.url,
    status: log.status,
    statusText: log.statusText || undefined,
    duration: log.duration,
  };
}

export const logHandlers: Record<string, McpToolHandler> = {
  async list_request_logs(args) {
    const urlContains = optionalString(args.urlContains, 'urlContains')?.toLowerCase();
    const method = optionalString(args.method, 'method')?.toUpperCase();
    const status = args.status === undefined ? undefined : String(args.status);
    if (status !== undefined) matchesStatus(0, status); // 先校验格式，没有日志时也能报错
    let limit = DEFAULT_REQUEST_LOG_LIMIT;
    if (args.limit !== undefined) {
      limit = Number(args.limit);
      if (!Number.isInteger(limit) || limit < 1) fail('limit must be a positive integer');
      limit = Math.min(limit, MAX_REQUEST_LOG_LIMIT);
    }

    const matched = useConsoleLogsStore().logs.filter(log => (
      (!urlContains || String(log.url || '').toLowerCase().includes(urlContains))
      && (!method || String(log.method || '').toUpperCase() === method)
      && (status === undefined || matchesStatus(Number(log.status) || 0, status))
    ));
    return {
      totalMatched: matched.length,
      logs: matched.slice(0, limit).map(describeRequestLogSummary),
    };
  },

  async get_request_log(args, context) {
    const logId = requireString(args, 'logId');
    const bodyPart = args.bodyPart === undefined ? 'both' : args.bodyPart;
    if (bodyPart !== 'request' && bodyPart !== 'response' && bodyPart !== 'both') {
      fail('bodyPart must be request, response or both');
    }
    const pageLimit = args.limit === undefined ? DEFAULT_LOG_BODY_PAGE_CHARS : Number(args.limit);
    if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > MAX_BODY_CHARS) {
      fail(`limit must be an integer between 1 and ${MAX_BODY_CHARS}`);
    }
    const store = useConsoleLogsStore();
    const log = store.logs.find(item => String(item.id) === logId)
      || fail(`Request log not found: ${logId}`);
    const { requestBody, responseBody } = await store.loadLogBody(log.id);
    const reveal = context.revealSecrets();
    const requestOffset = args.requestOffset === undefined ? 0 : Number(args.requestOffset);
    const responseOffset = args.responseOffset === undefined ? 0 : Number(args.responseOffset);
    if (bodyPart !== 'response' && (!Number.isInteger(requestOffset) || requestOffset < 0)) {
      fail('requestOffset must be a non-negative integer');
    }
    if (bodyPart !== 'request' && (!Number.isInteger(responseOffset) || responseOffset < 0)) {
      fail('responseOffset must be a non-negative integer');
    }
    return {
      ...describeRequestLogSummary(log),
      unresolvedVariables: unresolvedVariablesOf(log),
      request: {
        headers: hideSensitiveHeaders(log.requestHeaders, reveal),
        ...(bodyPart !== 'response' ? {
          ...pageLogBody(requestBody == null ? '' : String(requestBody), requestOffset, pageLimit),
          ...(requestBody == null ? { body: null } : {}),
        } : {}),
      },
      response: {
        headers: hideSensitiveHeaders(log.responseHeaders, reveal),
        ...(bodyPart !== 'request' ? {
          ...pageLogBody(responseBody ?? '', responseOffset, pageLimit),
        } : {}),
      },
    };
  },

  async get_workflow_logs(args, context) {
    const workflow = requireWorkflow(requireString(args, 'workflowId'));
    const logs = useWorkflowsStore().getWorkflowLogs(workflow.id);
    const logId = optionalString(args.logId, 'logId');
    if (logId) {
      const log = logs.find(item => item.id === logId) || fail(`Log entry not found: ${logId}`);
      const bodyPart = args.bodyPart === undefined ? 'both' : args.bodyPart;
      if (bodyPart !== 'request' && bodyPart !== 'response' && bodyPart !== 'both') {
        fail('bodyPart must be request, response or both');
      }
      const pageLimit = args.limit === undefined ? DEFAULT_LOG_BODY_PAGE_CHARS : Number(args.limit);
      if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > MAX_BODY_CHARS) {
        fail(`limit must be an integer between 1 and ${MAX_BODY_CHARS}`);
      }
      const requestOffset = args.requestOffset === undefined ? 0 : Number(args.requestOffset);
      const responseOffset = args.responseOffset === undefined ? 0 : Number(args.responseOffset);
      if (bodyPart !== 'response' && (!Number.isInteger(requestOffset) || requestOffset < 0)) {
        fail('requestOffset must be a non-negative integer');
      }
      if (bodyPart !== 'request' && (!Number.isInteger(responseOffset) || responseOffset < 0)) {
        fail('responseOffset must be a non-negative integer');
      }
      return {
        ...describeLog(log),
        condition: log.conditionChecks ? undefined : log.condition,
        conditionChecks: log.conditionChecks,
        request: log.request ? {
          method: log.request.method,
          url: log.request.url,
          headers: hideSensitiveHeaders(log.request.requestHeaders, context.revealSecrets()),
          ...(bodyPart !== 'response' ? {
            ...pageLogBody(log.request.requestBody ?? '', requestOffset, pageLimit),
            ...(log.request.requestBody == null ? { body: null } : {}),
          } : {}),
        } : undefined,
        response: log.response ? {
          status: log.response.status,
          headers: log.response.headers,
          ...(bodyPart !== 'request' ? {
            ...pageLogBody(log.response.rawBody ?? '', responseOffset, pageLimit),
          } : {}),
          stream: describeStreamResult(log.response.stream),
        } : undefined,
        tests: log.testResults ? summarizeTests(log.testResults) : undefined,
        unresolvedVariables: unresolvedVariablesOf(log.request),
      };
    }
    if (logs.length === 0) return { logs: [], message: 'This workflow has not run since ApiKit started' };
    return {
      logs: logs.slice(0, MAX_LOG_ENTRIES).map(describeLog),
      truncatedLogs: Math.max(0, logs.length - MAX_LOG_ENTRIES),
    };
  },
};
