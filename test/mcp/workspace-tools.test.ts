import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { callMcpTool, type McpToolContext } from '@/services/mcp/tools';
import {
  registerWorkspaceTabBridge,
  type WorkspaceTabBridge,
  type WorkspaceTabInspection,
  type WorkspaceTabDecision,
} from '@/services/workspaceTabBridge';
import { useRequestsStore } from '@/stores/requests';
import { useWorkflowsStore } from '@/stores/workflows';
import { createEmptyRequest } from '@/utils/requestFactory';
import type { WorkflowDefinition } from '@/types/models';

const context: McpToolContext = {
  onConsoleLog: vi.fn(),
  confirm: vi.fn(async () => true),
  revealSecrets: () => false,
  stageEdits: () => true,
};

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await callMcpTool(name, args, context);
  const text = result.content[0].text;
  if (result.isError) return { error: text };
  return JSON.parse(text) as Record<string, unknown>;
}

describe('MCP workspace tab tools', () => {
  let unregisterBridge: (() => void) | undefined;
  let requestInspection: WorkspaceTabInspection;
  let workflowInspection: WorkspaceTabInspection;
  let bridge: WorkspaceTabBridge;

  beforeEach(() => {
    setActivePinia(createPinia());
    requestInspection = { isOpen: false, hasUnsavedEdits: false };
    workflowInspection = { isOpen: false, hasUnsavedEdits: false };
    bridge = {
      openRequest: vi.fn(async () => { requestInspection.isOpen = true; }),
      openWorkflow: vi.fn(async () => { workflowInspection.isOpen = true; }),
      inspectRequest: vi.fn(async () => requestInspection),
      inspectWorkflow: vi.fn(async () => workflowInspection),
      closeRequest: vi.fn(async (_id: string, _decision?: WorkspaceTabDecision) => { requestInspection.isOpen = false; }),
      closeWorkflow: vi.fn(async (_id: string, _decision?: WorkspaceTabDecision) => { workflowInspection.isOpen = false; }),
    };
    unregisterBridge = registerWorkspaceTabBridge(bridge);
  });

  afterEach(() => unregisterBridge?.());

  it('opens saved requests and workflows in the workspace', async () => {
    const collection = await call('create_collection', { name: 'API' });
    const request = await call('create_request', {
      collectionId: collection.id as string,
      name: 'Health',
      url: 'https://example.com/health',
    });
    const workflow = await call('create_workflow', { name: 'Smoke', steps: [] });

    expect(await call('open_request', { requestId: request.id as string }))
      .toMatchObject({ opened: true, requestId: request.id, name: 'Health' });
    expect(await call('open_workflow', { workflowId: workflow.id as string }))
      .toMatchObject({ opened: true, workflowId: workflow.id, name: 'Smoke' });
    expect(bridge.openRequest).toHaveBeenCalledWith(request.id);
    expect(bridge.openWorkflow).toHaveBeenCalledWith(workflow.id);
  });

  it('returns unsaved request content before closing and applies the confirmed decision', async () => {
    const collection = await call('create_collection', { name: 'API' });
    const saved = await call('create_request', {
      collectionId: collection.id as string,
      name: 'Health',
      url: 'https://example.com/health',
    });
    const requestId = saved.id as string;
    const requestStore = useRequestsStore();
    const currentRequest = createEmptyRequest({
      ...requestStore.requests.get(requestId)!,
      name: 'Unsaved health check',
      auth: { type: 'bearer', token: 'request-secret', username: '', password: '' },
    });
    requestInspection = { isOpen: true, hasUnsavedEdits: true, request: currentRequest };

    const review = await call('close_request', { requestId });
    expect(review).toMatchObject({ closed: false, requiresConfirmation: true, hasUnsavedEdits: true });
    expect(review.request).toMatchObject({ name: 'Unsaved health check' });
    expect((review.request as { auth: { token: string } }).auth.token).toBe('<hidden>');
    expect(bridge.closeRequest).not.toHaveBeenCalled();

    const closed = await call('close_request', {
      requestId,
      decision: 'discard',
      confirmationId: review.confirmationId as string,
    });
    expect(closed).toMatchObject({ closed: true, decision: 'discard', hadUnsavedEdits: true });
    expect(bridge.closeRequest).toHaveBeenCalledWith(requestId, 'discard');
  });

  it('requires a new review if workflow edits change before confirmation', async () => {
    const created = await call('create_workflow', { name: 'Smoke', steps: [] });
    const workflowId = created.id as string;
    const workflowStore = useWorkflowsStore();
    const currentWorkflow = workflowStore.workflows.find(item => item.id === workflowId)!;
    workflowInspection = {
      isOpen: true,
      hasUnsavedEdits: true,
      workflow: { ...currentWorkflow, name: 'Draft name' },
    };

    const firstReview = await call('close_workflow', { workflowId });
    workflowInspection = {
      ...workflowInspection,
      workflow: { ...workflowInspection.workflow!, name: 'Changed after review' },
    };

    const refreshedReview = await call('close_workflow', {
      workflowId,
      decision: 'save',
      confirmationId: firstReview.confirmationId as string,
    });
    expect(refreshedReview).toMatchObject({ closed: false, requiresConfirmation: true });
    expect(refreshedReview.confirmationId).not.toBe(firstReview.confirmationId);
    expect(refreshedReview.workflow).toMatchObject({ name: 'Changed after review' });
    expect(bridge.closeWorkflow).not.toHaveBeenCalled();

    const closed = await call('close_workflow', {
      workflowId,
      decision: 'save',
      confirmationId: refreshedReview.confirmationId as string,
    });
    expect(closed).toMatchObject({ closed: true, decision: 'save' });
    expect(bridge.closeWorkflow).toHaveBeenCalledWith(workflowId, 'save');
  });

  it('hides inline workflow credentials while returning the draft for review', async () => {
    const created = await call('create_workflow', { name: 'Private workflow', steps: [] });
    const workflowId = created.id as string;
    const workflowStore = useWorkflowsStore();
    const saved = workflowStore.workflows.find(item => item.id === workflowId)!;
    const steps: WorkflowDefinition['steps'] = [{
      id: 'inline-request',
      type: 'request',
      name: 'Private request',
      enabled: true,
      requestSource: 'inline',
      inlineRequest: createEmptyRequest({
        auth: { type: 'bearer', token: 'workflow-secret', username: '', password: '' },
        headers: [{ key: 'Authorization', value: 'header-secret', enabled: true }],
      }),
    }];
    workflowInspection = {
      isOpen: true,
      hasUnsavedEdits: true,
      workflow: { ...saved, steps },
    };

    const review = await call('close_workflow', { workflowId });
    expect(review.workflow).toMatchObject({
      steps: [{
        inlineRequest: {
          auth: { token: '<hidden>' },
          headers: [{ key: 'Authorization', value: '<hidden>' }],
        },
      }],
    });
  });
});
