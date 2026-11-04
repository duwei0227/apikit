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

/** 按名称匹配到多项时请用户选择 */
export interface McpChoiceRequest {
  tool: string;
  /** 说明要选什么，例如 Several folders match "服务" */
  message: string;
  /** 每项的显示文字，互不相同 */
  options: string[];
}

/** 所选项的序号；cancel 表示用户取消；null 表示客户端没法询问，由 AI 去问用户 */
export type McpChoiceAnswer = number | 'cancel' | null;

export interface McpToolContext {
  onConsoleLog: (log: ConsoleLog) => void;
  /** 执行类工具调用前请用户确认，返回是否允许 */
  confirm: (request: McpConfirmRequest) => Promise<boolean>;
  /** 在 AI 工具里请用户从多项中选一项；缺省表示不能询问 */
  choose?: (request: McpChoiceRequest) => Promise<McpChoiceAnswer>;
  revealSecrets: () => boolean;
  /** 修改已有的请求和 Workflow 时存为未保存的修改，不直接保存 */
  stageEdits: () => boolean;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export class McpToolError extends Error {}

export interface McpAmbiguity {
  /** 有歧义的参数，例如 collection、folderPath[1]、requests[2].copyFrom */
  field: string;
  input: string;
  candidates: Array<Record<string, unknown>>;
  /** 匹配项超过列出的候选数时的总数 */
  total?: number;
  /** folderPath 的某一级可以改为新建目录 */
  canCreate?: boolean;
}

/** 名称匹配到多项、又没法在 AI 工具里询问时返回候选，由 AI 请用户选择后重新调用 */
export class McpAmbiguityError extends McpToolError {
  constructor(readonly ambiguity: McpAmbiguity) {
    super(JSON.stringify({
      error: 'ambiguous',
      ...ambiguity,
      hint: ambiguity.canCreate
        ? 'Nothing was changed. Ask the user which folder to use or whether to create a new one, then call again with that folderPath entry replaced by { "id": "<chosen id>" } or { "name": "<name>", "create": true }.'
        : 'Nothing was changed. Ask the user which one to use, then call again with the chosen id in place of the name.',
    }, null, 2));
  }
}

/** 隐藏敏感值时使用的占位符；更新时收到它表示保留原值 */
export const MCP_HIDDEN_VALUE = '<hidden>';

export const MAX_BODY_CHARS = 20000;
export const DEFAULT_LOG_BODY_PAGE_CHARS = 8000;
export const MAX_LOG_ENTRIES = 200;
export const DEFAULT_REQUEST_LOG_LIMIT = 20;
export const MAX_REQUEST_LOG_LIMIT = 100;
export const DEFAULT_SEARCH_LIMIT = 20;
/** 批量工具一次最多处理的请求数 */
export const MAX_BATCH_REQUESTS = 50;
export const MAX_RUN_REQUESTS = 30;
export const DEFAULT_RUN_CONCURRENCY = 4;
export const MAX_RUN_CONCURRENCY = 8;
export const DEFAULT_BODY_PREVIEW_CHARS = 300;
export const MAX_BODY_PREVIEW_CHARS = 2000;
export const MAX_SEARCH_LIMIT = 100;
export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
export const BODY_TYPES: RequestBody['type'][] = ['none', 'json', 'xml', 'text', 'binary', 'form-data', 'x-www-form-urlencoded'];
export const STEP_TYPES = ['request', 'if', 'for', 'while', 'doWhile', 'until', 'setVariables'] as const;
export const LOOP_TYPES = ['for', 'while', 'doWhile', 'until'];
export const CONDITION_SOURCES: WorkflowCondition['source'][] = ['lastResponse', 'stepResponse', 'globalVariable', 'loopIndex'];
export const CONDITION_FIELDS: WorkflowCondition['field'][] = ['status', 'body', 'header', 'jsonPath', 'value'];
export const SENSITIVE_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key']);

export type McpToolHandler = (args: Record<string, unknown>, context: McpToolContext) => Promise<unknown>;
