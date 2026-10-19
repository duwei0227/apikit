import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { storageService } from '@/services/storage';
import type { WorkflowRuntimeContext } from '@/services/workflow/engine';
import { normalizeWorkflowDefinition } from '@/services/workflow/definition';
import { RunLogRecorder } from '@/services/workflow/runLog';
import { useRequestsStore } from '@/stores/requests';
import type { WorkflowDefinition, WorkflowLayout, WorkflowRunLog } from '@/types/models';
import { generateId } from '@/utils/id-generator';
import { cloneJson } from '@/utils/clone';
import {
  addFolderToLayout,
  addWorkflowToLayout,
  ensureWorkflowFolderPath,
  insertWorkflowAfter,
  listWorkflowPlacements,
  normalizeWorkflowLayout,
  removeFolderFromLayout,
  removeWorkflowFromLayout,
  renameFolderInLayout,
} from '@/utils/workflowTree';

// 定义和执行已移到 services/workflow，这里保留导出供原有调用方使用
export type { WorkflowRuntimeContext } from '@/services/workflow/engine';
export {
  createWorkflowControlStep,
  createWorkflowRequestStep,
  createWorkflowSetVariablesStep,
  normalizeWorkflowDefinition,
} from '@/services/workflow/definition';

export const useWorkflowsStore = defineStore('workflows', () => {
  const workflows = ref<WorkflowDefinition[]>([]);
  const isLoading = ref(true);
  const isRunning = ref(false);
  const runningWorkflowId = ref<string | null>(null);
  const runningStartedAt = ref<number | null>(null);
  const activeWorkflowId = ref<string | null>(null);
  const runLogs = ref<WorkflowRunLog[]>([]);
  const workflowLogsById = ref<Record<string, WorkflowRunLog[]>>({});
  const currentRequestId = ref<string | null>(null);
  const stopRequested = ref(false);
  const workflowDrafts = ref<Map<string, WorkflowDefinition>>(new Map());
  // 外部（如 MCP）把修改存为未保存修改的次数，打开的 Workflow 据此重新载入
  const externalRevisions = ref<Record<string, number>>({});
  const currentWorkflowId = ref<string>('');
  // 侧边栏的文件夹结构和顺序
  const layout = ref<WorkflowLayout>({ items: [] });

  const activeWorkflow = computed(() => workflows.value.find(item => item.id === activeWorkflowId.value) || null);

  async function loadWorkflows() {
    isLoading.value = true;
    try {
      workflows.value = (await storageService.loadWorkflows()).map(normalizeWorkflowDefinition);
      layout.value = normalizeWorkflowLayout(
        await storageService.loadWorkflowLayout(),
        workflows.value.map(workflow => workflow.id)
      );
      const drafts = await storageService.loadWorkflowDrafts();
      workflowDrafts.value = new Map(
        Object.entries(drafts).map(([id, workflow]) => [id, normalizeWorkflowDefinition(workflow)])
      );
      if (!activeWorkflowId.value && workflows.value.length > 0) {
        activeWorkflowId.value = workflows.value[0].id;
      }
    } finally {
      isLoading.value = false;
    }
  }

  async function saveLayout(next: WorkflowLayout) {
    layout.value = next;
    await storageService.saveWorkflowLayout(next);
  }

  /** folderId 为 null 时放在根目录末尾 */
  async function createWorkflow(name: string = 'New Workflow', folderId: string | null = null) {
    const now = new Date().toISOString();
    const workflow: WorkflowDefinition = {
      id: generateId(),
      name,
      steps: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    workflows.value.unshift(workflow);
    activeWorkflowId.value = workflow.id;
    await storageService.saveWorkflow(workflow);
    await saveLayout(addWorkflowToLayout(layout.value, workflow.id, folderId));
    return workflow;
  }

  async function saveWorkflow(workflow: WorkflowDefinition) {
    const normalizedWorkflow = normalizeWorkflowDefinition({
      ...workflow,
      updatedAt: new Date().toISOString(),
    });
    const index = workflows.value.findIndex(item => item.id === normalizedWorkflow.id);
    if (index >= 0) {
      workflows.value[index] = cloneJson(normalizedWorkflow);
    } else {
      workflows.value.unshift(cloneJson(normalizedWorkflow));
    }
    await storageService.saveWorkflow(normalizedWorkflow);
    clearWorkflowDraft(normalizedWorkflow.id);
    // 新的 Workflow（如 AI 创建或导入）放在根目录末尾
    if (index < 0) {
      await saveLayout(addWorkflowToLayout(layout.value, normalizedWorkflow.id));
    }
  }

  function notifyExternalUpdate(id: string): void {
    externalRevisions.value = {
      ...externalRevisions.value,
      [id]: (externalRevisions.value[id] || 0) + 1,
    };
  }

  function getWorkflowDraft(id: string): WorkflowDefinition | null {
    return workflowDrafts.value.get(id) || null;
  }

  function setWorkflowDraft(workflow: WorkflowDefinition) {
    const draft = normalizeWorkflowDefinition(cloneJson(workflow));
    const next = new Map(workflowDrafts.value);
    next.set(workflow.id, draft);
    workflowDrafts.value = next;
    storageService.saveWorkflowDraft(draft).catch(error => {
      console.error('Failed to save workflow draft:', error);
    });
  }

  function clearWorkflowDraft(id: string) {
    const next = new Map(workflowDrafts.value);
    next.delete(id);
    workflowDrafts.value = next;
    storageService.deleteWorkflowDraft(id).catch(error => {
      console.error('Failed to delete workflow draft:', error);
    });
  }

  async function restoreWorkflowDraft(id: string) {
    clearWorkflowDraft(id);
    const workflow = workflows.value.find(item => item.id === id);
    return workflow ? normalizeWorkflowDefinition(cloneJson(workflow)) : null;
  }

  async function deleteWorkflow(id: string) {
    await storageService.deleteWorkflow(id);
    workflows.value = workflows.value.filter(item => item.id !== id);
    if (activeWorkflowId.value === id) {
      activeWorkflowId.value = workflows.value[0]?.id || null;
    }
    await saveLayout(removeWorkflowFromLayout(layout.value, id));
  }

  /** 在 parentId 文件夹（null 为根目录）末尾新建文件夹，返回文件夹 id */
  async function createFolder(name: string, parentId: string | null = null) {
    const id = generateId();
    await saveLayout(addFolderToLayout(layout.value, { id, name }, parentId));
    return id;
  }

  async function renameFolder(folderId: string, name: string) {
    await saveLayout(renameFolderInLayout(layout.value, folderId, name));
  }

  /** 删除文件夹及其中（含子文件夹）的全部 Workflow，返回被删除的 Workflow id */
  async function deleteFolder(folderId: string) {
    const { workflowIds } = removeFolderFromLayout(layout.value, folderId);
    for (const id of workflowIds) {
      await deleteWorkflow(id);
    }
    await saveLayout(removeFolderFromLayout(layout.value, folderId).layout);
    return workflowIds;
  }

  /** 把 Workflow 移到文件夹末尾，folderId 为 null 时移到根目录 */
  async function moveWorkflowToFolder(workflowId: string, folderId: string | null) {
    await saveLayout(addWorkflowToLayout(layout.value, workflowId, folderId));
  }

  /** 把 Workflow 放在 referenceId 的后面（如复制出的 Workflow 放在原 Workflow 后面） */
  async function placeWorkflowAfter(workflowId: string, referenceId: string) {
    await saveLayout(insertWorkflowAfter(layout.value, workflowId, referenceId));
  }

  /** 按名称路径找到文件夹，缺少的逐级新建；路径为空时返回 null（根目录） */
  async function ensureFolderPath(folderPath: string[]) {
    if (folderPath.length === 0) return null;
    const result = ensureWorkflowFolderPath(layout.value, folderPath, generateId);
    await saveLayout(result.layout);
    return result.folderId;
  }

  /** 拖放后的新结构 */
  async function setLayout(next: WorkflowLayout) {
    await saveLayout(normalizeWorkflowLayout(next, workflows.value.map(workflow => workflow.id)));
  }

  /** Workflow 所在文件夹的名称路径，在根目录时为空 */
  function getWorkflowFolderPath(workflowId: string): string[] {
    return listWorkflowPlacements(layout.value).find(placement => placement.id === workflowId)?.folderPath || [];
  }

  async function runWorkflow(workflow: WorkflowDefinition, context: WorkflowRuntimeContext = {}) {
    if (isRunning.value) return;
    const normalizedWorkflow = normalizeWorkflowDefinition(cloneJson(workflow));

    isRunning.value = true;
    stopRequested.value = false;
    currentRequestId.value = null;
    runningWorkflowId.value = normalizedWorkflow.id;
    runningStartedAt.value = Date.now();
    currentWorkflowId.value = normalizedWorkflow.id;
    runLogs.value = [];
    workflowLogsById.value = {
      ...workflowLogsById.value,
      [normalizedWorkflow.id]: [],
    };

    // 日志写入当前运行日志和该 Workflow 的日志（取响应式数组，界面随之更新）
    const log = new RunLogRecorder({
      runId: generateId(),
      workflowId: normalizedWorkflow.id,
      workflowName: normalizedWorkflow.name,
      lists: () => [runLogs.value, workflowLogsById.value[normalizedWorkflow.id]].filter(Boolean),
    });
    try {
      // 执行引擎（含请求执行）只在运行时加载，不放进启动包
      const { createWorkflowEngine } = await import('@/services/workflow/engine');
      const engine = createWorkflowEngine(context, {
        log,
        isStopRequested: () => stopRequested.value,
        loadRequest: requestId => useRequestsStore().reloadRequestFromStorage(requestId),
        onRequestStart: requestId => { currentRequestId.value = requestId; },
        onRequestEnd: () => { currentRequestId.value = null; },
      });
      await engine.run(normalizedWorkflow);
    } finally {
      isRunning.value = false;
      runningWorkflowId.value = null;
      runningStartedAt.value = null;
      currentRequestId.value = null;
    }
  }

  async function stopWorkflow() {
    stopRequested.value = true;
    if (currentRequestId.value) {
      const { cancelHttpExecution } = await import('@/services/http/HttpExecutionService');
      await cancelHttpExecution(currentRequestId.value);
    }
  }

  function clearLogs() {
    runLogs.value = [];
    workflowLogsById.value = {};
  }

  function clearWorkflowLogs(workflowId: string) {
    if (!workflowId) return;
    workflowLogsById.value = {
      ...workflowLogsById.value,
      [workflowId]: [],
    };
    if (currentWorkflowId.value === workflowId) {
      runLogs.value = [];
    }
  }

  function getWorkflowLogs(workflowId: string) {
    return workflowLogsById.value[workflowId] || [];
  }

  return {
    workflows,
    isLoading,
    isRunning,
    runningWorkflowId,
    runningStartedAt,
    activeWorkflowId,
    activeWorkflow,
    runLogs,
    workflowLogsById,
    layout,
    loadWorkflows,
    createWorkflow,
    saveWorkflow,
    deleteWorkflow,
    createFolder,
    renameFolder,
    deleteFolder,
    moveWorkflowToFolder,
    placeWorkflowAfter,
    ensureFolderPath,
    setLayout,
    getWorkflowFolderPath,
    runWorkflow,
    stopWorkflow,
    clearLogs,
    clearWorkflowLogs,
    getWorkflowLogs,
    externalRevisions,
    notifyExternalUpdate,
    getWorkflowDraft,
    setWorkflowDraft,
    clearWorkflowDraft,
    restoreWorkflowDraft,
  };
});
