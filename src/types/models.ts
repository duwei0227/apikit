// Core data models for ApiKit

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
  file?: File;
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


export interface GlobalVariableConfig {
  enabled: boolean;
  variableName: string;
  valueType: 'jsonPath' | 'customValue';
  jsonPath: string;
  customValue: string;
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
  actualValue?: any;
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
  valueType?: 'jsonPath' | 'customValue';
  source?: string;
  value?: string;
}

export interface RequestTestResults {
  statusCode: StatusCodeTestResult[];
  jsonFields: JsonFieldTestResult[];
  globalVars: GlobalVariableTestResult[];
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
  collectionId?: string;
  folderId?: string;
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

export type WorkflowStepType = 'request' | 'if' | 'for' | 'while' | 'doWhile' | 'until';

export interface WorkflowCondition {
  source: 'lastResponse' | 'stepResponse' | 'globalVariable' | 'loopIndex';
  stepId?: string;
  field: 'status' | 'body' | 'header' | 'jsonPath' | 'value';
  path?: string;
  operator: string;
  expectedValue: string;
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
  condition?: WorkflowCondition;
  thenSteps?: WorkflowStep[];
  elseSteps?: WorkflowStep[];
  childSteps?: WorkflowStep[];
  iterations?: number;
  maxIterations?: number;
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
  condition?: WorkflowCondition;
  actualValue?: any;
  conditionResult?: boolean;
  request?: any;
  response?: any;
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
}

export interface Environment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
  isActive: boolean;
}

export interface HistoryItem {
  id: string;
  requestId?: string;
  method: string;
  url: string;
  status: number;
  duration: string;
  timestamp: string;
  requestData: any;
  responseData: any;
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
}

export interface AppState {
  openRequests: string[]; // Request IDs
  activeRequestIndex: number;
  openWorkflows?: string[]; // Workflow IDs
  activeContentIndex?: number;
  activeEnvironmentId?: string;
  sidebarWidth: number;
  footerHeight: number;
  lastSavedAt: string;
}
