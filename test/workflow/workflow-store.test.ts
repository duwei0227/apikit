import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeWorkflowDefinition, useWorkflowsStore } from '@/stores/workflows';
import { mockStorageService } from '../helpers/mockStorage';
import { requestStep, workflow } from '../helpers/workflowFactory';

describe('workflow store lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('WF-STORE-001 creates, saves, loads, drafts, restores, and deletes workflows', async () => {
    const store = useWorkflowsStore();
    const created = await store.createWorkflow('Draftable Workflow');

    expect(created.name).toBe('Draftable Workflow');
    expect(mockStorageService.workflows.has(created.id)).toBe(true);

    const draft = { ...created, name: 'Draft Name', steps: [requestStep()] };
    store.setWorkflowDraft(draft);
    await Promise.resolve();

    expect(store.getWorkflowDraft(created.id)?.name).toBe('Draft Name');
    expect(mockStorageService.workflowDrafts.get(created.id)?.steps).toHaveLength(1);

    const restored = await store.restoreWorkflowDraft(created.id);
    expect(restored?.name).toBe('Draftable Workflow');
    expect(store.getWorkflowDraft(created.id)).toBeNull();

    await store.saveWorkflow({ ...created, name: 'Saved Workflow' });
    expect(mockStorageService.workflows.get(created.id)?.name).toBe('Saved Workflow');

    await store.loadWorkflows();
    expect(store.workflows.some(item => item.id === created.id)).toBe(true);

    await store.deleteWorkflow(created.id);
    expect(mockStorageService.workflows.has(created.id)).toBe(false);
  });

  it('WF-STORE-002 updates a single workflow lifecycle log to completed', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([requestStep()]);

    await store.runWorkflow(definition);

    const logs = store.getWorkflowLogs(definition.id);
    expect(logs.filter(log => log.stepType === 'workflow')).toHaveLength(1);
    expect(logs[0]).toMatchObject({ stepType: 'workflow', status: 'completed' });
    expect(logs[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(logs.some(log => log.status === 'running')).toBe(false);
  });

  it('WF-STORE-003 clears workflow scoped logs', async () => {
    const store = useWorkflowsStore();
    const definition = workflow([requestStep()]);

    await store.runWorkflow(definition);
    expect(store.getWorkflowLogs(definition.id).length).toBeGreaterThan(0);

    store.clearWorkflowLogs(definition.id);
    expect(store.getWorkflowLogs(definition.id)).toHaveLength(0);
  });

  it('WF-STORE-004 normalizes persisted workflow steps before rendering or running', () => {
    const definition = workflow([
      { ...requestStep(), requestSource: undefined, inlineRequest: undefined },
      { id: 'if-without-condition', type: 'if', name: 'Legacy If', enabled: true },
      { id: 'until-without-children', type: 'until', name: 'Legacy Until', enabled: true },
    ]);

    const normalized = normalizeWorkflowDefinition(definition);

    expect(normalized.steps[0]).toMatchObject({ requestSource: 'inline' });
    expect(normalized.steps[0].inlineRequest).toBeTruthy();
    expect(normalized.steps[1].condition).toMatchObject({
      source: 'lastResponse',
      field: 'status',
      operator: 'equals',
      expectedValue: '200',
    });
    expect(normalized.steps[1].thenSteps).toEqual([]);
    expect(normalized.steps[1].elseSteps).toEqual([]);
    expect(normalized.steps[2].condition).toBeTruthy();
    expect(normalized.steps[2].childSteps).toEqual([]);
    expect(normalized.steps[2].maxIterations).toBe(10);
  });

  it('WF-STORE-005 preserves referenced request overrides across save and load', async () => {
    const store = useWorkflowsStore();
    const created = await store.createWorkflow('Customized reference');
    const customized = {
      ...created,
      steps: [
        requestStep({
          requestSource: 'reference',
          requestId: 'base-request',
          requestOverrides: {
            url: 'https://httpbin.org/anything',
            settings: { verifySsl: false },
          },
          inlineRequest: undefined,
        }),
      ],
    };

    await store.saveWorkflow(customized);
    await store.loadWorkflows();

    const loaded = store.workflows.find(item => item.id === created.id);
    expect(loaded?.steps[0].requestOverrides).toEqual({
      url: 'https://httpbin.org/anything',
      settings: { verifySsl: false },
    });
  });
});
