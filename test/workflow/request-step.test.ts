import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowsStore } from '@/stores/workflows';
import { useRequestsStore } from '@/stores/requests';
import { httpbinInvocations, httpbinUrl } from '../helpers/httpbin';
import { mockStorageService } from '../helpers/mockStorage';
import { emptyTests, makeRequest, passingStatusTest, requestStep, workflow } from '../helpers/workflowFactory';

describe('workflow request step', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('WF-REQ-001 executes an inline GET request against httpbin', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      requestStep({
        inlineRequest: makeRequest({
          url: httpbinUrl('/get'),
          params: [{ key: 'source', value: 'workflow', enabled: true }],
          headers: [{ key: 'x-apikit-test', value: 'inline', enabled: true }],
          tests: passingStatusTest('200'),
        }),
      }),
    ]);

    await store.runWorkflow(definition);

    const requestLog = store.getWorkflowLogs(definition.id).find(log => log.stepType === 'request');
    expect(requestLog?.status).toBe('passed');
    expect(requestLog?.response?.status).toBe(200);
    expect(requestLog?.request?.url).toContain('source=workflow');
  });

  it('WF-REQ-002 executes a referenced request loaded from storage', async () => {
    const savedRequest = makeRequest({ id: 'stored-request', url: httpbinUrl('/get'), tests: emptyTests() });
    mockStorageService.requests.set(savedRequest.id, savedRequest);
    const store = useWorkflowsStore();
    const definition = workflow([
      requestStep({
        requestSource: 'reference',
        requestId: savedRequest.id,
        inlineRequest: undefined,
      }),
    ]);

    await store.runWorkflow(definition);

    const requestLog = store.getWorkflowLogs(definition.id).find(log => log.stepType === 'request');
    expect(requestLog?.response?.status).toBe(200);
  });

  it('initializes one request log before execution and updates it in place', async () => {
    const savedRequest = makeRequest({ id: 'pending-request', url: httpbinUrl('/get'), tests: passingStatusTest('200') });
    let finishLoading!: (request: typeof savedRequest | null) => void;
    const pendingLoad = new Promise<typeof savedRequest | null>(resolve => { finishLoading = resolve; });
    const loadSpy = vi.spyOn(mockStorageService, 'loadRequest').mockImplementation(async () => pendingLoad);
    const store = useWorkflowsStore();
    const definition = workflow([
      requestStep({
        requestSource: 'reference',
        requestId: savedRequest.id,
        inlineRequest: undefined,
      }),
    ]);

    const run = store.runWorkflow(definition);
    await vi.waitFor(() => {
      const requestLogs = store.getWorkflowLogs(definition.id).filter(item => item.stepType === 'request');
      expect(requestLogs).toHaveLength(1);
      expect(requestLogs[0]).toMatchObject({ status: 'started', level: 'info', message: 'Request running' });
    });

    const startedLogId = store.getWorkflowLogs(definition.id).find(item => item.stepType === 'request')?.id;
    finishLoading(savedRequest);
    await run;

    const requestLogs = store.getWorkflowLogs(definition.id).filter(item => item.stepType === 'request');
    expect(requestLogs).toHaveLength(1);
    expect(requestLogs[0]).toMatchObject({ id: startedLogId, status: 'passed', level: 'success', message: 'Request completed: 200' });
    loadSpy.mockRestore();
  });

  it('WF-REQ-003 fails workflow when a referenced request is missing', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      requestStep({
        requestSource: 'reference',
        requestId: 'missing-request',
        inlineRequest: undefined,
      }),
    ]);

    await store.runWorkflow(definition);

    const logs = store.getWorkflowLogs(definition.id);
    const requestLogs = logs.filter(log => log.stepType === 'request');
    expect(requestLogs).toHaveLength(1);
    expect(requestLogs[0]).toMatchObject({ status: 'failed', message: 'Request not found' });
    expect(logs.at(-1)?.status).toBe('failed');
  });

  it('WF-REQ-004 stops workflow when request tests fail', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([
      requestStep({
        inlineRequest: makeRequest({
          url: httpbinUrl('/status/200'),
          tests: passingStatusTest('201'),
        }),
      }),
      requestStep({ name: 'should not run' }),
    ]);

    await store.runWorkflow(definition);

    const logs = store.getWorkflowLogs(definition.id);
    const requestLogs = logs.filter(log => log.stepType === 'request');
    expect(requestLogs).toHaveLength(1);
    const failedLog = requestLogs[0];
    expect(failedLog?.message).toBe('Status code 200 equals 201 (1 test failed), workflow stopped');
    expect(failedLog?.testResults?.statusCode[0]).toMatchObject({
      actualValue: 200,
      expectedValue: '201',
      passed: false,
    });
    expect(logs.some(log => log.stepName === 'should not run')).toBe(false);
  });

  it('executes a referenced draft that still uses the legacy status test value field', async () => {
    const legacyDraft = makeRequest({ id: 'legacy-draft', url: httpbinUrl('/status/200') });
    delete legacyDraft.testsConfig;
    legacyDraft.tests = {
      statusCodeTests: [{ enabled: true, operator: 'equals', value: '200' }],
      jsonFieldTests: [],
      globalVariables: [],
    } as any;
    mockStorageService.requestDrafts.set(legacyDraft.id, legacyDraft);

    const store = useWorkflowsStore();
    const requestsStore = useRequestsStore();
    await requestsStore.loadRequestDrafts();
    const definition = workflow([
      requestStep({
        requestSource: 'reference',
        requestId: legacyDraft.id,
        inlineRequest: undefined,
      }),
    ]);

    await store.runWorkflow(definition);

    const requestLog = store.getWorkflowLogs(definition.id).find(log => log.stepType === 'request');
    expect(requestLog?.status).toBe('passed');
    expect(requestLog?.testResults?.statusCode[0].expectedValue).toBe('200');
    expect(mockStorageService.requestDrafts.get(legacyDraft.id)?.tests.statusCodeTests[0]).toHaveProperty('value', '200');
  });

  it('WF-REQ-005 extracts global variables from a passing JSON response', async () => {
    const store = useWorkflowsStore();
    const globals: Record<string, string> = {};
    const definition = workflow([
      requestStep({
        inlineRequest: makeRequest({
          url: httpbinUrl('/anything'),
          params: [{ key: 'slideTitle', value: 'Sample', enabled: true }],
          tests: {
            statusCodeTests: [{ enabled: true, operator: 'equals', expectedValue: '200', description: '' }],
            jsonFieldTests: [{ enabled: true, jsonPath: '$.args.slideTitle', operator: 'contains', expectedValue: 'Sample', description: '' }],
            globalVariables: [{ enabled: true, variableName: 'slideTitle', valueType: 'jsonPath', jsonPath: '$.args.slideTitle', customValue: '', description: '' }],
          },
        }),
      }),
    ]);

    await store.runWorkflow(definition, {
      setGlobalVariable: (key, value) => {
        globals[key] = value;
      },
    });

    expect(globals.slideTitle).toContain('Sample');
    const requestLog = store.getWorkflowLogs(definition.id).find(log => log.stepType === 'request');
    expect(requestLog?.testResults?.globalVars[0]).toMatchObject({
      success: true,
      status: 'set',
      variableName: 'slideTitle',
      source: '$.args.slideTitle',
      value: 'Sample',
    });
  });

  it('WF-REQ-006 applies workflow overrides to the latest referenced request', async () => {
    const savedRequest = makeRequest({
      id: 'customized-request',
      method: 'GET',
      url: httpbinUrl('/get'),
      params: [{ key: 'source', value: 'base', enabled: true }],
      headers: [{ key: 'x-base-version', value: 'latest', enabled: true }],
      tests: emptyTests(),
      settings: { verifySsl: true, followRedirects: true },
    });
    mockStorageService.requests.set(savedRequest.id, savedRequest);
    const store = useWorkflowsStore();
    const definition = workflow([
      requestStep({
        requestSource: 'reference',
        requestId: savedRequest.id,
        requestOverrides: {
          url: httpbinUrl('/anything'),
          params: [{ key: 'source', value: 'workflow', enabled: true }],
          headers: [{ key: 'x-workflow', value: 'custom', enabled: true }],
          settings: { verifySsl: false },
        },
        inlineRequest: undefined,
      }),
    ]);

    await store.runWorkflow(definition);

    const requestLog = store.getWorkflowLogs(definition.id).find(log => log.stepType === 'request');
    expect(requestLog?.status).toBe('passed');
    expect(requestLog?.request?.url).toContain('/anything?source=workflow');
    expect(requestLog?.request?.requestHeaders).toMatchObject({ 'x-workflow': 'custom' });
    expect(httpbinInvocations.at(-1)).toMatchObject({
      verifySsl: false,
      maxRedirections: 10,
    });
  });
});
