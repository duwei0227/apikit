// 请求：查看、创建、修改和发送

import { executeHttpRequest } from '@/services/http/HttpExecutionService';
import { createVariableResolver, variableContext } from '@/services/variables/resolver';
import { useRequestsStore } from '@/stores/requests';
import type { Request } from '@/types/models';
import { cloneJson } from '@/utils/clone';
import { findFolder, requireCollection, requireRequest } from '../lookups';
import { commitRequestUpdate, pickRequestFields, prepareRequestUpdate, requestFromCurlCommand, saveNewRequest } from '../requestWrites';
import { applyRequestFields, describeRequest, outlineRequest, summarizeRequest } from '../requestFields';
import { createResolver, resolveRequest, resolvedNotes } from '../resolve';
import { isRecord, fail, requireString, optionalString, requireUrl, truncate, describeStreamResult, unresolvedVariablesOf, summarizeTests, confirmOrThrow, parseView } from '../shared';
import type { McpToolHandler } from '../types';

export const requestHandlers: Record<string, McpToolHandler> = {
  async get_request(args, context) {
    const view = parseView(args.view, 'full');
    const resolver = createResolver(context, 'get_request');
    const requestId = args.requestId !== undefined
      ? requireString(args, 'requestId')
      : (await resolveRequest(resolver, 'request', args.request ?? fail('Pass requestId or request (its name)'))).request.id;
    const request = await requireRequest(requestId);
    return {
      ...(view === 'summary' ? outlineRequest(request) : describeRequest(request, context.revealSecrets())),
      hasUnsavedEdits: useRequestsStore().hasRequestDraft(requestId),
      ...resolvedNotes(resolver),
    };
  },

  async create_request(args) {
    const collection = requireCollection(requireString(args, 'collectionId'));
    const folderId = optionalString(args.folderId, 'folderId');
    if (folderId && !findFolder(collection.folders, folderId)) fail(`Folder not found: ${folderId}`);
    requireString(args, 'name');
    requireString(args, 'url');

    const request = applyRequestFields(pickRequestFields(args));
    await saveNewRequest(request, collection.id, folderId);
    return summarizeRequest(request);
  },

  async import_curl(args) {
    const collection = requireCollection(requireString(args, 'collectionId'));
    const folderId = optionalString(args.folderId, 'folderId');
    if (folderId && !findFolder(collection.folders, folderId)) fail(`Folder not found: ${folderId}`);
    const command = requireString(args, 'curl');
    const { request, warnings } = await requestFromCurlCommand(command, optionalString(args.name, 'name')?.trim());
    await saveNewRequest(request, collection.id, folderId);
    return { ...summarizeRequest(request), warnings };
  },

  async update_request(args, context) {
    const requestId = requireString(args, 'requestId');
    const prepared = await prepareRequestUpdate(requestId, pickRequestFields(args), context.stageEdits());
    return commitRequestUpdate(prepared);
  },

  async send_request(args, context) {
    let request: Request;
    if (args.requestId !== undefined && args.request !== undefined) fail('Pass either requestId or request, not both');
    if (typeof args.requestId === 'string' && args.requestId) {
      request = cloneJson(await requireRequest(args.requestId));
    } else if (isRecord(args.request)) {
      requireUrl(args.request.url, 'request.url');
      request = applyRequestFields({ name: 'MCP Request', ...args.request });
    } else {
      fail('Pass requestId or request');
    }

    const resolver = variableContext();
    // 确认框里的 URL 只是预览，不能推进 $sequence 序列号
    const preview = createVariableResolver({ consumeSequences: false });
    await confirmOrThrow(context, {
      tool: 'send_request',
      title: 'AI wants to send a request',
      detail: `${request.method} ${preview(request.url)}`,
    });

    const result = await executeHttpRequest(request, {
      ...resolver,
      onConsoleLog: context.onConsoleLog,
    });
    const { response } = result;
    return {
      logId: String(result.consoleLog.id),
      status: response.status,
      statusText: response.statusText,
      time: response.time,
      size: response.size,
      headers: response.headers,
      body: response.imageDataUrl ? '(image response)' : truncate(response.rawBody ?? ''),
      stream: describeStreamResult(response.stream),
      tests: summarizeTests(result.testResults),
      unresolvedVariables: unresolvedVariablesOf(result.consoleLog),
    };
  },
};
