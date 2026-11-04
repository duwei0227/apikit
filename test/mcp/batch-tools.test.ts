import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callMcpTool, type McpToolContext } from '@/services/mcp/tools';
import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import { mockStorageService } from '../helpers/mockStorage';

const makeContext = (overrides: Partial<McpToolContext> = {}): McpToolContext => ({
  onConsoleLog: vi.fn(),
  confirm: vi.fn(async () => true),
  revealSecrets: () => true,
  stageEdits: () => false,
  ...overrides,
});

const call = async (name: string, args: any = {}, context: McpToolContext = makeContext()) => {
  const result = await callMcpTool(name, args, context);
  const text = result.content[0].text;
  if (result.isError) return { error: text };
  return JSON.parse(text);
};

const folderNames = (collectionId: string) => {
  const collection = useCollectionsStore().collections.find(item => item.id === collectionId)!;
  const names: string[] = [];
  const visit = (folders: any[], prefix: string[]) => folders.forEach(folder => {
    names.push([...prefix, folder.name].join(' / '));
    visit(folder.folders || [], [...prefix, folder.name]);
  });
  visit(collection.folders, []);
  return names;
};

describe('MCP batch tools', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('MCP-BATCH-001 creates a folder and several requests in one call by names', async () => {
    const bpp = await call('create_collection', { name: 'BPP 服务' });
    await call('create_collection', { name: 'Shop' });
    const existing = await call('create_folder', { collectionId: bpp.id, name: '已有目录' });
    const login = await call('create_request', {
      collectionId: bpp.id, name: 'Login', method: 'POST', url: '{{host}}/login',
      headers: [{ key: 'X-Trace', value: 'login' }], body: { type: 'json', raw: { user: 'a' } },
    });

    const result = await call('create_requests', {
      collection: 'bpp',
      folderPath: ['已有目录', '服务优化'],
      defaults: { baseUrl: '{{host}}/api', headers: [{ key: 'Authorization', value: 'Bearer {{token}}' }, { key: 'Accept', value: 'application/json' }] },
      requests: [
        { name: 'Guard list', url: '/guards' },
        { name: 'Guard create', method: 'POST', url: 'guards', headers: [{ key: 'accept', value: 'text/plain' }], body: { type: 'json', raw: { id: 1 } } },
        { name: 'External', url: 'https://other.example.com/ping' },
        { curl: "curl -X DELETE 'https://api.example.com/guards/1' -H 'X-Mode: hard'" },
        { copyFrom: 'login', name: 'Login (admin)', body: { type: 'json', raw: { user: 'admin' } } },
      ],
    });

    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({
      collectionId: bpp.id,
      path: 'BPP 服务 / 已有目录 / 服务优化',
      createdFolders: [{ name: '服务优化' }],
      created: 5,
      skipped: 0,
      updated: 0,
      resolved: [{ field: 'collection', input: 'bpp', matched: 'BPP 服务' }],
    });
    expect(result.requests.map((r: any) => [r.name, r.method, r.status])).toEqual([
      ['Guard list', 'GET', 'created'],
      ['Guard create', 'POST', 'created'],
      ['External', 'GET', 'created'],
      ['DELETE /guards/1', 'DELETE', 'created'],
      ['Login (admin)', 'POST', 'created'],
    ]);
    expect(folderNames(bpp.id)).toEqual(['已有目录', '已有目录 / 服务优化']);
    expect(result.folderId).toBe(result.createdFolders[0].id);
    expect(useCollectionsStore().collections[0].folders[0].id).toBe(existing.id);

    const [list, create, external, curl, copy] = result.requests.map((r: any) => mockStorageService.requests.get(r.id)!);
    expect(list.url).toBe('{{host}}/api/guards');
    expect(list.headers).toEqual([
      { key: 'Authorization', value: 'Bearer {{token}}', enabled: true },
      { key: 'Accept', value: 'application/json', enabled: true },
    ]);
    // 单条的同名 header 覆盖公共 header（不区分大小写）
    expect(create.url).toBe('{{host}}/api/guards');
    expect(create.headers.map((h: any) => [h.key, h.value])).toEqual([['Authorization', 'Bearer {{token}}'], ['accept', 'text/plain']]);
    expect(external.url).toBe('https://other.example.com/ping');
    expect(curl).toMatchObject({ method: 'DELETE', url: 'https://api.example.com/guards/1', folderId: result.folderId });
    expect(curl.headers.find((h: any) => h.key === 'Authorization')).toBeUndefined();
    // 复制的请求保留原请求的其余内容
    expect(copy).toMatchObject({ method: 'POST', url: '{{host}}/login', folderId: result.folderId, collectionId: bpp.id });
    expect(copy.id).not.toBe(login.id);
    expect(copy.headers).toEqual([{ key: 'X-Trace', value: 'login', enabled: true }]);
    expect(JSON.parse(copy.body.raw)).toEqual({ user: 'admin' });
    expect(JSON.parse(mockStorageService.requests.get(login.id)!.body.raw)).toEqual({ user: 'a' });
  });

  it('MCP-BATCH-002 handles requests that already exist and saves nothing when an item is invalid', async () => {
    const collection = await call('create_collection', { name: 'C' });
    const folder = await call('create_folder', { collectionId: collection.id, name: 'Orders' });
    const first = await call('create_requests', { collectionId: collection.id, folderId: folder.id, requests: [{ name: 'List', url: '/orders' }] });
    const listId = first.requests[0].id;

    const skipped = await call('create_requests', {
      collectionId: collection.id, folderPath: ['Orders'],
      requests: [{ name: 'List', url: '/orders?page=2' }, { name: 'Get', url: '/orders/1' }],
    });
    expect(skipped).toMatchObject({ created: 1, skipped: 1, requests: [{ id: listId, status: 'skipped' }, { name: 'Get', status: 'created' }] });
    expect(skipped).not.toHaveProperty('createdFolders');
    expect(mockStorageService.requests.get(listId)!.url).toBe('/orders');

    const updated = await call('create_requests', {
      collectionId: collection.id, folderPath: ['Orders'], onExists: 'update',
      requests: [{ name: 'List', method: 'POST', url: '/orders/search' }],
    });
    expect(updated).toMatchObject({ updated: 1, requests: [{ id: listId, status: 'updated', method: 'POST' }] });
    expect(mockStorageService.requests.get(listId)).toMatchObject({ method: 'POST', url: '/orders/search', folderId: folder.id });
    expect(useCollectionsStore().collections[0].folders[0].requests.find(ref => ref.id === listId)).toMatchObject({ method: 'POST', url: '/orders/search' });

    const duplicate = await call('create_requests', { collectionId: collection.id, folderId: folder.id, onExists: 'create', requests: [{ name: 'List', url: '/x' }] });
    expect(duplicate.created).toBe(1);
    expect(useCollectionsStore().collections[0].folders[0].requests.filter(ref => ref.name === 'List')).toHaveLength(2);

    const before = mockStorageService.requests.size;
    expect((await call('create_requests', { collectionId: collection.id, folderId: folder.id, onExists: 'error', requests: [{ name: 'New', url: '/n' }, { name: 'Get', url: '/g' }] })).error)
      .toBe('requests[1]: a request named "Get" already exists in C / Orders');
    expect((await call('create_requests', { collectionId: collection.id, folderPath: ['Orders', 'New folder'], requests: [{ name: 'A', url: '/a' }, { name: 'B', method: 'FETCH', url: '/b' }] })).error)
      .toMatch(/^requests\[1\]: method must be one of/);
    expect((await call('create_requests', { collectionId: collection.id, requests: [{ url: '/a' }] })).error).toBe('requests[0]: name is required (or pass curl or copyFrom)');
    expect((await call('create_requests', { collectionId: collection.id, requests: [{ name: 'A' }] })).error).toBe('requests[0]: url is required');
    expect((await call('create_requests', { collectionId: collection.id, requests: [{ curl: 'wget x' }] })).error).toBe('requests[0]: curl must be a cURL command starting with "curl"');
    expect((await call('create_requests', { collectionId: collection.id, requests: [{ copyFrom: 'nothing' }] })).error).toBe('requests[0]: No request matches "nothing".');
    expect(mockStorageService.requests.size).toBe(before);
    expect(folderNames(collection.id)).toEqual(['Orders']);

    expect((await call('create_requests', { collectionId: collection.id, requests: [] })).error).toBe('requests must be a non-empty array');
    expect((await call('create_requests', { collectionId: collection.id, requests: Array.from({ length: 51 }, (_, i) => ({ name: `R${i}`, url: '/' })) })).error)
      .toBe('requests can have at most 50 items; split them into several calls');
    expect((await call('create_requests', { requests: [{ name: 'A', url: '/' }] })).error).toBe('Pass collectionId or collection (its name)');
    expect((await call('create_requests', { collection: 'zzz', requests: [{ name: 'A', url: '/' }] })).error).toBe('No collection matches "zzz".');
    expect((await call('create_requests', { collectionId: collection.id, onExists: 'merge', requests: [{ name: 'A', url: '/' }] })).error).toBe('onExists must be one of skip, error, update, create');
  });

  it('MCP-BATCH-003 asks which folder to use when several match, or returns candidates', async () => {
    const collection = await call('create_collection', { name: 'BPP' });
    const optimize = await call('create_folder', { collectionId: collection.id, name: '服务优化' });
    const optimizeV2 = await call('create_folder', { collectionId: collection.id, name: '服务优化v2' });
    const args = { collectionId: collection.id, requests: [{ name: 'Ping', url: '/ping' }] };

    // 有完全同名的文件夹时直接使用
    expect(await call('create_requests', { ...args, folderPath: ['服务优化'] })).toMatchObject({ folderId: optimize.id, created: 1 });

    // 匹配到多个且没法询问：不写入，返回候选，可以改为新建
    const before = mockStorageService.requests.size;
    const ambiguous = JSON.parse((await call('create_requests', { ...args, folderPath: ['服务'] })).error);
    expect(ambiguous).toMatchObject({
      error: 'ambiguous',
      field: 'folderPath[0]',
      input: '服务',
      canCreate: true,
      candidates: [{ id: optimize.id, name: 'BPP / 服务优化' }, { id: optimizeV2.id, name: 'BPP / 服务优化v2' }],
    });
    expect(ambiguous.hint).toContain('"create": true');
    expect(mockStorageService.requests.size).toBe(before);

    // 能询问时请用户选择，最后一项是新建
    const choose = vi.fn(async () => 1);
    expect(await call('create_requests', { ...args, folderPath: ['服务'] }, makeContext({ choose }))).toMatchObject({ folderId: optimizeV2.id });
    expect(choose).toHaveBeenCalledWith({
      tool: 'create_requests',
      message: 'Several folders match "服务".',
      options: ['BPP / 服务优化', 'BPP / 服务优化v2', 'Create new folder "服务" in BPP'],
    });
    expect((await call('create_requests', { ...args, folderPath: ['服务'] }, makeContext({ choose: async () => 'cancel' }))).error)
      .toBe('The user cancelled the selection. Nothing was changed.');
    const created = await call('create_requests', { ...args, folderPath: ['服务'] }, makeContext({ choose: async () => 2 }));
    expect(created.createdFolders).toEqual([{ id: created.folderId, name: '服务' }]);

    // 只有一个相近的文件夹时也请用户在使用它和新建之间选择
    const similar = vi.fn(async () => 0);
    expect(await call('create_requests', { ...args, folderPath: ['优化v'] }, makeContext({ choose: similar }))).toMatchObject({ folderId: optimizeV2.id });
    expect(similar).toHaveBeenCalledWith(expect.objectContaining({
      message: 'A folder similar to "优化v" exists.',
      options: ['BPP / 服务优化v2', 'Create new folder "优化v" in BPP'],
    }));

    // 按候选的 id 或明确新建重新调用
    expect(await call('create_requests', { ...args, folderPath: [{ id: optimizeV2.id }, 'Sub'] })).toMatchObject({ path: 'BPP / 服务优化v2 / Sub', createdFolders: [{ name: 'Sub' }] });
    const forced = await call('create_requests', { ...args, folderPath: [{ name: '服务优化', create: true }] });
    expect(forced.createdFolders).toEqual([{ id: forced.folderId, name: '服务优化' }]);
    expect((await call('create_requests', { ...args, folderPath: [{ id: 'missing' }] })).error).toBe('folderPath[0]: folder missing is not directly inside BPP');
    expect((await call('create_requests', { ...args, folderId: optimize.id, folderPath: ['x'] })).error).toBe('Pass either folderId or folderPath, not both');
  });

  it('MCP-BATCH-004 keeps replaced requests as unsaved edits when staging is on', async () => {
    const collection = await call('create_collection', { name: 'C' });
    const first = await call('create_requests', { collectionId: collection.id, requests: [{ name: 'List', url: '/orders' }] });
    const id = first.requests[0].id;
    const staged = await call('create_requests', {
      collectionId: collection.id, onExists: 'update', requests: [{ name: 'List', url: '/orders/v2' }],
    }, makeContext({ stageEdits: () => true }));
    expect(staged.requests[0]).toMatchObject({ id, status: 'updated', unsavedEdits: true });
    expect(mockStorageService.requests.get(id)!.url).toBe('/orders');
    expect(useRequestsStore().getRequestDraft(id)?.url).toBe('/orders/v2');
  });

  it('MCP-BATCH-005 updates several requests with different or shared changes', async () => {
    const collection = await call('create_collection', { name: 'BPP' });
    const created = await call('create_requests', {
      collectionId: collection.id,
      folderPath: ['Guard'],
      defaults: { headers: [{ key: 'Authorization', value: 'Bearer old' }, { key: 'X-Debug', value: '1' }] },
      requests: [{ name: 'Guard list', url: '/guards' }, { name: 'Guard get', url: '/guards/1' }, { name: 'Health', url: '/health' }],
    });
    const [list, get, health] = created.requests.map((r: any) => r.id);
    const other = (await call('create_requests', { collectionId: collection.id, requests: [{ name: 'Root', url: '/' }] })).requests[0].id;

    const perItem = await call('update_requests', { updates: [{ requestId: list, url: '/v2/guards' }, { request: 'get', method: 'DELETE' }] });
    expect(perItem).toMatchObject({ updated: 2, requests: [{ id: list }, { id: get, method: 'DELETE' }], resolved: [{ field: 'updates[1].request', matched: 'GET Guard get · BPP / Guard' }] });
    expect(mockStorageService.requests.get(list)!.url).toBe('/v2/guards');

    // 同一个改动作用于文件夹中按关键词选出的请求
    const shared = await call('update_requests', {
      collection: 'BPP', folderPath: ['Guard'], query: 'guards',
      mergeHeaders: [{ key: 'authorization', value: 'Bearer {{token}}' }, { key: 'X-Trace', value: 'on' }],
      removeHeaders: ['x-debug'],
      set: { settings: { verifySsl: false } },
    });
    expect(shared.requests.map((r: any) => r.id)).toEqual([list, get]);
    for (const id of [list, get]) {
      const stored = mockStorageService.requests.get(id)!;
      expect(stored.headers.map((h: any) => [h.key, h.value])).toEqual([['authorization', 'Bearer {{token}}'], ['X-Trace', 'on']]);
      expect(stored.settings).toMatchObject({ verifySsl: false });
    }
    expect(mockStorageService.requests.get(health)!.headers.map((h: any) => h.key)).toEqual(['Authorization', 'X-Debug']);
    expect(mockStorageService.requests.get(other)!.headers).toEqual([]);

    const byIds = await call('update_requests', { requestIds: [health, 'Root'], set: { method: 'HEAD' } });
    expect(byIds.requests.map((r: any) => [r.id, r.method])).toEqual([[health, 'HEAD'], [other, 'HEAD']]);

    // 任何一项有误都不写入
    await useRequestsStore().setRequestDraft({ ...mockStorageService.requests.get(get)!, name: 'Draft' });
    expect((await call('update_requests', { updates: [{ requestId: list, url: '/v3' }, { requestId: get, url: '/v3' }] })).error)
      .toBe('updates[1]: This request has unsaved edits in ApiKit. Ask the user to save or discard them first.');
    expect(mockStorageService.requests.get(list)!.url).toBe('/v2/guards');
    expect((await call('update_requests', { updates: [{ requestId: list, method: 'FETCH' }] })).error).toMatch(/^updates\[0\]: method must be one of/);
    expect((await call('update_requests', { updates: [{ requestId: 'missing', url: '/' }] })).error).toBe('updates[0]: Request not found: missing');
    expect((await call('update_requests', { updates: [{ requestId: list }] })).error).toBe('updates[0]: Pass at least one field to update');
    expect((await call('update_requests', { updates: [{ requestId: list, url: '/a' }, { requestId: list, url: '/b' }] })).error).toBe('The same request appears more than once in updates');
    expect((await call('update_requests', { collectionId: collection.id })).error).toBe('Pass set, mergeHeaders and/or removeHeaders');
    expect((await call('update_requests', { collectionId: collection.id, set: { name: 'x' } })).error).toContain('set.name would give every request the same name');
    expect((await call('update_requests', { collectionId: collection.id, query: 'nothing', set: { method: 'GET' } })).error).toBe('No requests in BPP match "nothing"');
    expect((await call('update_requests', { updates: [{ requestId: list, url: '/' }], set: { method: 'GET' } })).error).toContain('Pass either updates');
  });
});

