// Mock 服务：定义的增删改、启停、处理收到的请求和调用记录。
// 每个服务的定义保存为 mocks/{id}.json（修改后合并写入）；调用记录追加写入 mocks/_logs/{id}.jsonl，
// 每个服务保留最近 100 条，内存中只保留摘要，查看详情时再从文件读取。

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { storageService } from '@/services/storage';
import { createMockVariableResolver, handleMockRequest, type MockRequestEvent } from '@/services/mock/handler';
import type { HttpMethod, MockLogEntry, MockLogSummary, MockResponse, MockService } from '@/types/models';
import { cloneJson } from '@/utils/clone';
import { createMockRoute, duplicateMockService, nextFreeMockPort, normalizeMockService } from '@/utils/mockFactory';
import { matchMockPath, normalizeMockPath } from '@/utils/mockMatching';

export const MAX_MOCK_LOGS = 100;
const SAVE_DELAY_MS = 400;

const summarize = ({ request: _request, response: _response, ...summary }: MockLogEntry): MockLogSummary => summary;

export const useMocksStore = defineStore('mocks', () => {
  const services = ref<MockService[]>([]);
  const isLoading = ref(true);
  /** 正在运行的服务 id */
  const running = ref<Record<string, boolean>>({});
  /** 启动失败的原因 */
  const errors = ref<Record<string, string>>({});
  /** 每个服务的调用记录摘要，最新的在前 */
  const logs = ref<Record<string, MockLogSummary[]>>({});
  /** 侧栏中选中的服务 */
  const activeServiceId = ref<string | null>(null);
  /** 编辑页签以外（如「Save to Mock」）修改服务的次数，打开的编辑页签据此重新载入 */
  const externalRevisions = ref<Record<string, number>>({});

  const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
  // 每个服务的日志写入按顺序执行，避免追加和裁剪交错
  const logQueues = new Map<string, Promise<void>>();
  let unlisten: UnlistenFn | null = null;

  const runningCount = computed(() => Object.values(running.value).filter(Boolean).length);
  const getService = (id: string) => services.value.find(service => service.id === id);
  const baseUrl = (service: Pick<MockService, 'port'>) => `http://127.0.0.1:${service.port}`;

  function enqueueLog(serviceId: string, task: () => Promise<void>) {
    const next = (logQueues.get(serviceId) || Promise.resolve())
      .then(task)
      .catch(error => console.error(`Failed to write mock log ${serviceId}:`, error));
    logQueues.set(serviceId, next);
    return next;
  }

  async function writeService(id: string) {
    pendingSaves.delete(id);
    const service = getService(id);
    if (!service) return;
    try {
      await storageService.saveMockService(cloneJson(service));
    } catch (error) {
      console.error(`Failed to save mock service ${id}:`, error);
    }
  }

  function scheduleSave(id: string) {
    const existing = pendingSaves.get(id);
    if (existing) clearTimeout(existing);
    pendingSaves.set(id, setTimeout(() => void writeService(id), SAVE_DELAY_MS));
  }

  async function flush() {
    const ids = [...pendingSaves.keys()];
    ids.forEach(id => clearTimeout(pendingSaves.get(id)));
    await Promise.all(ids.map(writeService));
    await Promise.all(logQueues.values());
  }

  async function loadLogs(serviceId: string) {
    const entries = await storageService.loadMockLog(serviceId);
    const kept = entries.slice(-MAX_MOCK_LOGS);
    logs.value = { ...logs.value, [serviceId]: kept.map(summarize).reverse() };
    if (kept.length < entries.length) await enqueueLog(serviceId, () => storageService.writeMockLog(serviceId, kept));
  }

  async function loadServices() {
    isLoading.value = true;
    try {
      services.value = (await storageService.loadMockServices())
        .map(normalizeMockService)
        .filter((service): service is MockService => service !== null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      await Promise.all(services.value.map(service => loadLogs(service.id)));
    } finally {
      isLoading.value = false;
    }
  }

  async function start(id: string) {
    const service = getService(id);
    if (!service) return;
    try {
      await invoke('mock_start', { serviceId: id, port: service.port, cors: service.cors });
      running.value = { ...running.value, [id]: true };
      const { [id]: _removed, ...rest } = errors.value;
      errors.value = rest;
    } catch (error) {
      running.value = { ...running.value, [id]: false };
      errors.value = { ...errors.value, [id]: error instanceof Error ? error.message : String(error) };
    }
  }

  async function stop(id: string) {
    try {
      await invoke('mock_stop', { serviceId: id });
    } catch (error) {
      console.error(`Failed to stop mock service ${id}:`, error);
    }
    running.value = { ...running.value, [id]: false };
    const { [id]: _removed, ...rest } = errors.value;
    errors.value = rest;
  }

  async function handleRequest(event: MockRequestEvent) {
    const { reply, log } = handleMockRequest(getService(event.serviceId), event, createMockVariableResolver());
    try {
      await invoke('mock_respond', { id: event.id, reply });
    } catch (error) {
      console.error('Failed to answer mock request:', error);
    }
    addLog(event.serviceId, log);
  }

  /** 与 Rust 端同步运行状态（窗口重新加载后服务可能仍在运行） */
  async function syncStatus() {
    try {
      const status = await invoke<Array<{ serviceId: string }> | null>('mock_status');
      running.value = Object.fromEntries((status || []).map(item => [item.serviceId, true]));
    } catch (error) {
      console.error('Failed to read mock server status:', error);
    }
  }

  /** 监听 Rust 端交来的请求，并启动设为随 ApiKit 启动的服务 */
  async function initialize() {
    if (!unlisten) {
      unlisten = await listen<MockRequestEvent>('mock://request', event => void handleRequest(event.payload));
    }
    await syncStatus();
    await Promise.all(services.value
      .filter(service => service.autoStart && !running.value[service.id])
      .map(service => start(service.id)));
  }

  async function createService(service: MockService) {
    services.value = [...services.value, service];
    logs.value = { ...logs.value, [service.id]: [] };
    await storageService.saveMockService(cloneJson(service));
    return service;
  }

  /** 修改服务定义；端口或 CORS 变化时重启正在运行的服务 */
  async function updateService(next: MockService) {
    const previous = getService(next.id);
    if (!previous) return;
    const updated = { ...next, updatedAt: new Date().toISOString() };
    services.value = services.value.map(service => (service.id === next.id ? updated : service));
    scheduleSave(next.id);
    if (running.value[next.id] && (previous.port !== next.port || previous.cors !== next.cors)) {
      await start(next.id);
    }
  }

  /**
   * 把一个响应加到服务中：已有相同方法、路径的路由时加到它下面，否则新建路由。
   * isDefault 为 true 时取消同一路由中其它响应的默认标记。
   */
  async function addResponse(serviceId: string, method: HttpMethod, path: string, response: MockResponse) {
    const service = getService(serviceId);
    if (!service) return null;
    const next = cloneJson(service);
    const normalizedPath = normalizeMockPath(path);
    let route = next.routes.find(item => item.method === method && normalizeMockPath(item.path) === normalizedPath);
    if (!route) {
      route = createMockRoute({ method, path: normalizedPath, responses: [] });
      next.routes.push(route);
    }
    if (response.isDefault || route.responses.length === 0) {
      route.responses.forEach(item => { item.isDefault = false; });
      response.isDefault = true;
    }
    route.responses.push(response);
    await updateService(next);
    externalRevisions.value = { ...externalRevisions.value, [serviceId]: (externalRevisions.value[serviceId] || 0) + 1 };
    return route;
  }

  /** 服务中与这个路径匹配的路由（用于「Save to Mock」预选） */
  function findRouteFor(serviceId: string, method: HttpMethod, path: string) {
    return getService(serviceId)?.routes.find(route => route.method === method && matchMockPath(route.path, path)) || null;
  }

  async function deleteService(id: string) {
    if (running.value[id]) await stop(id);
    const pending = pendingSaves.get(id);
    if (pending) clearTimeout(pending);
    pendingSaves.delete(id);
    await logQueues.get(id);
    logQueues.delete(id);
    services.value = services.value.filter(service => service.id !== id);
    const { [id]: _logs, ...restLogs } = logs.value;
    logs.value = restLogs;
    const { [id]: _running, ...restRunning } = running.value;
    running.value = restRunning;
    await storageService.deleteMockService(id);
  }

  async function duplicateService(id: string) {
    const service = getService(id);
    if (!service) return null;
    return createService(duplicateMockService(service, `${service.name} (Copy)`, nextFreeMockPort(services.value)));
  }

  function addLog(serviceId: string, entry: MockLogEntry) {
    if (!getService(serviceId)) return;
    const current = logs.value[serviceId] || [];
    const next = [summarize(entry), ...current];
    const overflow = next.length > MAX_MOCK_LOGS;
    logs.value = { ...logs.value, [serviceId]: next.slice(0, MAX_MOCK_LOGS) };
    void enqueueLog(serviceId, async () => {
      await storageService.appendMockLog(serviceId, entry);
      if (overflow) {
        const entries = await storageService.loadMockLog(serviceId);
        await storageService.writeMockLog(serviceId, entries.slice(-MAX_MOCK_LOGS));
      }
    });
  }

  async function loadLogEntry(serviceId: string, logId: string): Promise<MockLogEntry | null> {
    await logQueues.get(serviceId);
    const entries = await storageService.loadMockLog(serviceId);
    return entries.find(entry => entry.id === logId) || null;
  }

  async function clearLogs(serviceId: string) {
    logs.value = { ...logs.value, [serviceId]: [] };
    await enqueueLog(serviceId, () => storageService.writeMockLog(serviceId, []));
  }

  return {
    services,
    isLoading,
    running,
    errors,
    logs,
    runningCount,
    activeServiceId,
    externalRevisions,
    addResponse,
    findRouteFor,
    getService,
    baseUrl,
    loadServices,
    initialize,
    syncStatus,
    start,
    stop,
    createService,
    updateService,
    deleteService,
    duplicateService,
    addLog,
    loadLogEntry,
    clearLogs,
    handleRequest,
    flush,
  };
});
