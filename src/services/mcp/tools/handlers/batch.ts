// 批量操作：一次调用新建或修改多个请求，减少与 AI 的往返

import type { Collection, Folder, Request, RequestReference } from '@/types/models';
import { requireRequest } from '../lookups';
import { applyRequestFields } from '../requestFields';
import {
  commitRequestUpdate,
  copyRequest,
  mergeWithDefaults,
  pickRequestFields,
  type PreparedUpdate,
  prepareRequestReplace,
  requestFromCurlCommand,
  saveNewRequest,
} from '../requestWrites';
import { createMissingFolders, createResolver, resolveCollection, resolvedNotes, resolveFolderTarget, resolveRequest } from '../resolve';
import { fail, isOneOf, isRecord, optionalString } from '../shared';
import { MAX_BATCH_REQUESTS, McpAmbiguityError, McpToolError, type McpToolHandler } from '../types';

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
  resolver: ReturnType<typeof createResolver>,
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
};
