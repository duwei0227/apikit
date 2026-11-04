// 导入 OpenAPI / Swagger、Postman Collection 或 ApiKit 导出文件，可放到已有集合的文件夹中

import { parse as parseYaml } from 'yaml';
import { executeHttpRequest } from '@/services/http/HttpExecutionService';
import { importExportService } from '@/services/import-export';
import type { ImportBundle } from '@/services/import-export/ImportExportService';
import { variableContext } from '@/services/variables/resolver';
import { useCollectionsStore } from '@/stores/collections';
import { useEnvironmentsStore } from '@/stores/environments';
import { useRequestsStore } from '@/stores/requests';
import type { Collection, Folder, Request } from '@/types/models';
import { applyRequestFields } from '../requestFields';
import { createMissingFolders, createResolver, resolveCollection, resolvedNotes, resolveFolderTarget } from '../resolve';
import { confirmOrThrow, fail, optionalString } from '../shared';
import type { McpToolHandler } from '../types';

/** 文本按 JSON 解析，不是 JSON 时按 YAML 解析 */
export function parseSpecText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) fail('The document is empty');
  if (/^[[{]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // 可能是以 { 开头的 YAML 流式写法，继续按 YAML 解析
    }
  }
  try {
    // 大型 OpenAPI 文档常用锚点复用 schema，放宽别名数量限制
    return parseYaml(trimmed, { maxAliasCount: 10000 });
  } catch {
    fail('The document is not valid JSON or YAML');
  }
}

async function downloadSpec(url: string, context: Parameters<McpToolHandler>[1]): Promise<string> {
  await confirmOrThrow(context, {
    tool: 'import_spec',
    title: 'AI wants to download an API document',
    detail: `GET ${url}`,
    note: 'ApiKit downloads the document to import it.',
  });
  // 只下载文档：不带默认的状态码断言，也不写入请求日志
  const request = applyRequestFields({ name: 'Import document', url, tests: { statusCodeTests: [] } });
  const { response } = await executeHttpRequest(request, variableContext());
  if (response.status < 200 || response.status >= 300) fail(`Downloading the document failed with status ${response.status}`);
  return response.rawBody ?? '';
}

interface ImportCounts {
  requests: number;
  folders: number;
}

/** 把导入的集合内容（文件夹和请求）逐项加到目标位置的末尾 */
async function graftContainer(
  source: Collection | Folder,
  requestsById: Map<string, Request>,
  collectionId: string,
  parentFolderId: string | undefined,
  counts: ImportCounts,
) {
  const collections = useCollectionsStore();
  for (const folder of source.folders || []) {
    const created = await collections.addFolder(collectionId, folder.name, parentFolderId);
    counts.folders += 1;
    await graftContainer(folder, requestsById, collectionId, created.id, counts);
  }
  for (const ref of source.requests) {
    const request = requestsById.get(ref.id);
    if (!request) continue;
    await useRequestsStore().saveRequest({ ...request, collectionId, folderId: parentFolderId }, true);
    await collections.addRequestReference(collectionId, request.id, request.name, request.method, request.url, parentFolderId);
    counts.requests += 1;
  }
}

async function createEnvironments(bundle: ImportBundle) {
  const store = useEnvironmentsStore();
  const created = [];
  for (const environment of bundle.environments || []) {
    const saved = await store.createEnvironment(environment.name);
    await store.updateEnvironment(saved.id, { variables: environment.variables });
    created.push({ id: saved.id, name: saved.name, variables: environment.variables.map(variable => variable.key) });
  }
  return created;
}

export const importSpecHandlers: Record<string, McpToolHandler> = {
  async import_spec(args, context) {
    const content = optionalString(args.content, 'content');
    const url = optionalString(args.url, 'url')?.trim();
    if ((content === undefined) === (url === undefined)) fail('Pass exactly one of content or url');
    const name = optionalString(args.name, 'name')?.trim();
    const intoExisting = args.collectionId !== undefined || args.collection !== undefined;
    if (!intoExisting && (args.folderId !== undefined || args.folderPath !== undefined)) fail('folderPath and folderId need collection or collectionId');

    // 先定位目标位置，再下载和解析：有歧义时不必白白下载
    const resolver = createResolver(context, 'import_spec');
    const collection = intoExisting ? await resolveCollection(resolver, args) : undefined;
    const target = collection ? await resolveFolderTarget(resolver, collection, args, true) : undefined;

    const text = content ?? await downloadSpec(url!, context);
    let bundle: ImportBundle;
    try {
      bundle = importExportService.parseImportData(parseSpecText(text));
    } catch (error) {
      fail(error instanceof Error && error.message === 'Invalid import file format'
        ? 'The document is not an OpenAPI or Swagger document, a Postman collection or an ApiKit export'
        : (error as Error).message);
    }
    if (bundle.collections.length === 0) fail('The document contains no requests');

    const requestsById = new Map(bundle.requests.map(request => [request.id, request]));
    const counts: ImportCounts = { requests: 0, folders: 0 };
    const warnings = [...(bundle.warnings || [])];
    if (bundle.workflows.length > 0) warnings.push(`${bundle.workflows.length} workflow(s) in the file were not imported; use Import in ApiKit to import workflows.`);

    let placement: Record<string, unknown>;
    if (collection && target) {
      const { folderId, createdFolders, path } = await createMissingFolders(target);
      counts.folders += createdFolders.length;
      // 一个文件含多个集合时，每个集合放进以它命名的文件夹
      for (const source of bundle.collections) {
        let parentId = folderId;
        if (bundle.collections.length > 1) {
          parentId = (await useCollectionsStore().addFolder(collection.id, source.name, folderId)).id;
          counts.folders += 1;
        }
        await graftContainer(source, requestsById, collection.id, parentId, counts);
      }
      placement = { collectionId: collection.id, folderId, path };
    } else {
      const created = [];
      for (const source of bundle.collections) {
        const saved = await useCollectionsStore().createCollection(
          bundle.collections.length === 1 && name ? name : source.name,
          source.description,
        );
        await graftContainer(source, requestsById, saved.id, undefined, counts);
        created.push({ id: saved.id, name: saved.name });
      }
      placement = { createdCollections: created };
    }

    const environments = args.createEnvironment === true ? await createEnvironments(bundle) : [];
    const offered = bundle.environments?.length && args.createEnvironment !== true
      ? { availableEnvironments: bundle.environments.map(environment => ({ name: environment.name, variables: environment.variables.map(variable => variable.key) })) }
      : {};
    return {
      source: bundle.source,
      ...placement,
      importedRequests: counts.requests,
      createdFolders: counts.folders,
      ...(environments.length > 0 ? { createdEnvironments: environments } : {}),
      ...offered,
      ...(warnings.length > 0 ? { warnings } : {}),
      ...resolvedNotes(resolver),
    };
  },
};
