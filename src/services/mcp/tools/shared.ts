// 参数校验和输出给 AI 的通用转换

import type { ConsoleLog, RequestTestResults, WorkflowRunLog } from '@/types/models';
import type { StreamView } from '@/utils/streamResponse';
import { getFailedTestResults } from '@/utils/requestTests';
import { type McpConfirmRequest, type McpToolContext, McpToolError, MCP_HIDDEN_VALUE, MAX_BODY_CHARS, SENSITIVE_HEADERS } from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** value 是列表中的某个字符串 */
export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

export function fail(message: string): never {
  throw new McpToolError(message);
}

export function requireString(args: Record<string, unknown>, key: string, label: string = key): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) fail(`${label} is required`);
  return value.trim();
}

export function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail(`${label} must be a string`);
  return value;
}

export function stringValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function fileNameFromPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() || '';
}

/** URL 字段：传了就不能为空 */
export function requireUrl(value: unknown, label: string = 'url'): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} is required`);
  return value;
}

export function isTemplate(value: string): boolean {
  return /^\s*\{\{[^}]+\}\}\s*$/.test(value);
}

export function hide(value: string, reveal: boolean): string {
  if (reveal || !value || isTemplate(value)) return value;
  return MCP_HIDDEN_VALUE;
}

export function truncate(text: string, limit: number = MAX_BODY_CHARS): string {
  if (!text || text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… (truncated, ${text.length} characters in total)`;
}

export function hideSensitiveHeaders(headers: Record<string, string> | undefined, reveal: boolean) {
  if (!headers) return headers;
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => (
    [key, SENSITIVE_HEADERS.has(key.toLowerCase()) ? hide(String(value), reveal) : value]
  )));
}

/** 流式响应（SSE / 逐行 JSON）的摘要；不是流式响应时返回 undefined */
export function describeStreamResult(stream: StreamView | undefined) {
  if (!stream) return undefined;
  return {
    text: truncate(stream.text ?? ''),
    thinking: stream.thinking ? truncate(stream.thinking) : undefined,
    results: stream.results?.length
      ? stream.results.map(({ event, text, value }) => ({ event, ...(text ? { text: truncate(text) } : {}), ...(value !== undefined ? { value } : {}) }))
      : undefined,
    finishReason: stream.finishReason ?? undefined,
    usage: Object.values(stream.usage || {}).some(value => value !== undefined) ? stream.usage : undefined,
    eventCount: stream.eventCount,
  };
}

/** 没有未解析变量时返回 undefined，结果里就不带这个字段 */
export function unresolvedVariablesOf(consoleLog: Pick<ConsoleLog, 'unresolvedVariables'> | undefined): string[] | undefined {
  const names = consoleLog?.unresolvedVariables;
  return Array.isArray(names) && names.length > 0 ? names : undefined;
}

export function describeLog(log: WorkflowRunLog) {
  return {
    logId: log.id,
    sequence: log.sequence,
    depth: log.depth,
    stepId: log.stepId,
    stepName: log.stepName,
    stepType: log.stepType,
    status: log.status,
    message: log.message,
    durationMs: log.durationMs,
    iteration: log.iteration,
    responseStatus: log.response?.status,
    conditionResult: log.conditionResult,
    actualValue: log.actualValue,
    conditionMatch: log.conditionMatch,
    // 有多个条件时每个条件的结果，顺序与步骤的 conditions 一致
    conditionChecks: log.conditionChecks?.map(({ actualValue, passed, metAtIteration }) => ({ actualValue, passed, metAtIteration })),
  };
}

export function summarizeTests(testResults: RequestTestResults) {
  const failed = getFailedTestResults(testResults);
  return {
    passed: failed.length === 0,
    failures: failed.map(result => result.message),
    extractedVariables: (testResults.globalVars || []).map(item => ({
      variableName: item.variableName,
      status: item.status ?? (item.success ? 'set' : 'failed'),
      message: item.message,
    })),
  };
}

export async function confirmOrThrow(context: McpToolContext, request: McpConfirmRequest) {
  const allowed = await context.confirm(request);
  if (!allowed) fail('The user declined this action');
}
