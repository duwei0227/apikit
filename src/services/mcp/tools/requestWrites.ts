// 新建和修改请求：先准备（校验并生成请求），全部通过后再写入，批量工具出错时不会只写一半

import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import type { Request } from '@/types/models';
import { cloneJson } from '@/utils/clone';
import { generateId } from '@/utils/id-generator';
import { requestFieldProperties } from '../schemas';
import { containsRequest, savedRequestExists } from './lookups';
import { applyRequestFields, summarizeRequest } from './requestFields';
import { fail, optionalString } from './shared';

export const REQUEST_FIELD_KEYS = Object.keys(requestFieldProperties);

/** 只取请求字段，忽略工具参数（collectionId、folderPath 等） */
export function pickRequestFields(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(REQUEST_FIELD_KEYS.filter(key => args[key] !== undefined).map(key => [key, args[key]]));
}

export interface CurlRequest {
  request: Request;
  warnings: string[];
}

/** 把 cURL 命令转换为请求，与 ApiKit 中导入 cURL 相同；名称缺省为方法和路径 */
export async function requestFromCurlCommand(command: string, name?: string): Promise<CurlRequest> {
  if (!/^\s*curl\s/i.test(command)) fail('curl must be a cURL command starting with "curl"');
  const { parseCurl, requestFromCurl } = await import('@/utils/curl-parser');
  let parsed: ReturnType<typeof parseCurl>;
  try {
    parsed = parseCurl(command);
  } catch (error) {
    fail(`Could not parse the cURL command: ${(error as Error).message}`);
  }
  if (!parsed.url) fail('The cURL command has no URL');
  const request = requestFromCurl(parsed, {
    name: name || `${parsed.method} ${parsed.url.replace(/^[a-z]+:\/\/[^/]+/i, '').split('?')[0] || '/'}`,
  });
  return { request, warnings: parsed.warnings.map(warning => warning.message) };
}

/** 复制已保存的请求，换新的 id */
export function copyRequest(source: Request): Request {
  const now = new Date().toISOString();
  return { ...cloneJson(source), id: generateId(), createdAt: now, updatedAt: now };
}

/** 新请求写入存储，并加到集合或文件夹的末尾 */
export async function saveNewRequest(request: Request, collectionId: string, folderId?: string): Promise<void> {
  request.collectionId = collectionId;
  request.folderId = folderId;
  await useRequestsStore().saveRequest(request, true);
  await useCollectionsStore().addRequestReference(collectionId, request.id, request.name, request.method, request.url, folderId);
}

export interface PreparedUpdate {
  request: Request;
  /** 存为未保存的修改，由用户在 ApiKit 中保存或丢弃 */
  stage: boolean;
}

/** 准备修改已保存的请求：按设置在未保存的修改上修改，或直接保存（有未保存的修改时报错）。
 * fields 也可以是函数，根据当前内容计算要修改的字段，例如在现有 header 上增删 */
export async function prepareRequestUpdate(
  requestId: string,
  fields: Record<string, unknown> | ((current: Request) => Record<string, unknown>),
  stage: boolean,
): Promise<PreparedUpdate> {
  const requests = useRequestsStore();
  if (!savedRequestExists(requestId)) fail(`Request not found: ${requestId}`);
  if (!stage && requests.hasRequestDraft(requestId)) {
    fail('This request has unsaved edits in ApiKit. Ask the user to save or discard them first.');
  }
  const saved = await requests.loadSavedRequest(requestId);
  if (!saved) fail(`Request not found: ${requestId}`);
  const base = stage ? (requests.getRequestDraft(requestId) || saved) : saved;
  const changes = typeof fields === 'function' ? fields(base) : fields;
  if (!REQUEST_FIELD_KEYS.some(key => changes[key] !== undefined)) fail('Pass at least one field to update');
  return { request: applyRequestFields(changes, base), stage };
}

export async function commitRequestUpdate({ request, stage }: PreparedUpdate) {
  const requests = useRequestsStore();
  if (stage) {
    await requests.setRequestDraft(request);
    requests.notifyExternalUpdate(request.id);
    return { ...summarizeRequest(request), unsavedEdits: true };
  }
  await requests.saveRequest(request, true);
  const collectionId = request.collectionId
    || useCollectionsStore().collections.find(collection => containsRequest(collection, request.id))?.id;
  if (collectionId) {
    await useCollectionsStore().updateRequestReference(
      collectionId, request.id, request.name, request.method, request.url, request.folderId ?? undefined,
    );
  }
  requests.notifyExternalUpdate(request.id);
  return summarizeRequest(request);
}

/** 拼接公共地址和相对路径；完整 URL 或以变量开头的地址保持不变 */
export function joinBaseUrl(baseUrl: string | undefined, url: string): string {
  if (!baseUrl || /^[a-z][a-z0-9+.-]*:\/\//i.test(url) || url.trim().startsWith('{{')) return url;
  if (!url) return baseUrl;
  return `${baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

/** 合并 header 或参数列表：同名（header 不区分大小写）的项以 overrides 为准，其余保留 defaults 的顺序 */
export function mergeKeyValues(defaults: unknown, overrides: unknown, caseInsensitive: boolean): unknown {
  if (!Array.isArray(defaults)) return overrides;
  if (!Array.isArray(overrides)) return defaults;
  const keyOf = (item: unknown) => {
    const key = (item as { key?: unknown } | null)?.key;
    return typeof key === 'string' ? (caseInsensitive ? key.toLowerCase() : key) : undefined;
  };
  const overridden = new Set(overrides.map(keyOf).filter(Boolean));
  return [...defaults.filter(item => !overridden.has(keyOf(item))), ...overrides];
}

/** 公共字段与单条请求的字段合并：headers、params 按名称合并，settings 合并，其余以单条为准 */
export function mergeWithDefaults(defaults: Record<string, unknown>, fields: Record<string, unknown>): Record<string, unknown> {
  const baseUrl = optionalString(defaults.baseUrl, 'defaults.baseUrl');
  const merged: Record<string, unknown> = { ...pickRequestFields(defaults), ...fields };
  if (defaults.headers !== undefined || fields.headers !== undefined) merged.headers = mergeKeyValues(defaults.headers, fields.headers, true);
  if (defaults.params !== undefined || fields.params !== undefined) merged.params = mergeKeyValues(defaults.params, fields.params, false);
  if (defaults.settings !== undefined && fields.settings !== undefined) {
    merged.settings = { ...(defaults.settings as object), ...(fields.settings as object) };
  }
  if (typeof merged.url === 'string') merged.url = joinBaseUrl(baseUrl, merged.url);
  return merged;
}

/** 用新内容替换已保存的请求（保留 id、创建时间和位置），规则与 prepareRequestUpdate 相同 */
export async function prepareRequestReplace(requestId: string, replacement: Request, stage: boolean): Promise<PreparedUpdate> {
  const requests = useRequestsStore();
  if (!stage && requests.hasRequestDraft(requestId)) {
    fail('This request has unsaved edits in ApiKit. Ask the user to save or discard them first.');
  }
  const saved = await requests.loadSavedRequest(requestId);
  if (!saved) fail(`Request not found: ${requestId}`);
  return {
    request: {
      ...cloneJson(replacement),
      id: saved.id,
      createdAt: saved.createdAt,
      updatedAt: new Date().toISOString(),
      collectionId: saved.collectionId,
      folderId: saved.folderId,
    },
    stage,
  };
}
