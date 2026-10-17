import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { storageService } from '@/services/storage';
import { createLogBodyStore, removedLogIds } from '@/services/storage/logBodies';
import type { ConsoleLog, ConsoleLogBody, ConsoleLogSummary } from '@/types/models';
import { hasInlineConsoleBody, isEmptyConsoleLogBody, pruneConsoleLogs, splitConsoleLog } from '@/utils/consoleLogs';
import { createCoalescedPersister } from '@/utils/coalescedPersister';

const EMPTY_BODY: ConsoleLogBody = { requestBody: null, responseBody: '' };

export const useConsoleLogsStore = defineStore('consoleLogs', () => {
  // 内存中只保留摘要，请求体和响应体在 bodies 中按条保存
  const logs = shallowRef<ConsoleLogSummary[]>([]);
  const isLoading = ref(false);
  const bodies = createLogBodyStore('console');
  // 连续发送请求（如 workflow 循环）时合并写入索引，写入时才序列化最新数据
  const persister = createCoalescedPersister<ConsoleLogSummary[]>(nextLogs => storageService.saveConsoleLogs(nextLogs));
  const readLogs = () => logs.value;

  /** 更新列表，并删除被清理掉的日志的 body */
  function replaceLogs(before: ConsoleLogSummary[], next: ConsoleLogSummary[]) {
    logs.value = next;
    bodies.remove(removedLogIds(before, next));
  }

  async function loadLogs() {
    isLoading.value = true;
    try {
      const storedLogs = await storageService.loadConsoleLogs();
      // 旧版本的 body 保存在索引中：拆到各自的文件
      let migrated = false;
      const summaries = storedLogs.map(stored => {
        if (!hasInlineConsoleBody(stored)) return stored;
        migrated = true;
        const { summary, body } = splitConsoleLog(stored);
        if (!isEmptyConsoleLogBody(body)) bodies.save(String(stored.id), body);
        return summary;
      });
      logs.value = pruneConsoleLogs(summaries);
      // 删除被清理掉的日志和崩溃后残留的 body
      bodies.keepOnly(logs.value.map(log => String(log.id)));

      if (migrated) {
        // body 文件写完后再重写索引，中途退出也不会丢失旧日志的 body
        void bodies.flush().then(() => persister.persistNow(readLogs)).catch(error => {
          console.error('Failed to migrate console logs:', error);
        });
      } else if (logs.value.length !== storedLogs.length || logs.value.some((log, index) => log !== storedLogs[index])) {
        persister.schedule(readLogs);
      }
    } catch (error) {
      console.error('Failed to load console logs:', error);
    } finally {
      isLoading.value = false;
    }
  }

  async function addLog(log: ConsoleLog) {
    const { summary, body } = splitConsoleLog(log);
    if (!isEmptyConsoleLogBody(body)) bodies.save(String(log.id), body);
    const before = [summary, ...logs.value];
    replaceLogs(before, pruneConsoleLogs(before));
    persister.schedule(readLogs);
  }

  /** 读取一条日志的请求体和响应体 */
  async function loadLogBody(id: ConsoleLog['id']): Promise<ConsoleLogBody> {
    return (await bodies.load(String(id))) ?? EMPTY_BODY;
  }

  async function clearLogs() {
    logs.value = [];
    bodies.keepOnly([]);
    try {
      await Promise.all([persister.persistNow(readLogs), bodies.flush()]);
    } catch (error) {
      console.error('Failed to clear console logs:', error);
    }
  }

  async function flush() {
    try {
      await Promise.all([persister.flush(), bodies.flush()]);
    } catch (error) {
      console.error('Failed to flush console logs:', error);
    }
  }

  return {
    logs,
    isLoading,
    loadLogs,
    addLog,
    loadLogBody,
    clearLogs,
    flush,
  };
});
