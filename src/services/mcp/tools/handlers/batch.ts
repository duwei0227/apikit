// 批量操作：一次调用新建或修改多个请求，减少与 AI 的往返

import { executeHttpRequest } from '@/services/http/HttpExecutionService';
import { createVariableResolver, variableContext } from '@/services/variables/resolver';
import type { Collection, Folder, Request, RequestReference } from '@/types/models';
import { cloneJson } from '@/utils/clone';
import { mapWithConcurrency } from '@/utils/concurrency';
import type { RequestSearchResult } from '@/utils/collectionTree';
import { fuzzyFilter } from '@/utils/fuzzyMatch';
import { locateRequest, requireRequest } from '../lookups';
import { applyRequestFields } from '../requestFields';
import {
  commitRequestUpdate,
  copyRequest,
  mergeKeyValues,
  mergeWithDefaults,
  pickRequestFields,
  type PreparedUpdate,
  prepareRequestReplace,
  prepareRequestUpdate,
  requestFromCurlCommand,
  saveNewRequest,
} from '../requestWrites';
import {
  createMissingFolders,
  createResolver,
  requestLabel,
  requestsInside,
  resolveCollection,
  resolvedNotes,
  resolveFolderTarget,
  resolveRequest,
} from '../resolve';
import { confirmOrThrow, fail, isOneOf, isRecord, optionalPositiveInteger, optionalString, summarizeTests, unresolvedVariablesOf } from '../shared';
import {
  DEFAULT_BODY_PREVIEW_CHARS,
  DEFAULT_RUN_CONCURRENCY,
  MAX_BATCH_REQUESTS,
  MAX_BODY_PREVIEW_CHARS,
  MAX_RUN_CONCURRENCY,
  MAX_RUN_REQUESTS,
  McpAmbiguityError,
  McpToolError,
  type McpToolHandler,
} from '../types';

export const ON_EXISTS = ['skip', 'error', 'update', 'create'] as const;
type OnExists = typeof ON_EXISTS[number];

type Plan =
  | { kind: 'create'; request: Request; warnings: string[] }
  | { kind: 'skip'; existing: RequestReference }
  | { kind: 'update'; prepared: PreparedUpdate };

export function requireItems(value: unknown, label: string, max: number): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty array`);
  if (value.length > max) fail(`${label} can have at most ${max} items; split them into several calls`);
  return value.map((item, index) => (isRecord(item) ? item : fail(`${label}[${index}] must be an object`)));
}

/** 单项出错时在消息前加上位置；歧义错误已带有参数位置，原样抛出 */
export async function withItemLabel<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof McpAmbiguityError || !(error instanceof McpToolError)) throw error;
    fail(`${label}: ${error.message}`);
  }
}

/** 按一项的写法生成请求：curl、copyFrom，或请求字段（与 defaults 合并） */
async function buildRequest(
  item: Record<string, unknown>,
  label: string,
  defaults: Record<string, unknown>,
  resolver: Resolver,
): Promise<{ request: Request; warnings: string[] }> {
  const fields = pickRequestFields(item);
  const name = optionalString(item.name, 'name')?.trim();
  if (item.curl !== undefined && item.copyFrom !== undefined) fail('Pass either curl or copyFrom, not both');

  if (item.curl !== undefined) {
    if (typeof item.curl !== 'string') fail('curl must be a string');
    const { request, warnings } = await requestFromCurlCommand(item.curl, name);
    const { name: _name, ...overrides } = fields;
    return { request: Object.keys(overrides).length > 0 ? applyRequestFields(overrides, request) : request, warnings };
  }

  if (item.copyFrom !== undefined) {
    const source = await resolveRequest(resolver, `${label}.copyFrom`, item.copyFrom);
    const base = copyRequest(await requireRequest(source.request.id));
    const request = applyRequestFields(fields, base);
    if (!name) request.name = `${base.name} copy`;
    return { request, warnings: [] };
  }

  const merged = mergeWithDefaults(defaults, fields);
  if (!name) fail('name is required (or pass curl or copyFrom)');
  if (typeof merged.url !== 'string' || !merged.url.trim()) fail('url is required');
  return { request: applyRequestFields(merged), warnings: [] };
}

type Resolver = ReturnType<typeof createResolver>;

const SELECTION_KEYS = ['requestIds', 'collectionId', 'collection', 'folderId', 'folderPath', 'query'];

/** 批量操作的请求范围：requestIds（id 或名称），或集合加可选的文件夹和关键词 */
export async function selectRequests(resolver: Resolver, args: Record<string, unknown>, max: number): Promise<RequestSearchResult[]> {
  let selected: RequestSearchResult[];
  if (args.requestIds !== undefined) {
    if (['collectionId', 'collection', 'folderId', 'folderPath', 'query'].some(key => args[key] !== undefined)) {
      fail('Pass either requestIds, or collection with optional folderPath and query');
    }
    const refs = requireStringList(args.requestIds, 'requestIds', max);
    selected = [];
    for (const [index, ref] of refs.entries()) selected.push(await resolveRequest(resolver, `requestIds[${index}]`, ref));
  } else {
    const collection = await resolveCollection(resolver, args);
    const target = await resolveFolderTarget(resolver, collection, args, false);
    const inside = requestsInside(collection, target.folder?.id);
    const query = optionalString(args.query, 'query')?.trim();
    selected = query
      ? fuzzyFilter(inside, query, match => ({ name: match.request.name, path: match.path.join(' / '), extra: [match.request.url] })).map(entry => entry.item)
      : inside;
    if (selected.length === 0) fail(`No requests in ${target.path.join(' / ')}${query ? ` match "${query}"` : ''}`);
  }
  const unique = [...new Map(selected.map(match => [match.request.id, match])).values()];
  if (unique.length > max) fail(`${unique.length} requests match; at most ${max} can be handled in one call. Narrow the folder or query.`);
  return unique;
}

function requireStringList(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty array`);
  if (value.length > max) fail(`${label} can have at most ${max} items; split them into several calls`);
  return value.map((item, index) => (typeof item === 'string' && item.trim() ? item.trim() : fail(`${label}[${index}] must be a request id or name`)));
}

/** 批量修改的内容：set 中的字段，加上在现有 header 上合并或删除 */
function bulkChange(args: Record<string, unknown>): (current: Request) => Record<string, unknown> {
  const set = args.set === undefined ? {} : (isRecord(args.set) ? pickRequestFields(args.set) : fail('set must be an object of request fields'));
  if (set.name !== undefined) fail('set.name would give every request the same name; use updates to rename requests');
  const mergeHeaders = args.mergeHeaders;
  if (mergeHeaders !== undefined && !Array.isArray(mergeHeaders)) fail('mergeHeaders must be an array of { key, value }');
  const removeHeaders = args.removeHeaders === undefined ? [] : requireStringList(args.removeHeaders, 'removeHeaders', 100).map(key => key.toLowerCase());
  if (Object.keys(set).length === 0 && mergeHeaders === undefined && removeHeaders.length === 0) {
    fail('Pass set, mergeHeaders and/or removeHeaders');
  }
  return current => {
    if (mergeHeaders === undefined && removeHeaders.length === 0) return set;
    const base = set.headers ?? current.headers.filter(header => header.key);
    const merged = mergeKeyValues(base, mergeHeaders ?? [], true) as Array<{ key?: unknown }>;
    return { ...set, headers: merged.filter(header => !removeHeaders.includes(String(header.key).toLowerCase())) };
  };
}

export const batchHandlers: Record<string, McpToolHandler> = {
  async create_requests(args, context) {
    const resolver = createResolver(context, 'create_requests');
    const items = requireItems(args.requests, 'requests', MAX_BATCH_REQUESTS);
    const defaults = args.defaults === undefined ? {} : (isRecord(args.defaults) ? args.defaults : fail('defaults must be an object'));
    const onExists: OnExists = args.onExists === undefined ? 'skip' : (isOneOf(ON_EXISTS, args.onExists) ? args.onExists : fail(`onExists must be one of ${ON_EXISTS.join(', ')}`));

    const collection = await resolveCollection(resolver, args);
    const target = await resolveFolderTarget(resolver, collection, args, true);
    // 目标文件夹已存在时才可能有同名请求
    const container: Collection | Folder | null = target.missing.length > 0 ? null : (target.folder || collection);
    const existingByName = new Map((container?.requests || []).map(ref => [ref.name, ref]));
    const plannedNames = new Set<string>();
    const stage = context.stageEdits();

    // 先全部校验，任何一项有误都不写入
    const plans: Plan[] = [];
    for (const [index, item] of items.entries()) {
      const label = `requests[${index}]`;
      plans.push(await withItemLabel(label, async (): Promise<Plan> => {
        const { request, warnings } = await buildRequest(item, label, defaults, resolver);
        const existing = existingByName.get(request.name);
        const duplicate = existing || plannedNames.has(request.name);
        plannedNames.add(request.name);
        if (!duplicate || onExists === 'create') return { kind: 'create', request, warnings };
        if (onExists === 'error') fail(`a request named "${request.name}" already exists in ${target.path.join(' / ')}`);
        if (!existing) fail(`"${request.name}" appears more than once in requests`);
        if (onExists === 'skip') return { kind: 'skip', existing };
        return { kind: 'update', prepared: await prepareRequestReplace(existing.id, request, stage) };
      }));
    }

    const { folderId, createdFolders, path } = await createMissingFolders(target);
    const results: Array<Record<string, unknown>> = [];
    const warnings: Array<{ index: number; warnings: string[] }> = [];
    for (const [index, plan] of plans.entries()) {
      if (plan.kind === 'skip') {
        results.push({ id: plan.existing.id, name: plan.existing.name, method: plan.existing.method, status: 'skipped' });
        continue;
      }
      if (plan.kind === 'update') {
        const saved = await commitRequestUpdate(plan.prepared);
        results.push({ id: saved.id, name: saved.name, method: saved.method, status: 'updated', ...(stage ? { unsavedEdits: true } : {}) });
        continue;
      }
      await saveNewRequest(plan.request, collection.id, folderId);
      results.push({ id: plan.request.id, name: plan.request.name, method: plan.request.method, status: 'created' });
      if (plan.warnings.length > 0) warnings.push({ index, warnings: plan.warnings });
    }

    const count = (status: string) => results.filter(result => result.status === status).length;
    return {
      collectionId: collection.id,
      folderId,
      path,
      ...(createdFolders.length > 0 ? { createdFolders } : {}),
      created: count('created'),
      skipped: count('skipped'),
      updated: count('updated'),
      requests: results,
      ...(warnings.length > 0 ? { warnings } : {}),
      ...resolvedNotes(resolver),
    };
  },

  async update_requests(args, context) {
    const resolver = createResolver(context, 'update_requests');
    const stage = context.stageEdits();
    const bulkKeys = ['set', 'mergeHeaders', 'removeHeaders'];
    const jobs: Array<{ label: string; requestId: string; fields: Record<string, unknown> | ((current: Request) => Record<string, unknown>) }> = [];

    if (args.updates !== undefined) {
      if ([...SELECTION_KEYS, ...bulkKeys].some(key => args[key] !== undefined)) {
        fail('Pass either updates, or a selection (requestIds or collection) with set, mergeHeaders or removeHeaders');
      }
      const items = requireItems(args.updates, 'updates', MAX_BATCH_REQUESTS);
      for (const [index, item] of items.entries()) {
        const label = `updates[${index}]`;
        const requestId = await withItemLabel(label, async () => {
          if (typeof item.requestId === 'string' && item.requestId) return locateRequest(item.requestId).request.id;
          if (item.request === undefined) fail('pass requestId or request (its name)');
          return (await resolveRequest(resolver, `${label}.request`, item.request)).request.id;
        });
        jobs.push({ label, requestId, fields: pickRequestFields(item) });
      }
    } else {
      const change = bulkChange(args);
      const selected = await selectRequests(resolver, args, MAX_BATCH_REQUESTS);
      selected.forEach(match => jobs.push({ label: requestLabel(match), requestId: match.request.id, fields: change }));
    }
    const ids = jobs.map(job => job.requestId);
    if (new Set(ids).size !== ids.length) fail('The same request appears more than once in updates');

    // 先全部校验，任何一项有误都不写入
    const prepared: PreparedUpdate[] = [];
    for (const job of jobs) prepared.push(await withItemLabel(job.label, () => prepareRequestUpdate(job.requestId, job.fields, stage)));
    const results = [];
    for (const item of prepared) {
      const saved = await commitRequestUpdate(item);
      results.push({ id: saved.id, name: saved.name, method: saved.method, ...(stage ? { unsavedEdits: true } : {}) });
    }
    return { updated: results.length, requests: results, ...resolvedNotes(resolver) };
  },

  async run_requests(args, context) {
    const resolver = createResolver(context, 'run_requests');
    const maxConcurrency = optionalPositiveInteger(args.maxConcurrency, 'maxConcurrency', MAX_RUN_CONCURRENCY) ?? DEFAULT_RUN_CONCURRENCY;
    const previewChars = args.bodyPreviewChars === undefined ? DEFAULT_BODY_PREVIEW_CHARS : Number(args.bodyPreviewChars);
    if (!Number.isInteger(previewChars) || previewChars < 0 || previewChars > MAX_BODY_PREVIEW_CHARS) {
      fail(`bodyPreviewChars must be an integer between 0 and ${MAX_BODY_PREVIEW_CHARS}`);
    }
    const selected = await selectRequests(resolver, args, MAX_RUN_REQUESTS);
    // 与 send_request 相同：使用请求当前未保存的修改
    const requests = await Promise.all(selected.map(match => requireRequest(match.request.id)));

    const preview = createVariableResolver({ consumeSequences: false });
    const shown = requests.slice(0, 10).map(request => `${request.method} ${preview(request.url)}`);
    const more = requests.length > shown.length ? `\n… and ${requests.length - shown.length} more` : '';
    await confirmOrThrow(context, {
      tool: 'run_requests',
      title: `AI wants to send ${requests.length} request${requests.length === 1 ? '' : 's'}`,
      detail: `${shown.join('\n')}${more}`,
      note: `This makes real network requests with your active environment, up to ${maxConcurrency} at a time.`,
    });

    const started = Date.now();
    const results = await mapWithConcurrency(requests, maxConcurrency, async request => {
      const base = { requestId: request.id, name: request.name, method: request.method };
      try {
        const result = await executeHttpRequest(cloneJson(request), { ...variableContext(), onConsoleLog: context.onConsoleLog });
        const { response } = result;
        const tests = summarizeTests(result.testResults);
        const body = response.imageDataUrl ? '(image response)' : (response.stream?.text ?? response.rawBody ?? '');
        return {
          ...base,
          passed: tests.passed,
          status: response.status,
          time: response.time,
          logId: String(result.consoleLog.id),
          ...(tests.failures.length > 0 ? { failures: tests.failures } : {}),
          ...(previewChars > 0 && body ? { bodyPreview: body.length > previewChars ? `${body.slice(0, previewChars)}…` : body } : {}),
          ...(unresolvedVariablesOf(result.consoleLog) ? { unresolvedVariables: unresolvedVariablesOf(result.consoleLog) } : {}),
        };
      } catch (error) {
        return { ...base, passed: false, error: (error as Error | null)?.message || String(error) };
      }
    });

    return {
      total: results.length,
      passed: results.filter(result => result.passed).length,
      failed: results.filter(result => !result.passed).length,
      totalMs: Date.now() - started,
      results,
      ...resolvedNotes(resolver),
    };
  },
};
