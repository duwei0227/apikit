// 请求：查看、创建、修改和发送

import { executeHttpRequest } from '@/services/http/HttpExecutionService';
import { createVariableResolver, variableContext } from '@/services/variables/resolver';
import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import type { Request } from '@/types/models';
import { cloneJson } from '@/utils/clone';
import { requestFieldProperties } from '../../schemas';
import { findFolder, containsRequest, requireCollection, savedRequestExists, requireRequest } from '../lookups';
import { applyRequestFields, describeRequest } from '../requestFields';
import { isRecord, fail, requireString, optionalString, requireUrl, truncate, describeStreamResult, unresolvedVariablesOf, summarizeTests, confirmOrThrow } from '../shared';
import type { McpToolHandler } from '../types';

export const requestHandlers: Record<string, McpToolHandler> = {
  async get_request(args, context) {
    const requestId = requireString(args, 'requestId');
    const request = await requireRequest(requestId);
    return {
      ...describeRequest(request, context.revealSecrets()),
      hasUnsavedEdits: useRequestsStore().hasRequestDraft(requestId),
    };
  },

  async create_request(args, context) {
    const collection = requireCollection(requireString(args, 'collectionId'));
    const folderId = optionalString(args.folderId, 'folderId');
    if (folderId && !findFolder(collection.folders, folderId)) fail(`Folder not found: ${folderId}`);
    requireString(args, 'name');
    requireString(args, 'url');

    const { collectionId, folderId: _folderId, ...fields } = args;
    const request = applyRequestFields(fields);
    request.collectionId = collection.id;
    request.folderId = folderId;

    await useRequestsStore().saveRequest(request, true);
    await useCollectionsStore().addRequestReference(collection.id, request.id, request.name, request.method, request.url, folderId);
    return describeRequest(request, context.revealSecrets());
  },

  async import_curl(args, context) {
    const collection = requireCollection(requireString(args, 'collectionId'));
    const folderId = optionalString(args.folderId, 'folderId');
    if (folderId && !findFolder(collection.folders, folderId)) fail(`Folder not found: ${folderId}`);
    const command = requireString(args, 'curl');
    if (!/^\s*curl\s/i.test(command)) fail('curl must be a cURL command starting with "curl"');
    const name = optionalString(args.name, 'name')?.trim();

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
      collectionId: collection.id,
      folderId,
    });

    await useRequestsStore().saveRequest(request, true);
    await useCollectionsStore().addRequestReference(collection.id, request.id, request.name, request.method, request.url, folderId);
    return {
      ...describeRequest(request, context.revealSecrets()),
      warnings: parsed.warnings.map(warning => warning.message),
    };
  },

  async update_request(args, context) {
    const requestId = requireString(args, 'requestId');
    const requests = useRequestsStore();
    if (!savedRequestExists(requestId)) fail(`Request not found: ${requestId}`);
    const stage = context.stageEdits();
    if (!stage && requests.hasRequestDraft(requestId)) {
      fail('This request has unsaved edits in ApiKit. Ask the user to save or discard them first.');
    }
    const saved = await requests.loadSavedRequest(requestId);
    if (!saved) fail(`Request not found: ${requestId}`);

    const { requestId: _requestId, ...fields } = args;
    if (!Object.keys(requestFieldProperties).some(key => fields[key] !== undefined)) fail('Pass at least one field to update');

    // 暂存：在用户已有的未保存修改上修改，由用户在 ApiKit 中保存或丢弃
    if (stage) {
      const request = applyRequestFields(fields, requests.getRequestDraft(requestId) || saved);
      await requests.setRequestDraft(request);
      requests.notifyExternalUpdate(requestId);
      return { ...describeRequest(request, context.revealSecrets()), unsavedEdits: true };
    }

    const request = applyRequestFields(fields, saved);
    await requests.saveRequest(request, true);

    const collectionId = request.collectionId
      || useCollectionsStore().collections.find(collection => containsRequest(collection, requestId))?.id;
    if (collectionId) {
      await useCollectionsStore().updateRequestReference(
        collectionId, request.id, request.name, request.method, request.url, request.folderId ?? undefined,
      );
    }
    requests.notifyExternalUpdate(requestId);
    return describeRequest(request, context.revealSecrets());
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
