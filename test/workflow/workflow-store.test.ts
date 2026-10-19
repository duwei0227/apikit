import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeWorkflowDefinition, useWorkflowsStore } from '@/stores/workflows';
import { referenceStepName } from '@/services/workflow/definition';
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

  it('WF-STORE-FOLDER-001 keeps workflows in sidebar folders across reloads', async () => {
    const store = useWorkflowsStore();
    const folderId = await store.createFolder('Orders');
    const subFolderId = await store.createFolder('After sales', folderId);
    const checkout = await store.createWorkflow('Checkout', folderId);
    const refund = await store.createWorkflow('Refund', subFolderId);
    // 新的 Workflow（如 AI 创建）放在根目录末尾
    const login = workflow([], { id: 'wf-login', name: 'Login' });
    await store.saveWorkflow(login);

    expect(store.getWorkflowFolderPath(refund.id)).toEqual(['Orders', 'After sales']);
    expect(store.getWorkflowFolderPath(login.id)).toEqual([]);

    await store.renameFolder(subFolderId, 'Returns');
    await store.moveWorkflowToFolder(login.id, subFolderId);

    setActivePinia(createPinia());
    const reloaded = useWorkflowsStore();
    await reloaded.loadWorkflows();
    expect(reloaded.getWorkflowFolderPath(login.id)).toEqual(['Orders', 'Returns']);
    expect(reloaded.getWorkflowFolderPath(checkout.id)).toEqual(['Orders']);

    const deleted = await reloaded.deleteFolder(subFolderId);
    expect(deleted.sort()).toEqual([login.id, refund.id].sort());
    expect(mockStorageService.workflows.has(refund.id)).toBe(false);
    expect(mockStorageService.workflowLayout?.items).toEqual([
      { type: 'folder', id: folderId, name: 'Orders', children: [{ type: 'workflow', id: checkout.id }] },
    ]);
  });

  it('WF-STORE-FOLDER-002 places workflows saved before folders existed at the top level', async () => {
    mockStorageService.workflows.set('old-1', workflow([], { id: 'old-1', name: 'Old one' }));
    mockStorageService.workflows.set('old-2', workflow([], { id: 'old-2', name: 'Old two' }));
    const store = useWorkflowsStore();
    await store.loadWorkflows();
    expect(store.layout.items).toEqual([{ type: 'workflow', id: 'old-1' }, { type: 'workflow', id: 'old-2' }]);

    const folderId = (await store.ensureFolderPath(['Imported', 'Smoke']))!;
    expect(await store.ensureFolderPath(['imported', 'smoke'])).toBe(folderId);
    expect(await store.ensureFolderPath([])).toBeNull();
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
      { id: 'for-with-legacy-cap', type: 'for', name: 'Legacy For', enabled: true, iterations: 4, maxIterations: 2 },
    ]);

    const normalized = normalizeWorkflowDefinition(definition);

    expect(normalized.steps[0]).toMatchObject({ requestSource: 'inline' });
    expect(normalized.steps[0].inlineRequest).toBeTruthy();
    expect(normalized.steps[1].conditions).toEqual([{
      source: 'lastResponse',
      field: 'status',
      operator: 'equals',
      expectedValue: '200',
    }]);
    expect(normalized.steps[1].conditionMatch).toBe('all');
    expect(normalized.steps[1].thenSteps).toEqual([]);
    expect(normalized.steps[1].elseSteps).toEqual([]);
    expect(normalized.steps[2].conditions).toHaveLength(1);
    expect(normalized.steps[2].childSteps).toEqual([]);
    expect(normalized.steps[2].maxIterations).toBe(30);
    expect(normalized.steps[3].iterations).toBe(4);
    expect(normalized.steps[3].maxIterations).toBeUndefined();
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

  it('WF-STORE-006 converts a legacy single condition and drops unsupported condition matches', () => {
    const legacy = { source: 'globalVariable', field: 'value', path: 'token', operator: 'exists', expectedValue: '' } as const;
    const normalized = normalizeWorkflowDefinition(workflow([
      { id: 'legacy-while', type: 'while', name: 'Legacy While', enabled: true, condition: { ...legacy }, childSteps: [] },
      { id: 'while-cumulative', type: 'while', name: 'While', enabled: true, conditions: [{ ...legacy }, { ...legacy }], conditionMatch: 'cumulative', childSteps: [] },
      { id: 'until-cumulative', type: 'until', name: 'Until', enabled: true, conditions: [{ ...legacy }, { ...legacy }], conditionMatch: 'cumulative', childSteps: [] },
    ]));

    expect(normalized.steps[0].conditions).toEqual([legacy]);
    expect(normalized.steps[0]).not.toHaveProperty('condition');
    expect(normalized.steps[1].conditionMatch).toBe('all');
    expect(normalized.steps[2].conditionMatch).toBe('cumulative');
    expect(normalized.steps[2].conditions).toHaveLength(2);
  });

  it('WF-STORE-007 names reference steps after the request unless the user renamed them', () => {
    expect(referenceStepName('Existing Request', 'Login')).toBe('Login');
    expect(referenceStepName('  ', 'Login')).toBe('Login');
    expect(referenceStepName('Login', 'Create order', 'Login')).toBe('Create order');
    expect(referenceStepName('Get token first', 'Create order', 'Login')).toBe('Get token first');
    expect(referenceStepName('Existing Request', undefined)).toBe('Existing Request');
  });
});
