import { useCollectionsStore } from '@/stores/collections';
import { useEnvironmentsStore } from '@/stores/environments';
import { useRequestsStore } from '@/stores/requests';
import { useWorkflowsStore } from '@/stores/workflows';
import { searchRequestReferences } from '@/utils/collectionTree';
import { findFolder } from './lookups';
import { folderNamePath } from './resolve';
import { fileNameFromPath, isRecord } from './shared';

export interface McpCallTarget {
  name: string;
  context?: string;
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() || undefined : undefined;

function collectionPath(collectionId: unknown, folderId?: unknown): string | undefined {
  const collection = useCollectionsStore().collections.find(item => item.id === collectionId);
  if (!collection) return;
  return typeof folderId === 'string' ? folderNamePath(collection, folderId).join(' / ') : collection.name;
}

function requestTarget(id: string): McpCallTarget {
  const store = useRequestsStore();
  const match = searchRequestReferences(useCollectionsStore().collections, '').find(item => item.request.id === id);
  return {
    name: store.getRequestDraft(id)?.name || match?.request.name || store.getRequestById(id)?.name || 'Request unavailable',
    context: match?.path.join(' / '),
  };
}

function workflowTarget(id: string): McpCallTarget {
  const store = useWorkflowsStore();
  const workflow = store.getWorkflowDraft(id) || store.workflows.find(item => item.id === id);
  return { name: workflow?.name || 'Workflow unavailable', context: store.getWorkflowFolderPath(id).join(' / ') };
}

const defaultTargets: Record<string, string> = {
  list_collections: 'All collections',
  list_workflows: 'All workflows',
  list_environments: 'All environments',
  list_builtin_variables: 'Built-in variables',
  set_global_variables: 'Global variables',
  list_request_logs: 'Request logs',
  get_request_log: 'Request log',
  search_requests: 'Saved requests',
  import_spec: 'API document',
  import_curl: 'cURL command',
  create_requests: 'New requests',
  update_requests: 'Selected requests',
  run_requests: 'Selected requests',
};

export function describeMcpCallTarget(tool: string, raw: unknown): McpCallTarget {
  const args = isRecord(raw) ? raw : {};
  const requestId = text(args.requestId);
  if (requestId) return requestTarget(requestId);
  const workflowId = text(args.workflowId);
  if (workflowId) return workflowTarget(workflowId);
  const environmentId = text(args.environmentId);
  if (environmentId) {
    const environment = useEnvironmentsStore().environments.find(item => item.id === environmentId);
    return { name: environment?.name || 'Environment unavailable' };
  }
  if (args.environmentId === null) return { name: 'No environment' };

  const collection = useCollectionsStore().collections.find(item => item.id === args.collectionId);
  const folderId = text(args.folderId);
  const folder = collection && folderId ? findFolder(collection.folders, folderId) : null;
  const path = collectionPath(args.collectionId, folderId ?? args.parentFolderId) ?? text(args.collection);
  const query = text(args.query) ?? text(args.urlContains);
  if (query) return { name: query, context: ['Search term', path].filter(Boolean).join(' · ') };
  if (tool === 'search_requests' && text(args.method)) {
    return { name: `${text(args.method)} requests`, context: path };
  }
  if (isRecord(args.request)) return { name: text(args.request.name) ?? 'Unsaved request' };

  const name = text(args.name) ?? text(args.request) ?? text(args.workflow);
  if (name) return { name, context: path };
  if (folder && collection) {
    return { name: folder.name, context: folderNamePath(collection, folder.id).slice(0, -1).join(' / ') };
  }
  if (folderId) return { name: 'Folder unavailable', context: path };
  if (path) return { name: path };
  if (text(args.collectionId)) return { name: 'Collection unavailable' };
  const file = text(args.filePath);
  return { name: file ? fileNameFromPath(file) : defaultTargets[tool] ?? '—' };
}

const batchResultFields: Record<string, string> = {
  create_requests: 'requests',
  update_requests: 'requests',
  run_requests: 'results',
  import_spec: 'createdCollections',
};

/** Resolve the final name from the handler output, keeping the captured path after deletion. */
export function describeMcpCallResult(tool: string, result: unknown, target: McpCallTarget): McpCallTarget {
  if (!isRecord(result)) return target;
  const batch = result[batchResultFields[tool]];
  if (Array.isArray(batch)) {
    const names = batch.map(item => isRecord(item) ? text(item.name) : undefined).filter(name => name !== undefined);
    if (names.length > 0) {
      return {
        name: names.length === 1 ? names[0] : `${names[0]} +${names.length - 1} more`,
        context: text(result.path) ?? target.context,
      };
    }
  }
  const resultPath = text(result.path);
  if (tool === 'import_spec' && resultPath) return { name: resultPath };
  if (tool === 'run_workflow' && Array.isArray(result.resolved)) {
    const match = result.resolved.find(item => isRecord(item) && item.field === 'workflow');
    const name = isRecord(match) ? text(match.matched) : undefined;
    if (name) return { ...target, name };
  }
  const name = isRecord(result.deleted) ? text(result.deleted.name) : text(result.name);
  if (!name) return target;
  const path = resultPath ?? collectionPath(result.collectionId, result.folderId);
  const context = tool.endsWith('_folder') ? target.context : path ?? target.context;
  return { name, context };
}
