import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { handleMockRequest, renderMockReply, type MockRequestEvent } from '@/services/mock/handler';
import { MAX_MOCK_LOGS, useMocksStore } from '@/stores/mocks';
import { useEnvironmentsStore } from '@/stores/environments';
import type { MockService } from '@/types/models';
import { createMockResponse, createMockRoute, createMockRule, createMockService, normalizeMockService } from '@/utils/mockFactory';
import { buildMockRequestData } from '@/utils/mockMatching';
import { mockStorageService } from '../helpers/mockStorage';

const invokeMock = vi.mocked(invoke);
let replies: Array<{ id: string; reply: any }>;

const event = (path: string, extra: Partial<MockRequestEvent> = {}): MockRequestEvent => ({
  id: `call-${Math.random()}`,
  serviceId: 'svc',
  method: 'GET',
  path,
  query: '',
  headers: [],
  body: '',
  ...extra,
});

const shopService = (): MockService => createMockService({
  id: 'svc',
  name: 'Shop',
  port: 3101,
  defaultDelayMs: 50,
  routes: [
    createMockRoute({
      method: 'GET',
      path: '/orders/:id',
      responses: [
        createMockResponse({
          name: 'Not found',
          status: 404,
          rules: [createMockRule({ source: 'path', key: 'id', operator: 'equals', value: '0' })],
          body: '{"error":"Order {{$request.params.id}} not found"}',
          delayMs: 0,
        }),
        createMockResponse({
          name: 'Order',
          isDefault: true,
          headers: [{ key: 'X-Base', value: '{{baseUrl}}', enabled: true }, { key: 'X-Off', value: '1', enabled: false }],
          body: '{"id": {{$request.params.id}}}',
        }),
      ],
    }),
  ],
});

describe('mock request handling', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    replies = [];
    invokeMock.mockImplementation(async (command: string, payload: any) => {
      if (command === 'mock_respond') replies.push(payload);
      return null;
    });
  });

  it('answers with the matching response and logs the call', () => {
    useEnvironmentsStore().setGlobalVariable('baseUrl', 'https://api.example.com', true);
    const service = shopService();
    const ok = handleMockRequest(service, event('/orders/42'), name => (name === 'baseUrl' ? 'https://api.example.com' : undefined));
    expect(ok.reply).toEqual({
      status: 200,
      headers: [['X-Base', 'https://api.example.com'], ['content-type', 'application/json']],
      body: '{"id": 42}',
      delayMs: 50,
    });
    expect(ok.log).toMatchObject({ method: 'GET', path: '/orders/42', status: 200, route: 'GET /orders/:id', responseName: 'Order' });

    const missing = handleMockRequest(service, event('/orders/0'), () => undefined);
    expect(missing.reply).toMatchObject({ status: 404, body: '{"error":"Order 0 not found"}', delayMs: 0 });
  });

  it('explains unmatched calls', () => {
    const service = shopService();
    expect(handleMockRequest(service, event('/refunds'), () => undefined)).toMatchObject({
      reply: { status: 404, body: JSON.stringify({ error: 'No route matches GET /refunds' }) },
      log: { reason: 'No route matches GET /refunds', route: undefined },
    });
    service.routes[0].responses = service.routes[0].responses.slice(0, 1);
    expect(handleMockRequest(service, event('/orders/5'), () => undefined).log.reason)
      .toBe('GET /orders/:id has no response for this request');
    expect(handleMockRequest(undefined, event('/x'), () => undefined).reply.status).toBe(503);
  });

  it('uses a text content type for text bodies and keeps an explicit one', () => {
    const request = buildMockRequestData({ method: 'GET', path: '/', query: '', headers: [], body: '' });
    expect(renderMockReply(createMockResponse({ bodyMode: 'text', body: 'hi' }), { defaultDelayMs: 0 }, request, () => undefined).headers)
      .toEqual([['content-type', 'text/plain; charset=utf-8']]);
    const xml = createMockResponse({ headers: [{ key: 'Content-Type', value: 'application/xml', enabled: true }] });
    expect(renderMockReply(xml, { defaultDelayMs: 0 }, request, () => undefined).headers).toEqual([['Content-Type', 'application/xml']]);
    expect(renderMockReply(createMockResponse({ status: 42 }), { defaultDelayMs: 0 }, request, () => undefined).status).toBe(500);
  });

  it('replies through Rust, appends logs to the file and keeps the latest 100', async () => {
    const store = useMocksStore();
    await store.createService(shopService());
    await store.handleRequest(event('/orders/1', { id: 'c1' }));
    expect(replies).toEqual([{ id: 'c1', reply: expect.objectContaining({ status: 200 }) }]);
    expect(store.logs.svc[0]).toMatchObject({ path: '/orders/1', status: 200 });
    expect(store.logs.svc[0]).not.toHaveProperty('request');

    for (let i = 2; i <= MAX_MOCK_LOGS + 5; i++) store.addLog('svc', handleMockRequest(store.getService('svc'), event(`/orders/${i}`), () => undefined).log);
    await store.flush();
    expect(store.logs.svc).toHaveLength(MAX_MOCK_LOGS);
    expect(store.logs.svc[0].path).toBe(`/orders/${MAX_MOCK_LOGS + 5}`);
    const saved = mockStorageService.mockLogs.get('svc')!;
    expect(saved).toHaveLength(MAX_MOCK_LOGS);
    expect(saved[saved.length - 1].path).toBe(`/orders/${MAX_MOCK_LOGS + 5}`);

    const detail = await store.loadLogEntry('svc', store.logs.svc[0].id);
    expect(detail?.response.body).toBe(`{"id": ${MAX_MOCK_LOGS + 5}}`);

    await store.clearLogs('svc');
    expect(store.logs.svc).toEqual([]);
    expect(mockStorageService.mockLogs.get('svc')).toEqual([]);
  });

  it('loads services and their logs, and trims logs written by older runs', async () => {
    const service = shopService();
    await mockStorageService.saveMockService(service);
    const entry = handleMockRequest(service, event('/orders/1'), () => undefined).log;
    await mockStorageService.writeMockLog('svc', Array.from({ length: MAX_MOCK_LOGS + 3 }, (_, i) => ({ ...entry, id: `l${i}` })));
    const store = useMocksStore();
    await store.loadServices();
    expect(store.services.map(item => item.name)).toEqual(['Shop']);
    expect(store.logs.svc).toHaveLength(MAX_MOCK_LOGS);
    expect(store.logs.svc[0].id).toBe(`l${MAX_MOCK_LOGS + 2}`);
    await store.flush();
    expect(mockStorageService.mockLogs.get('svc')).toHaveLength(MAX_MOCK_LOGS);
  });

  it('starts and stops services, restarting when the port changes', async () => {
    const store = useMocksStore();
    await store.createService(shopService());
    await store.start('svc');
    expect(store.running.svc).toBe(true);
    await store.updateService({ ...store.getService('svc')!, port: 3200 });
    expect(invokeMock).toHaveBeenCalledWith('mock_start', { serviceId: 'svc', port: 3200, cors: true });
    await store.stop('svc');
    expect(store.running.svc).toBe(false);

    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'mock_start') throw 'Port 3200 is unavailable: in use';
      return null;
    });
    await store.start('svc');
    expect(store.errors.svc).toBe('Port 3200 is unavailable: in use');
    expect(store.runningCount).toBe(0);
  });

  it('saves edits, duplicates and deletes services', async () => {
    const store = useMocksStore();
    await store.createService(shopService());
    await store.updateService({ ...store.getService('svc')!, name: 'Renamed' });
    await store.flush();
    expect(mockStorageService.mockServices.get('svc')?.name).toBe('Renamed');

    const copy = await store.duplicateService('svc');
    expect(copy).toMatchObject({ name: 'Renamed (Copy)', port: 3001 });
    expect(copy!.routes[0].id).not.toBe(store.getService('svc')!.routes[0].id);

    await store.deleteService('svc');
    expect(store.getService('svc')).toBeUndefined();
    expect(mockStorageService.mockServices.has('svc')).toBe(false);
  });

  it('normalizes stored services', () => {
    expect(normalizeMockService({ id: 'a', port: 99999, routes: [{ method: 'get', path: 'x/', responses: [{ status: 9, bodyMode: 'bad' }] }] }))
      .toMatchObject({ port: 3001, cors: true, routes: [{ method: 'GET', path: '/x', enabled: true, responses: [{ status: 200, bodyMode: 'json', delayMs: null }] }] });
    expect(normalizeMockService({ name: 'no id' })).toBeNull();
  });
});
