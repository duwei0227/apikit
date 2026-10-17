// MCP 工具的类型和共用常量

import type { ConsoleLog, HttpMethod, RequestBody, WorkflowCondition } from '@/types/models';

export type McpToolKind = 'read' | 'write' | 'execute';

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  kind: McpToolKind;
  /** 执行类工具默认会访问外部网络；只改 ApiKit 本地状态的设为 true */
  localOnly?: boolean;
  /** 非执行类工具在某些参数下也会请用户确认 */
  mayConfirm?: boolean;
  /** 删除等不可撤销的操作：每次都请用户确认 */
  destructive?: boolean;
  /** JSON Schema */
  inputSchema: Record<string, unknown>;
}

export interface McpConfirmRequest {
  tool: string;
  title: string;
  detail: string;
  /** 确认框里的说明文字，缺省为发送真实请求的提示 */
  note?: string;
  /** 不可撤销的操作：即使选择过"全部允许"也要确认，确认时不提供"全部允许" */
  destructive?: boolean;
}

export interface McpToolContext {
  onConsoleLog: (log: ConsoleLog) => void;
  /** 执行类工具调用前请用户确认，返回是否允许 */
  confirm: (request: McpConfirmRequest) => Promise<boolean>;
  revealSecrets: () => boolean;
  /** 修改已有的请求和 Workflow 时存为未保存的修改，不直接保存 */
  stageEdits: () => boolean;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export class McpToolError extends Error {}

/** 隐藏敏感值时使用的占位符；更新时收到它表示保留原值 */
export const MCP_HIDDEN_VALUE = '<hidden>';

export const MAX_BODY_CHARS = 20000;
export const DEFAULT_LOG_BODY_PAGE_CHARS = 8000;
export const MAX_LOG_ENTRIES = 200;
export const DEFAULT_REQUEST_LOG_LIMIT = 20;
export const MAX_REQUEST_LOG_LIMIT = 100;
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 100;
export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
export const BODY_TYPES: RequestBody['type'][] = ['none', 'json', 'xml', 'text', 'binary', 'form-data', 'x-www-form-urlencoded'];
export const STEP_TYPES = ['request', 'if', 'for', 'while', 'doWhile', 'until', 'setVariables'] as const;
export const LOOP_TYPES = ['for', 'while', 'doWhile', 'until'];
export const CONDITION_SOURCES: WorkflowCondition['source'][] = ['lastResponse', 'stepResponse', 'globalVariable', 'loopIndex'];
export const CONDITION_FIELDS: WorkflowCondition['field'][] = ['status', 'body', 'header', 'jsonPath', 'value'];
export const SENSITIVE_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key']);

export type McpToolHandler = (args: Record<string, unknown>, context: McpToolContext) => Promise<unknown>;
