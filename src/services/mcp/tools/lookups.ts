// 按 id 查找集合、请求和 Workflow，找不到时报错

import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import { useWorkflowsStore } from '@/stores/workflows';
import type { Collection, Folder, Request, WorkflowDefinition, WorkflowStep } from '@/types/models';
import { searchRequestReferences, type RequestSearchResult } from '@/utils/collectionTree';
import { fail } from './shared';

export function findFolder(folders: Folder[], folderId: string): Folder | null {
  for (const folder of folders) {
    if (folder.id === folderId) return folder;
    const nested = findFolder(folder.folders || [], folderId);
    if (nested) return nested;
  }
  return null;
}

export function containsRequest(target: Collection | Folder, requestId: string): boolean {
  return target.requests.some(ref => ref.id === requestId)
    || (target.folders || []).some(folder => containsRequest(folder, requestId));
}

export function requireCollection(collectionId: string): Collection {
  const collection = useCollectionsStore().collections.find(item => item.id === collectionId);
  return collection || fail(`Collection not found: ${collectionId}`);
}

export function savedRequestExists(requestId: string): boolean {
  return useCollectionsStore().collections.some(collection => containsRequest(collection, requestId));
}

export async function requireRequest(requestId: string): Promise<Request> {
  if (!savedRequestExists(requestId)) fail(`Request not found: ${requestId}`);
  const request = await useRequestsStore().loadRequest(requestId);
  return request || fail(`Request not found: ${requestId}`);
}

export function requireWorkflow(workflowId: string): WorkflowDefinition {
  const workflow = useWorkflowsStore().workflows.find(item => item.id === workflowId);
  return workflow || fail(`Workflow not found: ${workflowId}`);
}

/** 请求所在的集合、文件夹和路径；找不到时报错 */
export function locateRequest(requestId: string): RequestSearchResult {
  const located = searchRequestReferences(useCollectionsStore().collections, '').find(item => item.request.id === requestId);
  return located || fail(`Request not found: ${requestId}`);
}

const stepReferencesAny = (steps: WorkflowStep[] = [], requestIds: Set<string>): boolean => steps.some(step => (
  (step.type === 'request' && step.requestSource === 'reference' && !!step.requestId && requestIds.has(step.requestId))
  || stepReferencesAny(step.thenSteps, requestIds)
  || stepReferencesAny(step.elseSteps, requestIds)
  || stepReferencesAny(step.childSteps, requestIds)
));

/** 引用了这些请求的 Workflow（含未保存的修改） */
export function findWorkflowsReferencing(requestIds: string[]): Array<{ workflowId: string; name: string }> {
  if (requestIds.length === 0) return [];
  const ids = new Set(requestIds);
  const store = useWorkflowsStore();
  return store.workflows
    .filter(workflow => stepReferencesAny((store.getWorkflowDraft(workflow.id) || workflow).steps, ids))
    .map(workflow => ({ workflowId: workflow.id, name: workflow.name }));
}
