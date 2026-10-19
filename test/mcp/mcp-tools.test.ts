import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { callMcpTool, MCP_HIDDEN_VALUE, MCP_TOOLS, mcpToolList, type McpToolContext } from '@/services/mcp/tools';
import { useCollectionsStore } from '@/stores/collections';
import { useConsoleLogsStore } from '@/stores/consoleLogs';
import { useEnvironmentsStore } from '@/stores/environments';
import { useRequestsStore } from '@/stores/requests';
import { useSequencesStore } from '@/stores/sequences';
import { useWorkflowsStore } from '@/stores/workflows';
import { httpbinInvocations, httpbinUrl } from '../helpers/httpbin';
import { mockStorageService } from '../helpers/mockStorage';

const makeContext = (overrides: Partial<McpToolContext> = {}): McpToolContext => ({
  onConsoleLog: vi.fn(),
  confirm: vi.fn(async () => true),
  revealSecrets: () => false,
  stageEdits: () => false,
  ...overrides,
});

const call = async (name: string, args: any = {}, context: McpToolContext = makeContext()) => {
  const result = await callMcpTool(name, args, context);
  const text = result.content[0].text;
  if (result.isError) return { error: text };
  return JSON.parse(text);
};

describe('MCP tools', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('MCP-001 describes every tool with a valid input schema', () => {
    const list = mcpToolList();
    expect(list.map(tool => tool.name)).toEqual(MCP_TOOLS.map(tool => tool.name));
    for (const tool of list) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.annotations.readOnlyHint).toBe(MCP_TOOLS.find(item => item.name === tool.name)!.kind === 'read');
    }
    const searchRequestsTool = list.find(tool => tool.name === 'search_requests')!;
    expect(searchRequestsTool.inputSchema.properties).toHaveProperty('query');
    expect(searchRequestsTool.inputSchema.properties).not.toHaveProperty('keyword');
    expect(searchRequestsTool.description).toContain('not keyword');
    expect(searchRequestsTool.description).toContain('Do not wrap arguments in a params object');
    const sendRequestTool = list.find(tool => tool.name === 'send_request')!;
    expect(sendRequestTool.description).toContain('pass exactly one as a direct tool argument');
    const sendRequestProperties = sendRequestTool.inputSchema.properties as Record<string, unknown>;
    expect(sendRequestProperties.request).toMatchObject({
      additionalProperties: false,
      required: ['url'],
    });
    expect(sendRequestTool.inputSchema.oneOf).toEqual([
      { required: ['requestId'] },
      { required: ['request'] },
    ]);
    const createWorkflowTool = MCP_TOOLS.find(tool => tool.name === 'create_workflow')!;
    const workflowDefinitions = createWorkflowTool.inputSchema.$defs as {
      step: {
        properties: {
          requestOverrides: { properties: Record<string, unknown>; additionalProperties: boolean };
        };
        allOf: Array<{ then: { oneOf: unknown[] } }>;
      };
    };
    expect(Object.keys(workflowDefinitions.step.properties.requestOverrides.properties))
      .toEqual(['method', 'url', 'params', 'headers', 'body', 'auth', 'tests', 'settings']);
    expect(workflowDefinitions.step.properties.requestOverrides.additionalProperties).toBe(false);
    expect(workflowDefinitions.step.allOf[0].then.oneOf).toHaveLength(2);
    expect(workflowDefinitions.step.allOf[0].then.oneOf[1]).toMatchObject({
      required: ['inlineRequest'],
      not: { anyOf: [{ required: ['requestId'] }, { required: ['requestOverrides'] }] },
    });
    const requestLogTool = list.find(tool => tool.name === 'get_request_log')!;
    const requestLogProperties = requestLogTool.inputSchema.properties as Record<string, {
      enum?: string[];
      minimum?: number;
      maximum?: number;
    }>;
    expect(requestLogProperties.bodyPart.enum).toEqual(['request', 'response', 'both']);
    expect(requestLogProperties.requestOffset.minimum).toBe(0);
    expect(requestLogProperties.responseOffset.minimum).toBe(0);
    expect(requestLogProperties.limit).toMatchObject({ minimum: 1, maximum: 20000 });
    const workflowLogTool = list.find(tool => tool.name === 'get_workflow_logs')!;
    const workflowLogProperties = workflowLogTool.inputSchema.properties as Record<string, {
      enum?: string[];
      minimum?: number;
      maximum?: number;
    }>;
    expect(workflowLogProperties.bodyPart.enum).toEqual(['request', 'response', 'both']);
    expect(workflowLogProperties.requestOffset.minimum).toBe(0);
    expect(workflowLogProperties.responseOffset.minimum).toBe(0);
    expect(workflowLogProperties.limit).toMatchObject({ minimum: 1, maximum: 20000 });
    expect(MCP_TOOLS.find(tool => tool.name === 'send_request')!.description).toContain('result includes logId');
    // 删除类工具标记为不可撤销
    const deleteTools = list.filter(tool => tool.name.startsWith('delete'));
    expect(deleteTools.map(tool => tool.name)).toEqual(['delete_request', 'delete_folder', 'delete_collection', 'delete_workflow']);
    expect(deleteTools.every(tool => tool.annotations.destructiveHint && !tool.annotations.readOnlyHint)).toBe(true);
    expect(list.filter(tool => tool.annotations.destructiveHint).length).toBe(4);
  });

  it('MCP-020 has a handler for every tool and rejects unknown tools', async () => {
    for (const tool of MCP_TOOLS) {
      const result = await callMcpTool(tool.name, {}, makeContext());
      expect(result.content[0].text).not.toContain('Unknown tool');
    }
    expect((await call('no_such_tool')).error).toBe('Unknown tool: no_such_tool');
  });

  it('MCP-002 creates collections, folders and requests and lists them in order', async () => {
    const collection = await call('create_collection', { name: 'Shop API', description: 'Orders' });
    const folder = await call('create_folder', { collectionId: collection.id, name: 'Orders' });
    const request = await call('create_request', {
      collectionId: collection.id,
      folderId: folder.id,
      name: 'Create order',
      method: 'post',
      url: '{{baseUrl}}/orders',
      headers: [{ key: 'X-Trace', value: 'mcp' }],
      body: { type: 'json', raw: { sku: 'A1', qty: 2 } },
      tests: { statusCodeTests: [{ expectedValue: '201' }], jsonFieldTests: [{ jsonPath: 'id', operator: 'exists' }] },
    });
    await call('create_request', { collectionId: collection.id, name: 'Health', url: '{{baseUrl}}/health' });

    expect(request.method).toBe('POST');
    expect(request.headers).toEqual([{ key: 'X-Trace', value: 'mcp', enabled: true }]);
    expect(JSON.parse(request.body.raw)).toEqual({ sku: 'A1', qty: 2 });
    expect(request.tests.statusCodeTests[0]).toMatchObject({ enabled: true, operator: 'equals', expectedValue: '201' });
    expect(request.tests.jsonFieldTests[0]).toMatchObject({ enabled: true, jsonPath: 'id', operator: 'exists' });

    const stored = mockStorageService.requests.get(request.id)!;
    expect(stored.collectionId).toBe(collection.id);
    expect(stored.folderId).toBe(folder.id);
    expect(stored.testsConfig).toEqual(stored.tests);

    const { collections } = await call('list_collections');
    expect(collections).toHaveLength(1);
    expect(collections[0].items).toEqual([
      {
        type: 'folder',
        id: folder.id,
        name: 'Orders',
        items: [{ type: 'request', id: request.id, name: 'Create order', method: 'POST', url: '{{baseUrl}}/orders' }],
      },
      expect.objectContaining({ type: 'request', name: 'Health', method: 'GET' }),
    ]);
  });

  it('MCP-003 reports clear validation errors', async () => {
    expect((await call('create_request', { collectionId: 'missing', name: 'x', url: '/' })).error)
      .toBe('Collection not found: missing');
    const collection = await call('create_collection', { name: 'C' });
    expect((await call('create_request', { collectionId: collection.id, name: 'x', url: '/', method: 'FETCH' })).error)
      .toMatch(/^method must be one of/);
    expect((await call('create_request', { collectionId: collection.id, name: 'x', url: '/', body: { type: 'yaml' } })).error)
      .toMatch(/^body.type must be one of/);
    expect((await call('create_folder', { collectionId: collection.id, name: 'x', parentFolderId: 'nope' })).error)
      .toBe('Folder not found: nope');
    expect((await call('no_such_tool')).error).toBe('Unknown tool: no_such_tool');
  });

  it('MCP-004 updates only the given fields, keeps hidden credentials and refuses unsaved edits', async () => {
    const collection = await call('create_collection', { name: 'C' });
    const created = await call('create_request', {
      collectionId: collection.id,
      name: 'Me',
      url: 'https://api.example.com/me',
      auth: { type: 'bearer', token: 'secret-token' },
      headers: [{ key: 'X-API-Key', value: 'abc123' }, { key: 'Accept', value: 'application/json' }],
    });
    expect(created.auth.token).toBe(MCP_HIDDEN_VALUE);
    expect(created.headers[0].value).toBe(MCP_HIDDEN_VALUE);
    expect(created.headers[1].value).toBe('application/json');

    // AI 把读到的占位符原样传回时保留原值
    const updated = await call('update_request', {
      requestId: created.id,
      name: 'Current user',
      auth: { type: 'bearer', token: MCP_HIDDEN_VALUE },
      headers: [{ key: 'x-api-key', value: MCP_HIDDEN_VALUE }],
    });
    expect(updated.name).toBe('Current user');
    expect(updated.url).toBe('https://api.example.com/me');
    const stored = mockStorageService.requests.get(created.id)!;
    expect(stored.auth.token).toBe('secret-token');
    expect(stored.headers).toEqual([{ key: 'x-api-key', value: 'abc123', enabled: true }]);

    const requests = useRequestsStore();
    expect(requests.externalRevisions[created.id]).toBe(1);
    const reference = useCollectionsStore().collections[0].requests[0];
    expect(reference.name).toBe('Current user');

    const revealed = await call('get_request', { requestId: created.id }, makeContext({ revealSecrets: () => true }));
    expect(revealed.auth.token).toBe('secret-token');
    expect(revealed.hasUnsavedEdits).toBe(false);

    await requests.setRequestDraft({ ...stored, name: 'Draft' });
    expect((await call('update_request', { requestId: created.id, url: 'x' })).error).toMatch(/unsaved edits/);
    expect((await call('get_request', { requestId: created.id })).hasUnsavedEdits).toBe(true);
  });

  it('MCP-005 hides environment values unless allowed', async () => {
    const environments = useEnvironmentsStore();
    const environment = await environments.createEnvironment('Dev');
    await environments.updateEnvironment(environment.id, {
      variables: [{ key: 'baseUrl', value: 'https://dev.example.com', enabled: true }, { key: 'empty', value: '', enabled: true }],
    });
    await environments.setActiveEnvironment(environment.id);

    const hidden = await call('list_environments');
    expect(hidden.valuesHidden).toBe(true);
    expect(hidden.activeEnvironmentId).toBe(environment.id);
    expect(hidden.environments[0].variables).toEqual([
      { key: 'baseUrl', value: MCP_HIDDEN_VALUE, enabled: true },
      { key: 'empty', value: '', enabled: true },
    ]);

    const shown = await call('list_environments', {}, makeContext({ revealSecrets: () => true }));
    expect(shown.environments[0].variables[0].value).toBe('https://dev.example.com');
  });

  it('MCP-006 creates and validates workflows', async () => {
    const collection = await call('create_collection', { name: 'C' });
    const login = await call('create_request', { collectionId: collection.id, name: 'Login', url: httpbinUrl('/post'), method: 'POST' });

    const invalid = await call('create_workflow', {
      name: 'Bad',
      steps: [
        { type: 'request', requestId: 'missing' },
        { type: 'request' },
        { type: 'if', condition: { source: 'stepResponse', stepId: 'nope', field: 'status', operator: 'equals', expectedValue: '200' } },
        { type: 'while', childSteps: [] },
        { type: 'for', iterations: 0 },
        { type: 'until', condition: { source: 'lastResponse', field: 'jsonPath', operator: 'equals' } },
        { type: 'loop' },
        { type: 'request', requestId: login.id, inlineRequest: { url: httpbinUrl('/get') } },
      ],
    });
    expect(invalid.error).toContain('steps[0].requestId: request not found: missing');
    expect(invalid.error).toContain('steps[1] needs either requestId or inlineRequest');
    expect(invalid.error).toContain('steps[2].condition.stepId must be the id of a request step in this workflow');
    expect(invalid.error).toContain('steps[3].condition or conditions is required for while steps');
    expect(invalid.error).toContain('steps[4].iterations must be an integer between 1 and 1000');
    expect(invalid.error).toContain('steps[5].condition.path is required for this source and field');
    expect(invalid.error).toContain('steps[6].type must be one of');
    expect(invalid.error).toContain('steps[7] must have exactly one of requestId or inlineRequest');
    expect(useWorkflowsStore().workflows).toHaveLength(0);

    const created = await call('create_workflow', {
      name: 'Order flow',
      steps: [
        { id: 'login', type: 'request', requestId: login.id, requestOverrides: { headers: [{ key: 'X-Step', value: '1' }] } },
        {
          type: 'if',
          condition: { source: 'stepResponse', stepId: 'login', field: 'status', operator: 'equals', expectedValue: 200 },
          thenSteps: [{ type: 'request', name: 'Inline get', inlineRequest: { url: httpbinUrl('/get') } }],
          elseSteps: [],
        },
        { type: 'for', iterations: 2, childSteps: [{ type: 'request', requestId: login.id }] },
      ],
    });
    expect(created.name).toBe('Order flow');
    expect(created.steps[0]).toMatchObject({ id: 'login', requestId: login.id, requestOverrides: { headers: [{ key: 'X-Step', value: '1', enabled: true }] } });
    expect(created.steps[1].condition).toMatchObject({ stepId: 'login', expectedValue: '200' });
    expect(created.steps[1].thenSteps[0].inlineRequest).toMatchObject({ name: 'Inline get', method: 'GET' });
    expect(created.steps[2]).toMatchObject({ type: 'for', iterations: 2 });
    expect(mockStorageService.workflows.has(created.id)).toBe(true);

    const listed = await call('list_workflows');
    expect(listed.workflows[0]).toMatchObject({ id: created.id, folderPath: [], stepCount: 5, hasUnsavedEdits: false });

    // 侧边栏文件夹中的 Workflow 返回文件夹的名称路径
    const workflowsStore = useWorkflowsStore();
    const ordersId = await workflowsStore.createFolder('Orders');
    await workflowsStore.moveWorkflowToFolder(created.id, await workflowsStore.createFolder('Smoke', ordersId));
    expect((await call('list_workflows')).workflows[0]).toMatchObject({ id: created.id, folderPath: ['Orders', 'Smoke'] });

    const renamed = await call('update_workflow', { workflowId: created.id, name: 'Renamed' });
    expect(renamed.name).toBe('Renamed');
    expect(renamed.steps).toHaveLength(3);

    const store = useWorkflowsStore();
    store.setWorkflowDraft({ ...store.workflows[0], name: 'Draft' });
    expect((await call('update_workflow', { workflowId: created.id, name: 'x' })).error).toMatch(/unsaved edits/);
  });

  it('MCP-007 sends requests only after confirmation', async () => {
    const collection = await call('create_collection', { name: 'C' });
    const request = await call('create_request', {
      collectionId: collection.id,
      name: 'Echo',
      url: httpbinUrl('/get'),
      params: [{ key: 'q', value: '{{term}}' }],
      tests: { statusCodeTests: [{ expectedValue: '201' }] },
    });

    const denied = makeContext({ confirm: vi.fn(async () => false) });
    expect((await call('send_request', { requestId: request.id }, denied)).error).toBe('The user declined this action');
    expect(httpbinInvocations).toHaveLength(0);

    // 变量由变量解析服务从全局变量中取值
    useEnvironmentsStore().setGlobalVariable('term', 'apikit');
    const confirm = vi.fn(async () => true);
    const loggedIds: (string | number)[] = [];
    const context = makeContext({
      confirm,
      onConsoleLog: log => {
        loggedIds.push(log.id);
        void useConsoleLogsStore().addLog(log);
      },
    });
    const result = await call('send_request', { requestId: request.id }, context);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tool: 'send_request', detail: `GET ${httpbinUrl('/get')}` }));
    expect(result.status).toBe(200);
    expect(result.logId).toBe(String(loggedIds[0]));
    expect(JSON.parse(result.body).args).toEqual({ q: 'apikit' });
    expect(result.tests.passed).toBe(false);
    expect(result.tests.failures[0]).toContain('Status code: expected 201, got 200');
    expect(loggedIds).toHaveLength(1);
    const completeLog = await call('get_request_log', { logId: result.logId, bodyPart: 'response' });
    expect(completeLog.logId).toBe(result.logId);
    expect(completeLog.response.body).toBe(result.body);

    const adHoc = await call('send_request', { request: { method: 'POST', url: httpbinUrl('/post'), body: { type: 'json', raw: { a: 1 } } } });
    expect(JSON.parse(adHoc.body).json).toEqual({ a: 1 });
    expect(adHoc.tests.passed).toBe(true);
    expect(adHoc.logId).toBeTruthy();

    const largeBody = 'z'.repeat(24000);
    const largeResponse = await call('send_request', {
      request: { method: 'POST', url: httpbinUrl('/post'), body: { type: 'text', raw: largeBody } },
    }, makeContext({
      onConsoleLog: log => { void useConsoleLogsStore().addLog(log); },
    }));
    expect(largeResponse.body).toContain('truncated');
    const largeLogPage = await call('get_request_log', { logId: largeResponse.logId, bodyPart: 'response' });
    expect(largeLogPage.response.bodyLength).toBeGreaterThan(20000);
    let fullResponseBody = largeLogPage.response.body;
    let responseOffset = largeLogPage.response.nextOffset;
    while (responseOffset < largeLogPage.response.bodyLength) {
      const page = await call('get_request_log', {
        logId: largeResponse.logId,
        bodyPart: 'response',
        responseOffset,
      });
      fullResponseBody += page.response.body;
      responseOffset = page.response.nextOffset;
    }
    expect(fullResponseBody).toContain(largeBody);
  });

  it('MCP-008 runs workflows and returns logs', async () => {
    const created = await call('create_workflow', {
      name: 'Run me',
      steps: [
        { id: 'first', type: 'request', inlineRequest: { url: httpbinUrl('/get'), tests: { statusCodeTests: [{ expectedValue: '200' }] } } },
        { type: 'request', inlineRequest: { url: httpbinUrl('/status/500'), tests: { statusCodeTests: [{ expectedValue: '200' }] } } },
      ],
    });

    const confirm = vi.fn(async () => true);
    const run = await call('run_workflow', { workflowId: created.id }, makeContext({ confirm }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tool: 'run_workflow', detail: 'Run me (2 steps)' }));
    expect(run.status).toBe('failed');
    expect(run.requestCount).toBe(2);
    expect(run.failedRequestCount).toBe(1);
    const failedLog = run.logs.find((log: any) => log.stepType === 'request' && log.status === 'failed');
    expect(failedLog.responseStatus).toBe(500);

    const detail = await call('get_workflow_logs', { workflowId: created.id, logId: failedLog.logId });
    expect(detail.response.status).toBe(500);
    expect(detail.tests.passed).toBe(false);

    const all = await call('get_workflow_logs', { workflowId: created.id });
    expect(all.logs.length).toBe(run.logs.length);

    const largeBody = 'x'.repeat(24000);
    const largeWorkflow = await call('create_workflow', {
      name: 'Large workflow log',
      steps: [{
        type: 'request',
        inlineRequest: {
          method: 'POST',
          url: httpbinUrl('/anything'),
          body: { type: 'text', raw: largeBody },
        },
      }],
    });
    const largeRun = await call('run_workflow', { workflowId: largeWorkflow.id }, makeContext({ confirm }));
    const largeStep = largeRun.logs.find((log: any) => log.stepType === 'request');
    const firstPage = await call('get_workflow_logs', { workflowId: largeWorkflow.id, logId: largeStep.logId });
    expect(firstPage.request.body).toBe(largeBody.slice(0, 8000));
    expect(firstPage.request.hasMore).toBe(true);
    expect(firstPage.response.hasMore).toBe(true);

    let requestText = firstPage.request.body;
    let requestOffset = firstPage.request.nextOffset;
    let responseText = firstPage.response.body;
    let responseOffset = firstPage.response.nextOffset;
    while (requestOffset < firstPage.request.bodyLength || responseOffset < firstPage.response.bodyLength) {
      const nextPage = await call('get_workflow_logs', {
        workflowId: largeWorkflow.id,
        logId: largeStep.logId,
        bodyPart: requestOffset < firstPage.request.bodyLength ? 'request' : 'response',
        requestOffset,
        responseOffset,
      });
      if (requestOffset < firstPage.request.bodyLength) {
        requestText += nextPage.request.body;
        requestOffset = nextPage.request.nextOffset;
      } else {
        responseText += nextPage.response.body;
        responseOffset = nextPage.response.nextOffset;
      }
    }
    expect(requestText).toBe(largeBody);
    expect(responseText).toContain(largeBody);
  });

  it('MCP-009 lists and reads request logs from the console', async () => {
    const consoleLogs = useConsoleLogsStore();
    const now = Date.now();
    const log = (id: number, method: string, url: string, status: number, offset: number) => ({
      id,
      startTime: now - offset - 50,
      endTime: now - offset,
      method,
      url,
      requestHeaders: { Authorization: 'Bearer secret', Accept: 'application/json' },
      requestBody: method === 'POST' ? '{"a":1}' : null,
      status,
      statusText: '',
      duration: '50ms',
      responseHeaders: { 'set-cookie': 'sid=abc', 'content-type': 'application/json' },
      responseBody: `${'x'.repeat(7999)}😀${'x'.repeat(16000)}`,
    });
    await consoleLogs.addLog(log(1, 'GET', 'https://api.example.com/users', 200, 3000) as any);
    await consoleLogs.addLog(log(2, 'POST', 'https://api.example.com/orders', 500, 2000) as any);
    await consoleLogs.addLog(log(3, 'GET', 'https://api.example.com/orders/7', 404, 1000) as any);

    const all = await call('list_request_logs');
    expect(all.totalMatched).toBe(3);
    expect(all.logs.map((item: any) => item.logId)).toEqual(['3', '2', '1']);
    expect(all.logs[0]).toMatchObject({ method: 'GET', status: 404, duration: '50ms' });

    expect((await call('list_request_logs', { status: '4xx' })).logs.map((item: any) => item.logId)).toEqual(['3']);
    expect((await call('list_request_logs', { status: '500' })).logs.map((item: any) => item.logId)).toEqual(['2']);
    expect((await call('list_request_logs', { urlContains: 'ORDERS', method: 'get' })).logs.map((item: any) => item.logId)).toEqual(['3']);
    expect((await call('list_request_logs', { limit: 1 })).logs).toHaveLength(1);
    expect((await call('list_request_logs', { status: 'bad' })).error).toMatch(/^status must be/);

    const detail = await call('get_request_log', { logId: '2' });
    expect(detail.request.headers).toEqual({ Authorization: MCP_HIDDEN_VALUE, Accept: 'application/json' });
    expect(detail.request.body).toBe('{"a":1}');
    expect(detail.response.headers['set-cookie']).toBe(MCP_HIDDEN_VALUE);
    expect(detail.response.body).toBe('x'.repeat(7999));
    expect(detail.response).toMatchObject({
      bodyLength: 24001,
      bodyOffset: 0,
      nextOffset: 7999,
      hasMore: true,
    });

    let offset = detail.response.nextOffset;
    let fullResponseBody = detail.response.body;
    while (true) {
      const page = await call('get_request_log', {
        logId: '2',
        bodyPart: 'response',
        responseOffset: offset,
      });
      fullResponseBody += page.response.body;
      if (!page.response.hasMore) break;
      offset = page.response.nextOffset;
    }
    expect(fullResponseBody).toBe(`${'x'.repeat(7999)}😀${'x'.repeat(16000)}`);
    expect((await call('get_request_log', { logId: '2', bodyPart: 'request' })).response).not.toHaveProperty('body');
    expect((await call('get_request_log', { logId: '2', bodyPart: 'response', responseOffset: 24002 })).error)
      .toMatch(/^offset must not exceed the body length/);

    const revealed = await call('get_request_log', { logId: '2' }, makeContext({ revealSecrets: () => true }));
    expect(revealed.request.headers.Authorization).toBe('Bearer secret');
    expect((await call('get_request_log', { logId: '99' })).error).toBe('Request log not found: 99');
  });

  it('MCP-010 sends form-data files with their file name', async () => {
    const collection = await call('create_collection', { name: 'C' });
    const request = await call('create_request', {
      collectionId: collection.id,
      name: 'Upload',
      method: 'POST',
      url: httpbinUrl('/post'),
      body: { type: 'form-data', formData: [{ key: 'file', type: 'file', filePath: '/tmp/data/report.csv' }] },
    });
    expect(request.body.formData[0]).toMatchObject({ value: 'report.csv', filePath: '/tmp/data/report.csv' });

    await call('send_request', { requestId: request.id });
    expect(httpbinInvocations[0].multipart.fields[0]).toMatchObject({ filename: 'report.csv', filePath: '/tmp/data/report.csv' });

    // 旧数据里文件项的 value 为空时，按路径取文件名
    const store = useRequestsStore();
    const saved = (await store.loadSavedRequest(request.id))!;
    saved.body.formData![0].value = '';
    await store.saveRequest(saved, true);
    await call('send_request', { requestId: request.id });
    expect(httpbinInvocations[1].multipart.fields[0].filename).toBe('report.csv');
  });

  it('MCP-011 rejects unknown test operators and empty urls', async () => {
    const collection = await call('create_collection', { name: 'C' });
    const base = { collectionId: collection.id, name: 'x', url: httpbinUrl('/get') };
    expect((await call('create_request', { ...base, tests: { statusCodeTests: [{ operator: 'matches', expectedValue: '200' }] } })).error)
      .toMatch(/^tests.statusCodeTests\[0\].operator must be one of/);
    expect((await call('create_request', { ...base, tests: { jsonFieldTests: [{ jsonPath: 'a' }, { jsonPath: 'b', operator: 'regex' }] } })).error)
      .toMatch(/^tests.jsonFieldTests\[1\].operator must be one of/);
    expect((await call('create_request', { ...base, tests: { globalVariables: [{ variableName: 'v', valueType: 'cookie' }] } })).error)
      .toBe('tests.globalVariables[0].valueType must be jsonPath, customValue or header');

    const request = await call('create_request', base);
    expect((await call('update_request', { requestId: request.id, url: '' })).error).toBe('url is required');
    expect((await call('update_request', { requestId: request.id, url: '   ' })).error).toBe('url is required');
    expect((await call('get_request', { requestId: request.id })).url).toBe(httpbinUrl('/get'));

    expect((await call('create_workflow', { name: 'W', steps: [{ type: 'request', inlineRequest: { method: 'GET' } }] })).error)
      .toContain('steps[0].inlineRequest: url is required');
    expect((await call('create_workflow', {
      name: 'W',
      steps: [{ type: 'request', requestId: request.id, requestOverrides: { url: '' } }],
    })).error).toContain('steps[0].requestOverrides: url is required');

    const confirm = vi.fn(async () => true);
    expect((await call('send_request', { request: { method: 'GET' } }, makeContext({ confirm }))).error).toBe('request.url is required');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('MCP-012 logs requests that got no response', async () => {
    const consoleLogs = useConsoleLogsStore();
    const context = makeContext({ onConsoleLog: (log: any) => { void consoleLogs.addLog(log); } });
    vi.mocked(invoke).mockRejectedValueOnce('error sending request: dns error');

    const failed = await call('send_request', { request: { url: 'https://no-such-host.invalid/x' } }, context);
    expect(failed.error).toContain('dns error');

    const logs = await call('list_request_logs', { status: '0' });
    expect(logs.totalMatched).toBe(1);
    expect(logs.logs[0]).toMatchObject({ method: 'GET', url: 'https://no-such-host.invalid/x', status: 0, statusText: 'Error' });
    const detail = await call('get_request_log', { logId: logs.logs[0].logId });
    expect(detail.response.body).toBe('Error: error sending request: dns error');

    // 用户取消的请求不记录
    vi.mocked(invoke).mockRejectedValueOnce('Request cancelled');
    await call('send_request', { request: { url: httpbinUrl('/get') } }, context);
    expect((await call('list_request_logs', { status: '0' })).totalMatched).toBe(1);
  });

  it('MCP-013 lists variables that were not defined and sent as written', async () => {
    const consoleLogs = useConsoleLogsStore();
    useEnvironmentsStore().setGlobalVariable('term', 'apikit');
    const context = makeContext({
      onConsoleLog: (log: any) => { void consoleLogs.addLog(log); },
    });
    const sent = await call('send_request', {
      request: {
        url: httpbinUrl('/anything/{{missingPath}}'),
        params: [{ key: 'q', value: '{{term}}' }],
        headers: [{ key: 'X-Trace', value: '{{ missingHeader }}' }],
        body: { type: 'json', raw: { id: '{{missingPath}}' } },
        // 断言的期望值按字面比较，不算未解析变量
        tests: { jsonFieldTests: [{ jsonPath: 'args.q', operator: 'notEquals', expectedValue: '{{literal}}' }] },
      },
    }, context);
    expect(sent.status).toBe(200);
    expect(sent.tests.passed).toBe(true);
    expect(sent.unresolvedVariables).toEqual(['missingPath', 'missingHeader']);

    const logs = await call('list_request_logs');
    expect((await call('get_request_log', { logId: logs.logs[0].logId })).unresolvedVariables).toEqual(['missingPath', 'missingHeader']);

    const resolved = await call('send_request', { request: { url: httpbinUrl('/get'), params: [{ key: 'q', value: '{{term}}' }] } }, context);
    expect(resolved).not.toHaveProperty('unresolvedVariables');

    const workflow = await call('create_workflow', {
      name: 'W',
      steps: [{ type: 'request', id: 's1', inlineRequest: { url: httpbinUrl('/anything/{{missingInWorkflow}}') } }],
    });
    const run = await call('run_workflow', { workflowId: workflow.id });
    const stepLog = run.logs.find((log: any) => log.stepId === 's1');
    expect((await call('get_workflow_logs', { workflowId: workflow.id, logId: stepLog.logId })).unresolvedVariables)
      .toEqual(['missingInWorkflow']);
  });

  it('MCP-014 rejects ambiguous send_request and empty update_request calls', async () => {
    const collection = await call('create_collection', { name: 'C' });
    const request = await call('create_request', { collectionId: collection.id, name: 'x', url: httpbinUrl('/get') });

    const confirm = vi.fn(async () => true);
    expect((await call('send_request', { requestId: request.id, request: { url: httpbinUrl('/get') } }, makeContext({ confirm }))).error)
      .toBe('Pass either requestId or request, not both');
    expect(confirm).not.toHaveBeenCalled();
    expect(httpbinInvocations).toHaveLength(0);

    expect((await call('update_request', { requestId: request.id })).error).toBe('Pass at least one field to update');
    expect((await call('update_request', { requestId: request.id, unknownField: 1 })).error).toBe('Pass at least one field to update');
    expect((await call('update_request', { requestId: request.id, name: 'y' })).name).toBe('y');
  });

  it('MCP-015 does not count disabled request steps as requests', async () => {
    const workflow = await call('create_workflow', {
      name: 'W',
      steps: [
        { type: 'request', inlineRequest: { url: httpbinUrl('/get') } },
        { type: 'request', enabled: false, inlineRequest: { url: httpbinUrl('/status/500') } },
      ],
    });
    const run = await call('run_workflow', { workflowId: workflow.id });
    expect(run).toMatchObject({ status: 'completed', requestCount: 1, passedRequestCount: 1, failedRequestCount: 0 });
    expect(run.logs.some((log: any) => log.status === 'skipped')).toBe(true);
  });

  it('MCP-016 creates and updates environments and global variables', async () => {
    const reveal = makeContext({ revealSecrets: () => true });
    const created = await call('create_environment', {
      name: ' Dev ',
      variables: [{ key: 'baseUrl', value: 'https://dev.example.com' }, { key: 'token', value: 'abc', description: 'API token' }],
    });
    expect(created).toMatchObject({ name: 'Dev', isActive: false });
    expect(created.variables).toEqual([
      { key: 'baseUrl', value: MCP_HIDDEN_VALUE, enabled: true },
      { key: 'token', value: MCP_HIDDEN_VALUE, enabled: true, description: 'API token' },
    ]);
    expect(mockStorageService.environments[0].variables[0].value).toBe('https://dev.example.com');

    const updated = await call('update_environment', {
      environmentId: created.id,
      name: 'Development',
      variables: [
        { key: 'baseUrl', value: 'https://dev2.example.com' },
        { key: 'token', value: MCP_HIDDEN_VALUE, enabled: false },
        { key: 'region', value: 'eu' },
      ],
    }, reveal);
    expect(updated.name).toBe('Development');
    expect(updated.variables).toEqual([
      { key: 'baseUrl', value: 'https://dev2.example.com', enabled: true },
      { key: 'token', value: 'abc', enabled: false, description: 'API token' },
      { key: 'region', value: 'eu', enabled: true },
    ]);

    const removed = await call('update_environment', { environmentId: created.id, removeVariables: ['region'] }, reveal);
    expect(removed.variables.map((item: any) => item.key)).toEqual(['baseUrl', 'token']);

    expect((await call('create_environment', { name: 'Development' })).error).toBe('An environment named "Development" already exists');
    expect((await call('create_environment', { name: ' ' })).error).toBe('name is required');
    expect((await call('update_environment', { environmentId: 'nope', name: 'x' })).error).toBe('Environment not found: nope');
    expect((await call('update_environment', { environmentId: created.id })).error).toBe('Pass name, variables and/or removeVariables');
    expect((await call('update_environment', { environmentId: created.id, removeVariables: ['ghost'] })).error).toBe('Variable not found: ghost');
    expect((await call('update_environment', { environmentId: created.id, variables: [{ key: 'a' }, { key: 'a' }] })).error)
      .toBe('variables[1].key "a" is used more than once');
    expect((await call('update_environment', { environmentId: created.id, variables: [{ key: 'fresh', value: MCP_HIDDEN_VALUE }] })).error)
      .toBe('variables[0].value: "fresh" has no current value to keep');
    expect((await call('update_environment', { environmentId: created.id, variables: [{ value: 'x' }] })).error).toBe('variables[0].key is required');
    // 同名改回自己不算重名
    expect((await call('update_environment', { environmentId: created.id, name: 'Development' })).name).toBe('Development');

    const globals = await call('set_global_variables', { variables: [{ key: 'g1', value: '1' }, { key: 'g2', value: '2' }] }, reveal);
    expect(globals.globalVariables).toEqual([{ key: 'g1', value: '1', enabled: true }, { key: 'g2', value: '2', enabled: true }]);
    const changed = await call('set_global_variables', { variables: [{ key: 'g1', value: 'one' }], removeVariables: ['g2'] }, reveal);
    expect(changed.globalVariables).toEqual([{ key: 'g1', value: 'one', enabled: true }]);
    expect(mockStorageService.globalVariables).toMatchObject([{ key: 'g1', value: 'one' }]);
    expect((await call('set_global_variables')).error).toBe('Pass variables and/or removeVariables');
  });

  it('MCP-017 switches the active environment only after confirmation', async () => {
    const dev = await call('create_environment', { name: 'Dev', variables: [{ key: 'path', value: 'dev' }] });
    const store = useEnvironmentsStore();

    const denied = makeContext({ confirm: vi.fn(async () => false) });
    expect((await call('set_active_environment', { environmentId: dev.id }, denied)).error).toBe('The user declined this action');
    expect(store.activeEnvironmentId).toBeNull();

    const confirm = vi.fn(async () => true);
    const context = makeContext({ confirm });
    expect(await call('set_active_environment', { environmentId: dev.id }, context)).toEqual({ activeEnvironmentId: dev.id, name: 'Dev' });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tool: 'set_active_environment', detail: 'Dev' }));
    expect(store.activeEnvironmentId).toBe(dev.id);

    // 已经是激活环境时不再询问
    await call('set_active_environment', { environmentId: dev.id }, context);
    expect(confirm).toHaveBeenCalledTimes(1);

    const sent = await call('send_request', { request: { url: httpbinUrl('/anything/{{path}}') } });
    expect(JSON.parse(sent.body).url).toBe(httpbinUrl('/anything/dev'));

    await call('set_active_environment', { environmentId: null }, context);
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ detail: 'No environment' }));
    expect(store.activeEnvironmentId).toBeNull();

    expect((await call('set_active_environment', {})).error).toBe('environmentId must be an environment id or null');
    expect((await call('set_active_environment', { environmentId: 'nope' })).error).toBe('Environment not found: nope');

    const declinedCreate = await call('create_environment', { name: 'Prod', activate: true }, denied);
    expect(declinedCreate.error).toBe('The user declined this action');
    expect(store.environments.map(item => item.name)).toEqual(['Dev']);
    const prod = await call('create_environment', { name: 'Prod', activate: true }, context);
    expect(prod.isActive).toBe(true);
    expect(store.activeEnvironmentId).toBe(prod.id);

    const tool = mcpToolList().find(item => item.name === 'set_active_environment')!;
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: false });
  });

  it('MCP-018 renames collections and folders', async () => {
    const collection = await call('create_collection', { name: 'Old', description: 'first' });
    const folder = await call('create_folder', { collectionId: collection.id, name: 'Folder' });
    const nested = await call('create_folder', { collectionId: collection.id, name: 'Nested', parentFolderId: folder.id });

    expect(await call('update_collection', { collectionId: collection.id, name: 'New' })).toEqual({ id: collection.id, name: 'New', description: 'first' });
    expect((await call('update_collection', { collectionId: collection.id, description: 'second' })).description).toBe('second');
    expect(await call('update_folder', { collectionId: collection.id, folderId: nested.id, name: 'Renamed' }))
      .toEqual({ id: nested.id, name: 'Renamed', collectionId: collection.id });

    const listed = await call('list_collections');
    expect(listed.collections[0].name).toBe('New');
    expect(JSON.stringify(listed)).toContain('"Renamed"');
    expect(mockStorageService.collections.get(collection.id)!.name).toBe('New');

    expect((await call('update_collection', { collectionId: collection.id })).error).toBe('Pass name and/or description');
    expect((await call('update_collection', { collectionId: collection.id, name: ' ' })).error).toBe('name is required');
    expect((await call('update_collection', { collectionId: 'nope', name: 'x' })).error).toBe('Collection not found: nope');
    expect((await call('update_folder', { collectionId: collection.id, folderId: 'nope', name: 'x' })).error).toBe('Folder not found: nope');
    expect((await call('update_folder', { collectionId: collection.id, folderId: folder.id, name: '' })).error).toBe('name is required');
  });

  it('MCP-019 returns the merged answer of a streaming response', async () => {
    const consoleLogs = useConsoleLogsStore();
    const context = makeContext({ onConsoleLog: (log: any) => { void consoleLogs.addLog(log); } });
    const sent = await call('send_request', {
      request: {
        url: httpbinUrl('/sse-chat'),
        tests: {
          jsonFieldTests: [
            { jsonPath: 'text', operator: 'equals', expectedValue: 'Hello, world' },
            { jsonPath: 'finishReason', operator: 'equals', expectedValue: 'stop' },
            { jsonPath: 'usage.completion_tokens', operator: 'equals', expectedValue: '3' },
            { jsonPath: 'events[1].choices[0].delta.content', operator: 'equals', expectedValue: 'Hello' },
            { jsonPath: 'eventCount', operator: 'greaterThan', expectedValue: '5' },
          ],
          globalVariables: [{ variableName: 'answer', valueType: 'jsonPath', jsonPath: 'text' }],
        },
      },
    }, context);

    expect(sent.status).toBe(200);
    expect(sent.body).toContain('data: [DONE]');
    expect(sent.stream).toEqual({
      text: 'Hello, world',
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 3 },
      eventCount: 6,
    });
    expect(sent.tests).toMatchObject({ passed: true, failures: [] });
    expect(sent.tests.extractedVariables[0]).toMatchObject({ variableName: 'answer', status: 'set' });
    expect(httpbinInvocations[0].streamEvents).toBeUndefined();

    // 普通响应不带 stream 字段
    expect(await call('send_request', { request: { url: httpbinUrl('/get') } })).not.toHaveProperty('stream');

    const workflow = await call('create_workflow', {
      name: 'W',
      steps: [
        { type: 'request', id: 'chat', inlineRequest: { url: httpbinUrl('/sse-chat') } },
        {
          type: 'if',
          condition: { source: 'stepResponse', stepId: 'chat', field: 'jsonPath', path: 'text', operator: 'contains', expectedValue: 'world' },
          thenSteps: [{ type: 'request', inlineRequest: { url: httpbinUrl('/get') } }],
        },
      ],
    });
    const run = await call('run_workflow', { workflowId: workflow.id });
    expect(run).toMatchObject({ status: 'completed', requestCount: 2, passedRequestCount: 2 });
  });

  it('MCP-021 keeps request and workflow edits as unsaved edits when staging is on', async () => {
    const stage = makeContext({ stageEdits: () => true });
    const collection = await call('create_collection', { name: 'C' });
    const created = await call('create_request', { collectionId: collection.id, name: 'Me', url: 'https://api.example.com/me' }, stage);
    // 新建的请求仍直接保存
    expect(mockStorageService.requests.has(created.id)).toBe(true);

    const requests = useRequestsStore();
    const updated = await call('update_request', { requestId: created.id, name: 'Current user' }, stage);
    expect(updated).toMatchObject({ name: 'Current user', unsavedEdits: true });
    expect(mockStorageService.requests.get(created.id)!.name).toBe('Me');
    expect(mockStorageService.requestDrafts.get(created.id)!.name).toBe('Current user');
    expect(useCollectionsStore().collections[0].requests[0].name).toBe('Me');
    expect(requests.externalRevisions[created.id]).toBe(1);

    // 在已有的未保存修改上继续修改
    await requests.setRequestDraft({ ...requests.getRequestDraft(created.id)!, url: 'https://api.example.com/user' });
    const again = await call('update_request', { requestId: created.id, method: 'POST' }, stage);
    expect(again).toMatchObject({ name: 'Current user', method: 'POST', url: 'https://api.example.com/user' });
    expect((await call('get_request', { requestId: created.id }, stage)).hasUnsavedEdits).toBe(true);

    const workflow = await call('create_workflow', { name: 'Flow', steps: [{ type: 'request', requestId: created.id }] }, stage);
    const store = useWorkflowsStore();
    const renamed = await call('update_workflow', { workflowId: workflow.id, name: 'Renamed' }, stage);
    expect(renamed).toMatchObject({ name: 'Renamed', unsavedEdits: true });
    expect(store.workflows[0].name).toBe('Flow');
    expect(store.getWorkflowDraft(workflow.id)!.name).toBe('Renamed');
    expect(store.externalRevisions[workflow.id]).toBe(1);
    const stepsChanged = await call('update_workflow', { workflowId: workflow.id, steps: [] }, stage);
    expect(stepsChanged).toMatchObject({ name: 'Renamed', steps: [] });
    expect(await call('get_workflow', { workflowId: workflow.id })).toMatchObject({ name: 'Renamed', hasUnsavedEdits: true });
  });

  it('MCP-022 lists built-in variables with usage and example values', async () => {
    const result = await call('list_builtin_variables');
    const byName = Object.fromEntries(result.variables.map((variable: any) => [variable.name, variable]));
    expect(Object.keys(byName)).toEqual(expect.arrayContaining(['$timestamp', '$guid', '$randomInt', '$date', '$sequence']));

    expect(byName.$timestamp.description).toBe('Current timestamp in milliseconds');
    expect(byName.$timestamp.exampleValue).toMatch(/^\d{13}$/);
    expect(byName.$timestamp.params).toBeUndefined();
    expect(byName.$guid.exampleValue).toMatch(/^[0-9a-f-]{36}$/);
    expect(byName.$randomInt.examples).toContainEqual({ syntax: '{{$randomInt(1, 100)}}', description: 'Random between 1 and 100' });
    expect(byName.$randomInt.params[0]).toMatchObject({ name: 'start / min', default: '0' });
    expect(byName.$date.exampleValue).toMatch(/^\d{8}$/);
    expect(byName.$loopIndex).toMatchObject({ exampleValue: '1', workflowLoopsOnly: true });

    // 示例值是序列的下一个值，列出时不推进序列
    const sequences = useSequencesStore();
    expect(byName.$sequence.exampleValue).toBe('1');
    expect(sequences.getSequenceSnapshot('default')).toBeUndefined();
  });

  it('MCP-023 creates loops with several conditions and validates the match mode', async () => {
    const loopIndex = (value: number) => ({ source: 'loopIndex', field: 'value', operator: 'equals', expectedValue: value });
    const invalid = await call('create_workflow', {
      name: 'Bad',
      steps: [
        { type: 'while', conditions: [loopIndex(1)], conditionMatch: 'cumulative', childSteps: [] },
        { type: 'until', condition: loopIndex(1), conditions: [loopIndex(2)], childSteps: [] },
        { type: 'until', conditions: [], childSteps: [] },
      ],
    });
    expect(invalid.error).toContain('steps[0].conditionMatch must be one of all, any for while steps');
    expect(invalid.error).toContain('steps[1]: pass either condition or conditions, not both');
    expect(invalid.error).toContain('steps[2].conditions must be a non-empty array');

    const created = await call('create_workflow', {
      name: 'Wait for both',
      steps: [
        { type: 'until', conditions: [loopIndex(5), loopIndex(3)], conditionMatch: 'cumulative', maxIterations: 10, childSteps: [] },
        { type: 'if', condition: loopIndex(1), thenSteps: [], elseSteps: [] },
      ],
    });
    expect(created.steps[0]).toMatchObject({ conditionMatch: 'cumulative', conditions: [{ expectedValue: '5' }, { expectedValue: '3' }] });
    expect(created.steps[0].condition).toBeUndefined();
    expect(created.steps[1].condition).toMatchObject({ expectedValue: '1' });
    expect(created.steps[1].conditions).toBeUndefined();

    await call('run_workflow', { workflowId: created.id });
    const logs = await call('get_workflow_logs', { workflowId: created.id });
    const loop = logs.logs.find((entry: any) => entry.stepType === 'until' && entry.iteration === undefined);
    expect(loop).toMatchObject({
      status: 'completed',
      conditionResult: true,
      conditionMatch: 'cumulative',
      conditionChecks: [{ passed: true, metAtIteration: 4 }, { passed: true, metAtIteration: 2 }],
    });
  });

  it('MCP-024 searches saved requests by name, URL, method and collection', async () => {
    const shop = await call('create_collection', { name: 'Shop API' });
    const folder = await call('create_folder', { collectionId: shop.id, name: 'Orders' });
    const create = await call('create_request', { collectionId: shop.id, folderId: folder.id, name: 'Create order', method: 'POST', url: '{{baseUrl}}/orders' });
    const list = await call('create_request', { collectionId: shop.id, folderId: folder.id, name: 'List', url: '{{baseUrl}}/orders' });
    const admin = await call('create_collection', { name: 'Admin' });
    const report = await call('create_request', { collectionId: admin.id, name: 'Order report', url: '{{baseUrl}}/reports' });

    const byText = await call('search_requests', { query: 'ORDER' });
    expect(byText.total).toBe(3);
    expect(byText.requests).toEqual([
      { requestId: create.id, name: 'Create order', method: 'POST', url: '{{baseUrl}}/orders', collectionId: shop.id, folderId: folder.id, path: 'Shop API / Orders' },
      expect.objectContaining({ requestId: list.id, method: 'GET' }),
      { requestId: report.id, name: 'Order report', method: 'GET', url: '{{baseUrl}}/reports', collectionId: admin.id, path: 'Admin' },
    ]);

    expect((await call('search_requests', { query: 'orders', method: 'post' })).requests.map((r: any) => r.requestId)).toEqual([create.id]);
    expect((await call('search_requests', { collectionId: admin.id })).requests.map((r: any) => r.requestId)).toEqual([report.id]);
    expect((await call('search_requests', { query: '/orders' })).requests.map((r: any) => r.requestId)).toEqual([create.id, list.id]);
    const limited = await call('search_requests', { query: 'order', limit: 1 });
    expect(limited).toMatchObject({ total: 3, requests: [{ requestId: create.id }] });

    expect((await call('search_requests', {})).error).toBe('Pass query, method and/or collectionId');
    expect((await call('search_requests', { method: 'FETCH' })).error).toContain('method must be one of');
    expect((await call('search_requests', { query: 'x', limit: 0 })).error).toContain('limit must be an integer between 1 and 100');
    expect((await call('search_requests', { collectionId: 'missing' })).error).toBe('Collection not found: missing');
  });

  it('MCP-025 sets and validates the wait between loop iterations', async () => {
    const invalid = await call('create_workflow', { name: 'Bad', steps: [
      { type: 'for', iterations: 1, delayMs: -1, childSteps: [] },
      { type: 'until', condition: { source: 'loopIndex', field: 'value', operator: 'equals', expectedValue: '2' }, maxIterations: 1001, childSteps: [] },
    ] });
    expect(invalid.error).toContain('steps[0].delayMs must be an integer between 0 and 3600000');
    expect(invalid.error).toContain('steps[1].maxIterations must be an integer between 1 and 1000');

    const created = await call('create_workflow', { name: 'Paced', steps: [
      { type: 'for', iterations: 2, delayMs: 1500, childSteps: [] },
      { type: 'for', iterations: 1, delayMs: 0, childSteps: [] },
    ] });
    expect(created.steps[0].delayMs).toBe(1500);
    expect(created.steps[1]).not.toHaveProperty('delayMs');
  });

  it('MCP-026 extracts variables from response headers', async () => {
    const collection = await call('create_collection', { name: 'C' });
    const missingName = await call('create_request', { collectionId: collection.id, name: 'x', url: httpbinUrl('/get'),
      tests: { globalVariables: [{ variableName: 'ctype', valueType: 'header' }] } });
    expect(missingName.error).toBe('tests.globalVariables[0].headerName is required for valueType header');

    const request = await call('create_request', { collectionId: collection.id, name: 'Session', url: httpbinUrl('/response-headers?X-Session=sess-9'),
      tests: { globalVariables: [{ variableName: 'session', valueType: 'header', headerName: 'x-session' }] } });
    expect(request.tests.globalVariables[0]).toMatchObject({ valueType: 'header', headerName: 'x-session' });
    const sent = await call('send_request', { requestId: request.id });
    expect(sent.tests.extractedVariables[0]).toMatchObject({ variableName: 'session', status: 'set' });
    expect(useEnvironmentsStore().globalVariables.find(variable => variable.key === 'session')?.value).toBe('sess-9');
  });

  it('MCP-027 names request steps after their request when no name is given', async () => {
    const collection = await call('create_collection', { name: 'C' });
    const login = await call('create_request', { collectionId: collection.id, name: 'Login', url: httpbinUrl('/get') });
    const created = await call('create_workflow', { name: 'Named', steps: [
      { type: 'request', requestId: login.id },
      { type: 'request', name: 'Sign in again', requestId: login.id },
      { type: 'request', inlineRequest: { name: 'Health check', url: httpbinUrl('/get') } },
      { type: 'request', inlineRequest: { url: httpbinUrl('/get') } },
    ] });
    expect(created.steps.map((step: any) => step.name)).toEqual(['Login', 'Sign in again', 'Health check', 'Request Step']);
  });

  it('MCP-028 creates set variables steps', async () => {
    const invalid = await call('create_workflow', { name: 'Bad', steps: [
      { type: 'setVariables', variables: [] },
      { type: 'setVariables', variables: [{ value: '1' }] },
    ] });
    expect(invalid.error).toContain('steps[0].variables must be a non-empty array of { key, value }');
    expect(invalid.error).toContain('steps[1].variables[0].key is required');

    const created = await call('create_workflow', { name: 'Reset', steps: [
      { type: 'setVariables', variables: [{ key: ' page ', value: 1 }, { key: 'runId', value: '{{$guid}}', enabled: false }] },
    ] });
    expect(created.steps[0]).toEqual({
      id: expect.any(String), type: 'setVariables', name: 'Set Variables', enabled: true,
      variables: [{ key: 'page', value: '1', enabled: true }, { key: 'runId', value: '{{$guid}}', enabled: false }],
    });

    await call('run_workflow', { workflowId: created.id });
    expect(useEnvironmentsStore().globalVariables.find(variable => variable.key === 'page')?.value).toBe('1');
  });

  it('MCP-029 deletes requests, folders, collections and workflows only after the user approves', async () => {
    const shop = await call('create_collection', { name: 'Shop' });
    const orders = await call('create_folder', { collectionId: shop.id, name: 'Orders' });
    const archive = await call('create_folder', { collectionId: shop.id, parentFolderId: orders.id, name: 'Archive' });
    const login = await call('create_request', { collectionId: shop.id, name: 'Login', url: httpbinUrl('/get') });
    const create = await call('create_request', { collectionId: shop.id, folderId: orders.id, name: 'Create order', method: 'POST', url: httpbinUrl('/post') });
    await call('create_request', { collectionId: shop.id, folderId: archive.id, name: 'Old order', url: httpbinUrl('/get') });
    const flow = await call('create_workflow', { name: 'Checkout', steps: [{ type: 'request', requestId: create.id }] });

    // 拒绝时不删除
    const deny = makeContext({ confirm: vi.fn(async () => false) });
    expect(await call('delete_request', { requestId: login.id }, deny)).toEqual({ error: 'The user declined this action' });
    expect(mockStorageService.requests.has(login.id)).toBe(true);

    const confirm = vi.fn(async () => true);
    const approve = makeContext({ confirm });
    expect(await call('delete_request', { requestId: login.id }, approve)).toEqual({ deleted: { requestId: login.id, name: 'Login' }, affectedWorkflows: [] });
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ tool: 'delete_request', detail: 'GET Login · Shop', destructive: true }));
    expect(mockStorageService.requests.has(login.id)).toBe(false);

    const folder = await call('delete_folder', { collectionId: shop.id, folderId: orders.id }, approve);
    expect(folder).toEqual({ deleted: { folderId: orders.id, name: 'Orders' }, deletedRequestCount: 2, affectedWorkflows: [{ workflowId: flow.id, name: 'Checkout' }] });
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ detail: 'Shop / Orders · 2 requests', note: expect.stringContaining('Workflows that use these requests: Checkout.') }));
    expect(mockStorageService.requests.size).toBe(0);

    expect((await call('delete_collection', { collectionId: shop.id }, approve)).deletedRequestCount).toBe(0);
    expect(useCollectionsStore().collections).toHaveLength(0);

    expect(await call('delete_workflow', { workflowId: flow.id }, approve)).toEqual({ deleted: { workflowId: flow.id, name: 'Checkout' } });
    expect(useWorkflowsStore().workflows).toHaveLength(0);
    expect((await call('delete_workflow', { workflowId: flow.id }, approve)).error).toBe(`Workflow not found: ${flow.id}`);
  });

  it('MCP-030 moves requests between collections and folders', async () => {
    const shop = await call('create_collection', { name: 'Shop' });
    const admin = await call('create_collection', { name: 'Admin' });
    const reports = await call('create_folder', { collectionId: admin.id, name: 'Reports' });
    const request = await call('create_request', { collectionId: shop.id, name: 'Sales', url: httpbinUrl('/get') });

    expect((await call('move_request', { requestId: request.id, collectionId: admin.id, folderId: 'missing' })).error).toBe('Folder not found: missing');
    expect((await call('move_request', { requestId: 'missing', collectionId: admin.id })).error).toBe('Request not found: missing');

    const moved = await call('move_request', { requestId: request.id, collectionId: admin.id, folderId: reports.id });
    expect(moved).toEqual({ requestId: request.id, name: 'Sales', collectionId: admin.id, folderId: reports.id, path: 'Admin / Reports' });
    expect(mockStorageService.requests.get(request.id)).toMatchObject({ collectionId: admin.id, folderId: reports.id });
    expect((await call('search_requests', { collectionId: shop.id })).total).toBe(0);

    const back = await call('move_request', { requestId: request.id, collectionId: shop.id });
    expect(back).toMatchObject({ collectionId: shop.id, path: 'Shop' });
    expect(back.folderId).toBeUndefined();
  });

  it('MCP-031 imports cURL commands into a collection', async () => {
    const shop = await call('create_collection', { name: 'Shop' });
    const orders = await call('create_folder', { collectionId: shop.id, name: 'Orders' });
    const curl = `curl -X POST 'https://api.example.com/orders?page=2' -H 'Content-Type: application/json' -H 'Authorization: Bearer abc' -d '{"qty":1}' -k --unknown-flag`;

    const imported = await call('import_curl', { curl, collectionId: shop.id, folderId: orders.id }, makeContext({ revealSecrets: () => true }));
    expect(imported).toMatchObject({
      name: 'POST /orders',
      method: 'POST',
      url: 'https://api.example.com/orders?page=2',
      params: [{ key: 'page', value: '2', enabled: true }],
      auth: { type: 'bearer', token: 'abc' },
      body: { type: 'json' },
      warnings: ['Unsupported cURL option --unknown-flag was ignored.'],
    });
    expect(JSON.parse(imported.body.raw)).toEqual({ qty: 1 });
    expect(mockStorageService.requests.get(imported.id)).toMatchObject({ collectionId: shop.id, folderId: orders.id, settings: { verifySsl: false } });
    expect((await call('search_requests', { query: 'orders' })).requests[0]).toMatchObject({ requestId: imported.id, path: 'Shop / Orders' });

    const named = await call('import_curl', { curl: 'curl {{baseUrl}}/health', collectionId: shop.id, name: 'Health' });
    expect(named).toMatchObject({ name: 'Health', method: 'GET', url: '{{baseUrl}}/health' });

    expect((await call('import_curl', { curl: 'hello world', collectionId: shop.id })).error).toBe('curl must be a cURL command starting with "curl"');
    expect((await call('import_curl', { curl: 'curl https://a.example.com', collectionId: shop.id, folderId: 'missing' })).error).toBe('Folder not found: missing');
  });
});
