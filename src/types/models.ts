// Core data models for ApiKit

import type { StreamView } from '@/utils/streamResponse';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
  /** Preserve the distinction between `?flag` and `?flag=` for query params. */
  hasEquals?: boolean;
}

export interface RequestBody {
  type: 'none' | 'json' | 'xml' | 'text' | 'binary' | 'form-data' | 'x-www-form-urlencoded';
  raw: string;
  formData: FormDataItem[];
  urlencoded: KeyValue[];
  filePath?: string;
}

export interface FormDataItem {
  key: string;
  value: string;
  type: 'text' | 'file';
  enabled: boolean;
  file?: File | null;
  filePath?: string;
}

export interface AuthConfig {
  type: 'none' | 'bearer' | 'basic';
  token: string;
  username: string;
  password: string;
}

export interface TestConfig {
  statusCodeTests: StatusCodeTest[];
  jsonFieldTests: JsonFieldTest[];
  globalVariables: GlobalVariableConfig[];
}

export interface RequestSettings {
  followRedirects?: boolean;
  maxRedirectCount?: number;
  verifySsl?: boolean;
  autoEncodeUrl?: boolean;
  acceptEncoding?: boolean;
}

export interface StatusCodeTest {
  enabled: boolean;
  operator: string;
  expectedValue: string;
  description: string;
}

export interface JsonFieldTest {
  enabled: boolean;
  jsonPath: string;
  operator: string;
  expectedValue: string;
  description: string;
}


/** 提取变量的来源：响应 JSON 中的值、自定义值或响应头 */
export type GlobalVariableValueType = 'jsonPath' | 'customValue' | 'header';

export interface GlobalVariableConfig {
  enabled: boolean;
  variableName: string;
  valueType: GlobalVariableValueType;
  jsonPath: string;
  customValue: string;
  /** valueType 为 header 时的响应头名称，不区分大小写 */
  headerName?: string;
  description: string;
}

export interface StatusCodeTestResult {
  index: number;
  passed: boolean;
  message: string;
  description: string;
  actualValue: number;
  operator: string;
  expectedValue: string;
}

export interface JsonFieldTestResult {
  index: number;
  passed: boolean;
  message: string;
  description: string;
  /** 从响应中取到的值（任意 JSON 值） */
  actualValue?: unknown;
  operator: string;
  expectedValue: string;
  jsonPath: string;
}

export interface GlobalVariableTestResult {
  index: number;
  success: boolean;
  status?: 'set' | 'failed' | 'skipped';
  message: string;
  description: string;
  variableName?: string;
  valueType?: GlobalVariableValueType;
  source?: string;
  value?: string;
}

export interface RequestTestResults {
  statusCode: StatusCodeTestResult[];
  jsonFields: JsonFieldTestResult[];
  globalVars: GlobalVariableTestResult[];
}

/** 请求编辑器中显示的响应 */
export interface HttpResponseView {
  status: number;
  statusText: string;
  /** 已格式化的耗时，例如 "120ms" */
  time: string;
  /** 已格式化的大小，例如 "1.2KB" */
  size: string;
  /** 用于显示的内容（JSON 已格式化） */
  body: string;
  /** 收到的原始内容 */
  rawBody: string;
  headers: Record<string, string>;
  contentType: string;
  imageDataUrl: string;
  isPartialJson?: boolean;
  /** 流式响应（SSE / NDJSON） */
  stream?: StreamView;
  /** 流式响应合并后的结果对象（JSON），供断言和提取变量使用 */
  testBody?: string;
}

export interface RequestReference {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  /** 同层级内的显示顺序（与 folders 合并排序）。缺省时回退到「folders 在前、requests 在后」。 */
  order?: number;
}

export interface Request {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: RequestBody;
  auth: AuthConfig;
  tests: TestConfig;
  testsConfig?: TestConfig;
  settings?: RequestSettings;
  /** 临时请求（未保存到 Collection）为 null 或不存在 */
  collectionId?: string | null;
  folderId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRequestOverrides {
  method?: HttpMethod;
  url?: string;
  params?: KeyValue[];
  headers?: KeyValue[];
  body?: RequestBody;
  auth?: AuthConfig;
  testsConfig?: TestConfig;
  settings?: RequestSettings;
}

export type WorkflowStepType = 'request' | 'if' | 'for' | 'while' | 'doWhile' | 'until' | 'setVariables';

export interface WorkflowCondition {
  source: 'lastResponse' | 'stepResponse' | 'globalVariable' | 'loopIndex';
  stepId?: string;
  field: 'status' | 'body' | 'header' | 'jsonPath' | 'value';
  path?: string;
  operator: string;
  expectedValue: string;
}

/** 多个条件的组合方式：all 同时满足；any 任一满足；cumulative 每个条件在某次检查中满足过即可（只用于 until） */
export type WorkflowConditionMatch = 'all' | 'any' | 'cumulative';

/** 一次条件检查中单个条件的结果 */
export interface WorkflowConditionCheck {
  condition: WorkflowCondition;
  actualValue?: unknown;
  /** cumulative 模式下表示已满足过 */
  passed: boolean;
  /** cumulative 模式下首次满足时的循环次数 */
  metAtIteration?: number;
}

export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  name: string;
  enabled: boolean;
  collapsed?: boolean;
  requestSource?: 'reference' | 'inline';
  requestId?: string;
  requestOverrides?: WorkflowRequestOverrides;
  inlineRequest?: Request;
  /** 旧版的单个条件，读取时转为 conditions */
  condition?: WorkflowCondition;
  conditions?: WorkflowCondition[];
  /** 缺省为 all */
  conditionMatch?: WorkflowConditionMatch;
  thenSteps?: WorkflowStep[];
  elseSteps?: WorkflowStep[];
  childSteps?: WorkflowStep[];
  iterations?: number;
  maxIterations?: number;
  /** 循环步骤：每次循环之间等待的毫秒数（第一次之前不等待） */
  delayMs?: number;
  /** setVariables 步骤：要设置的全局变量，值可以使用 {{变量}} */
  variables?: KeyValue[];
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  steps: WorkflowStep[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunLog {
  id: string;
  parentId?: string;
  runId?: string;
  workflowId?: string;
  workflowName?: string;
  sequence?: number;
  stepId: string;
  stepName: string;
  stepType: WorkflowStepType | 'workflow';
  depth?: number;
  level: 'info' | 'success' | 'warn' | 'error';
  status: 'started' | 'running' | 'completed' | 'passed' | 'failed' | 'skipped' | 'stopped' | 'then' | 'else';
  message: string;
  iteration?: number;
  iterationTotal?: number;
  completedIterations?: number;
  requestCount?: number;
  passedRequestCount?: number;
  failedRequestCount?: number;
  durationMs?: number;
  /** 第一个条件；只有一个条件时 actualValue 是它取到的值 */
  condition?: WorkflowCondition;
  /** 条件取到的值（任意 JSON 值） */
  actualValue?: unknown;
  /** 所有条件组合后的结果 */
  conditionResult?: boolean;
  /** 有多个条件时的组合方式和每个条件的结果 */
  conditionMatch?: WorkflowConditionMatch;
  conditionChecks?: WorkflowConditionCheck[];
  /** setVariables 步骤设置的变量（替换后的值） */
  setVariables?: Array<{ key: string; value: string }>;
  request?: ConsoleLog;
  response?: HttpResponseView;
  testResults?: RequestTestResults;
  timestamp: string;
}

export interface Folder {
  id: string;
  name: string;
  description?: string;
  /** 同层级内的显示顺序（与同级 requests 合并排序）。缺省时回退到「folders 在前、requests 在后」。 */
  order?: number;
  folders: Folder[];
  requests: RequestReference[];
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  folders: Folder[];
  requests: RequestReference[];
  createdAt: string;
  updatedAt: string;
}

export interface EnvironmentVariable {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
  /** 全局变量最近一次设置的时间 */
  createdAt?: string;
}

export interface Environment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
  isActive: boolean;
}

/** History 中保存的请求部分，用来重新打开请求（旧版本保存的记录可能缺少字段） */
export interface HistoryRequestData {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string | null;
}

/** History 中保存的响应部分（不含响应体） */
export interface HistoryResponseData {
  headers?: Record<string, string>;
  statusText?: string;
  /** 旧版本保存的响应体，读取时去掉 */
  body?: string;
}

/** {{$sequence}} 的序列状态 */
export interface Sequence {
  name: string;
  currentValue: number;
  startValue: number;
  step: number;
  padding: number;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryItem {
  id: string;
  requestId?: string;
  method: string;
  url: string;
  status: number;
  duration: string;
  timestamp: string;
  requestData: HistoryRequestData;
  responseData: HistoryResponseData;
}

export interface ConsoleLog {
  id: string | number;
  startTime: number;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  endTime: number;
  status: number;
  statusText: string;
  duration: string;
  responseHeaders: Record<string, string>;
  responseBody: string;
  /** 发送时仍未定义的 {{变量}} */
  unresolvedVariables?: string[];
  /** 流式响应的概要 */
  stream?: { eventCount: number; firstEventMs: number | null; interrupted: string | null };
}

/** Console 日志的请求体和响应体：每条单独保存，展开日志时才读取 */
export interface ConsoleLogBody {
  requestBody: string | null;
  responseBody: string;
}

/** Console 日志索引中保存的摘要（不含 body） */
export type ConsoleLogSummary = Omit<ConsoleLog, keyof ConsoleLogBody>;

/** 日志索引文件中读到的条目：旧版本保存的条目还带着 body */
export type StoredConsoleLog = ConsoleLogSummary & Partial<ConsoleLogBody>;

/** History 记录的请求体：每条单独保存，打开记录时才读取 */
export interface HistoryItemBody {
  body: string | null;
}

/** 单独保存的日志 body，按日志类型区分目录 */
export interface LogBodies {
  console: ConsoleLogBody;
  history: HistoryItemBody;
}

export type LogBodyKind = keyof LogBodies;

export interface AppState {
  openRequests: string[]; // Request IDs
  activeRequestIndex: number;
  openWorkflows?: string[]; // Workflow IDs
  openMocks?: string[]; // Mock service IDs
  activeContentIndex?: number;
  /** 内容页签统一顺序：`request:<id>` / `workflow:<id>` / `mock:<id>` */
  tabOrder?: string[];
  activeEnvironmentId?: string;
  sidebarWidth: number;
  footerHeight: number;
  lastSavedAt: string;
}

// ---------------------------------------------------------------------------
// Mock 服务：每个服务一个端口，服务 → 路由（方法 + 路径）→ 多个响应

export type MockRuleSource = 'query' | 'header' | 'path' | 'body' | 'cookie';
export type MockRuleOperator = 'equals' | 'notEquals' | 'contains' | 'regex' | 'exists' | 'notExists';

/** 响应的匹配规则：从请求中取值（body 按 JSONPath）后比较 */
export interface MockRule {
  id: string;
  source: MockRuleSource;
  key: string;
  operator: MockRuleOperator;
  value: string;
}

/** json：JSON 编辑器；template：可用 {{#repeat}} 等块，显示生成预览；text：纯文本。三者都会替换 {{变量}} */
export type MockBodyMode = 'json' | 'template' | 'text';

export interface MockResponse {
  id: string;
  name: string;
  status: number;
  headers: KeyValue[];
  bodyMode: MockBodyMode;
  body: string;
  /** 为 null 时用服务的默认延迟 */
  delayMs: number | null;
  /** 没有其它响应满足规则时返回 */
  isDefault: boolean;
  ruleLogic: 'all' | 'any';
  rules: MockRule[];
}

export interface MockRoute {
  id: string;
  method: HttpMethod;
  /** 以 / 开头，路径参数写作 :id 或 {id} */
  path: string;
  enabled: boolean;
  responses: MockResponse[];
}

export interface MockService {
  id: string;
  name: string;
  port: number;
  /** ApiKit 启动时自动启动 */
  autoStart: boolean;
  cors: boolean;
  defaultDelayMs: number;
  routes: MockRoute[];
  createdAt: string;
  updatedAt: string;
}

/** 在临时请求中打开的 Mock 请求：路径和查询参数相对于服务地址 */
export interface MockOpenRequest {
  method: string;
  /** 路径，可以带 ?查询参数 */
  path: string;
  headers: Record<string, string>;
  body: string;
}

/** 调用记录的摘要：内存中只保留这些，完整的请求和响应在日志文件中 */
export interface MockLogSummary {
  id: string;
  time: string;
  method: string;
  path: string;
  query: string;
  status: number;
  /** 命中的路由，例如 "GET /orders/:id"；未命中时为空 */
  route?: string;
  responseName?: string;
  /** 未命中路由或响应时的原因 */
  reason?: string;
  durationMs: number;
}

export interface MockLogEntry extends MockLogSummary {
  request: { headers: Array<[string, string]>; body: string };
  response: { headers: Array<[string, string]>; body: string };
}
