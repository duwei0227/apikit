// MCP 工具的输入 JSON Schema。工具定义在前端，启动服务时整体交给 Rust 端。

const keyValueList = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      key: { type: 'string' },
      value: { type: 'string' },
      enabled: { type: 'boolean', description: 'Defaults to true' },
    },
    required: ['key'],
  },
};

const body = {
  type: 'object',
  description: 'Request body. Content-Type is set automatically from the type unless a header overrides it.',
  properties: {
    type: { type: 'string', enum: ['none', 'json', 'xml', 'text', 'binary', 'form-data', 'x-www-form-urlencoded'] },
    raw: {
      description: 'Body text for json, xml and text. For json an object or array is also accepted and is formatted.',
    },
    formData: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
          type: { type: 'string', enum: ['text', 'file'] },
          filePath: { type: 'string', description: 'Absolute path of the file to upload when type is file' },
          enabled: { type: 'boolean' },
        },
        required: ['key'],
      },
    },
    urlencoded: keyValueList,
    filePath: { type: 'string', description: 'Absolute path of the file to send when type is binary' },
  },
  required: ['type'],
};

const auth = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['none', 'bearer', 'basic'] },
    token: { type: 'string' },
    username: { type: 'string' },
    password: { type: 'string' },
  },
  required: ['type'],
};

const operators = [
  'equals', 'notEquals', 'contains', 'notContains', 'exists', 'notExists',
  'greaterThan', 'lessThan', 'greaterThanOrEquals', 'lessThanOrEquals',
];

const tests = {
  type: 'object',
  description: 'Assertions run after the response arrives, and variables extracted from it.',
  properties: {
    statusCodeTests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          operator: { type: 'string', enum: operators },
          expectedValue: { type: 'string', description: 'For example "200" or "{{expectedStatus}}". {{variable}} placeholders are replaced; an undefined variable is compared as written.' },
          enabled: { type: 'boolean' },
          description: { type: 'string' },
        },
        required: ['expectedValue'],
      },
    },
    jsonFieldTests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          jsonPath: { type: 'string', description: 'For example "data.items[0].id"' },
          operator: { type: 'string', enum: operators },
          expectedValue: { type: 'string', description: 'For example "{{orderId}}" to compare with a variable extracted earlier. {{variable}} placeholders are replaced; an undefined variable is compared as written.' },
          enabled: { type: 'boolean' },
          description: { type: 'string' },
        },
        required: ['jsonPath'],
      },
    },
    globalVariables: {
      type: 'array',
      description: 'Save a value from the response as a global variable, usable later as {{variableName}}.',
      items: {
        type: 'object',
        properties: {
          variableName: { type: 'string' },
          valueType: { type: 'string', enum: ['jsonPath', 'customValue', 'header'], description: 'Default jsonPath. header reads the response header named in headerName.' },
          jsonPath: { type: 'string' },
          customValue: { type: 'string', description: 'May contain {{variable}} placeholders' },
          headerName: { type: 'string', description: 'Response header name for valueType header, case-insensitive' },
          enabled: { type: 'boolean' },
          description: { type: 'string' },
        },
        required: ['variableName'],
      },
    },
  },
};

const settings = {
  type: 'object',
  properties: {
    followRedirects: { type: 'boolean' },
    maxRedirectCount: { type: 'integer' },
    verifySsl: { type: 'boolean' },
    autoEncodeUrl: { type: 'boolean' },
    acceptEncoding: { type: 'boolean' },
  },
};

/** 请求的可编辑字段，create_request / update_request / 内联请求共用 */
export const requestFieldProperties = {
  name: { type: 'string', description: 'Request name.' },
  method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'], description: 'HTTP method; defaults to GET when creating or sending an inline request.' },
  url: { type: 'string', description: 'May contain {{variable}} placeholders, for example {{baseUrl}}/users/{{id}}' },
  params: { ...keyValueList, description: 'HTTP URL query parameters as an array of { key, value } items. This belongs inside a request definition; it is not a wrapper for tool arguments.' },
  headers: { ...keyValueList, description: 'HTTP request headers as an array of { key, value } items.' },
  body,
  auth,
  tests,
  settings,
};

const condition = {
  type: 'object',
  description: 'Condition for if/while/doWhile/until steps.',
  properties: {
    source: {
      type: 'string',
      enum: ['lastResponse', 'stepResponse', 'globalVariable', 'loopIndex'],
      description: 'stepResponse reads the response of the request step given in stepId; globalVariable reads the variable named in path; loopIndex is the 1-based number of the iteration that would run next: while checks it before each iteration, doWhile and until check it after each iteration, so it is 2 after the first iteration.',
    },
    stepId: { type: 'string', description: 'Id of a request step in this workflow, for source stepResponse' },
    field: {
      type: 'string',
      enum: ['status', 'body', 'header', 'jsonPath', 'value'],
      description: 'Response field to read. Use value for globalVariable and loopIndex.',
    },
    path: { type: 'string', description: 'Header name, JSON path, or global variable name' },
    operator: { type: 'string', enum: operators },
    expectedValue: { type: 'string', description: '{{variable}} placeholders are replaced before comparing.' },
  },
  required: ['source', 'field', 'operator'],
};

export const workflowStepsSchema = {
  type: 'array',
  items: { $ref: '#/$defs/step' },
};

export const workflowStepDefs = {
  step: {
    type: 'object',
    description: 'A request step (type request) or a control step. A request step must have exactly one of requestId or inlineRequest. Give steps your own ids when a condition needs to refer to them.',
    properties: {
      id: { type: 'string', description: 'Optional. Generated when missing.' },
      type: { type: 'string', enum: ['request', 'if', 'for', 'while', 'doWhile', 'until', 'setVariables'] },
      name: { type: 'string' },
      enabled: { type: 'boolean' },
      requestId: { type: 'string', description: 'request steps: id of a saved request to run' },
      requestOverrides: {
        type: 'object',
        description: 'request steps with requestId: fields that replace the saved request fields for this step only. Supported fields: method, url, params, headers, body, auth, tests and settings.',
        properties: {
          method: requestFieldProperties.method,
          url: requestFieldProperties.url,
          params: requestFieldProperties.params,
          headers: requestFieldProperties.headers,
          body: requestFieldProperties.body,
          auth: requestFieldProperties.auth,
          tests: requestFieldProperties.tests,
          settings: requestFieldProperties.settings,
        },
        additionalProperties: false,
      },
      inlineRequest: {
        type: 'object',
        description: 'request steps without requestId: the request to run, stored inside the workflow',
        properties: { ...requestFieldProperties },
        required: ['url'],
        additionalProperties: false,
      },
      condition,
      conditions: {
        type: 'array',
        items: condition,
        description: 'Several conditions for if/while/doWhile/until steps, combined by conditionMatch. Pass either condition or conditions.',
      },
      conditionMatch: {
        type: 'string',
        enum: ['all', 'any', 'cumulative'],
        description: 'How conditions are combined, default all. all: every condition is true at the same check. any: at least one is true. cumulative (until steps only): a condition counts once it was true at any check since the loop started, in any order; the loop stops when every condition has counted.',
      },
      thenSteps: { type: 'array', items: { $ref: '#/$defs/step' }, description: 'if steps: run when the condition is true' },
      elseSteps: { type: 'array', items: { $ref: '#/$defs/step' }, description: 'if steps: run when the condition is false' },
      childSteps: { type: 'array', items: { $ref: '#/$defs/step' }, description: 'loop steps: the loop body' },
      variables: {
        type: 'array',
        description: 'setVariables steps: global variables to set when the step runs, in order. Values may contain {{variable}} placeholders and {{$loopIndex}}.',
        items: {
          type: 'object',
          properties: { key: { type: 'string' }, value: { type: 'string' }, enabled: { type: 'boolean' } },
          required: ['key'],
        },
      },
      iterations: { type: 'integer', description: 'for steps: number of iterations' },
      maxIterations: { type: 'integer', description: 'while/doWhile/until steps: safety limit, default 30' },
      delayMs: { type: 'integer', description: 'Loop steps: milliseconds to wait between iterations (not before the first), default 0, at most 3600000. Use it when polling a job that takes time.' },
    },
    required: ['type'],
    allOf: [{
      if: { properties: { type: { const: 'request' } }, required: ['type'] },
      then: {
        oneOf: [
          { required: ['requestId'], not: { required: ['inlineRequest'] } },
          { required: ['inlineRequest'], not: { anyOf: [{ required: ['requestId'] }, { required: ['requestOverrides'] }] } },
        ],
      },
    }],
  },
};

export const CONDITION_OPERATORS = operators;
