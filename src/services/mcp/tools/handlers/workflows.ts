// Workflow：查看、创建、修改和运行

import { variableContext } from '@/services/variables/resolver';
import { useWorkflowsStore } from '@/stores/workflows';
import type { WorkflowDefinition } from '@/types/models';
import { generateId } from '@/utils/id-generator';
import { listWorkflowPlacements } from '@/utils/workflowTree';
import { notifyItemDeleted } from '@/composables/useDeletedItems';
import { requireWorkflow } from '../lookups';
import { fail, requireString, describeLog, confirmOrThrow } from '../shared';
import { MAX_LOG_ENTRIES, type McpToolHandler } from '../types';
import { buildWorkflowSteps, describeStep, countSteps } from '../workflowSteps';

export const workflowHandlers: Record<string, McpToolHandler> = {
  async list_workflows() {
    const store = useWorkflowsStore();
    const workflowsById = new Map(store.workflows.map(workflow => [workflow.id, workflow]));
    return {
      // 与侧边栏的顺序一致
      workflows: listWorkflowPlacements(store.layout).flatMap(({ id, folderPath }) => {
        const workflow = workflowsById.get(id);
        if (!workflow) return [];
        return [{
          id: workflow.id,
          name: workflow.name,
          folderPath,
          stepCount: countSteps(workflow.steps),
          updatedAt: workflow.updatedAt,
          hasUnsavedEdits: Boolean(store.getWorkflowDraft(workflow.id)),
        }];
      }),
    };
  },

  async get_workflow(args, context) {
    const store = useWorkflowsStore();
    const saved = requireWorkflow(requireString(args, 'workflowId'));
    const draft = store.getWorkflowDraft(saved.id);
    const workflow = draft || saved;
    return {
      id: workflow.id,
      name: workflow.name,
      hasUnsavedEdits: Boolean(draft),
      steps: workflow.steps.map(step => describeStep(step, context.revealSecrets())),
    };
  },

  async create_workflow(args, context) {
    const name = requireString(args, 'name');
    const steps = buildWorkflowSteps(args.steps);
    const store = useWorkflowsStore();
    const now = new Date().toISOString();
    const workflow: WorkflowDefinition = { id: generateId(), name, steps, version: 1, createdAt: now, updatedAt: now };
    await store.saveWorkflow(workflow);
    const saved = requireWorkflow(workflow.id);
    return { id: saved.id, name: saved.name, steps: saved.steps.map(step => describeStep(step, context.revealSecrets())) };
  },

  async delete_workflow(args, context) {
    const store = useWorkflowsStore();
    const workflow = requireWorkflow(requireString(args, 'workflowId'));
    if (store.runningWorkflowId === workflow.id) fail('The workflow is running in ApiKit. Try again when it finishes.');
    await confirmOrThrow(context, {
      tool: 'delete_workflow',
      title: 'AI wants to delete a workflow',
      detail: `${workflow.name} (${countSteps(workflow.steps)} steps)`,
      note: 'The workflow and its unsaved edits are deleted. This cannot be undone. The saved requests it uses are kept.',
      destructive: true,
    });
    await store.deleteWorkflow(workflow.id);
    store.clearWorkflowDraft(workflow.id);
    notifyItemDeleted('workflow', workflow.id);
    return { deleted: { workflowId: workflow.id, name: workflow.name } };
  },

  async update_workflow(args, context) {
    const store = useWorkflowsStore();
    const saved = requireWorkflow(requireString(args, 'workflowId'));
    const stage = context.stageEdits();
    const draft = store.getWorkflowDraft(saved.id);
    if (!stage && draft) {
      fail('This workflow has unsaved edits in ApiKit. Ask the user to save or discard them first.');
    }
    if (args.name === undefined && args.steps === undefined) fail('Pass name and/or steps');
    // 暂存：在用户已有的未保存修改上修改，由用户在 ApiKit 中保存或丢弃
    const workflow = stage ? draft || saved : saved;
    const name = args.name === undefined ? workflow.name : requireString(args, 'name');
    const steps = args.steps === undefined ? workflow.steps : buildWorkflowSteps(args.steps);
    if (stage) {
      store.setWorkflowDraft({ ...workflow, name, steps });
      store.notifyExternalUpdate(workflow.id);
      const staged = store.getWorkflowDraft(workflow.id)!;
      return {
        id: staged.id,
        name: staged.name,
        steps: staged.steps.map(step => describeStep(step, context.revealSecrets())),
        unsavedEdits: true,
      };
    }
    await store.saveWorkflow({ ...workflow, name, steps });
    const updated = requireWorkflow(workflow.id);
    return {
      id: updated.id,
      name: updated.name,
      steps: updated.steps.map(step => describeStep(step, context.revealSecrets())),
    };
  },

  async run_workflow(args, context) {
    const store = useWorkflowsStore();
    const saved = requireWorkflow(requireString(args, 'workflowId'));
    if (store.isRunning) fail('Another workflow is running in ApiKit. Try again when it finishes.');
    // 与界面一致：有未保存的修改时运行修改后的版本
    const workflow = store.getWorkflowDraft(saved.id) || saved;

    await confirmOrThrow(context, {
      tool: 'run_workflow',
      title: 'AI wants to run a workflow',
      detail: `${workflow.name} (${countSteps(workflow.steps)} steps)`,
    });

    await store.runWorkflow(workflow, { ...variableContext(), onConsoleLog: context.onConsoleLog });
    const logs = store.getWorkflowLogs(workflow.id);
    const summary = logs.find(log => log.stepType === 'workflow');
    return {
      status: summary?.status,
      message: summary?.message,
      durationMs: summary?.durationMs,
      requestCount: summary?.requestCount,
      passedRequestCount: summary?.passedRequestCount,
      failedRequestCount: summary?.failedRequestCount,
      usedUnsavedEdits: workflow !== saved,
      logs: logs.slice(0, MAX_LOG_ENTRIES).map(describeLog),
      truncatedLogs: Math.max(0, logs.length - MAX_LOG_ENTRIES),
    };
  },
};
