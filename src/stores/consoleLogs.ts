import { defineStore } from 'pinia';
import { ref } from 'vue';
import { storageService } from '@/services/storage';
import type { ConsoleLog } from '@/types/models';
import { pruneConsoleLogs } from '@/utils/consoleLogs';

export const useConsoleLogsStore = defineStore('consoleLogs', () => {
  const logs = ref<ConsoleLog[]>([]);
  const isLoading = ref(false);
  let persistenceQueue: Promise<void> = Promise.resolve();

  const persistLogs = (nextLogs: ConsoleLog[]): Promise<void> => {
    const snapshot = JSON.parse(JSON.stringify(nextLogs)) as ConsoleLog[];
    const operation = persistenceQueue
      .catch(() => undefined)
      .then(() => storageService.saveConsoleLogs(snapshot));
    persistenceQueue = operation;
    return operation;
  };

  async function loadLogs() {
    isLoading.value = true;
    try {
      const storedLogs = await storageService.loadConsoleLogs();
      logs.value = pruneConsoleLogs(storedLogs);

      if (logs.value.length !== storedLogs.length) {
        void persistLogs(logs.value).catch(error => {
          console.error('Failed to persist pruned console logs:', error);
        });
      }
    } catch (error) {
      console.error('Failed to load console logs:', error);
    } finally {
      isLoading.value = false;
    }
  }

  async function addLog(log: ConsoleLog) {
    logs.value = pruneConsoleLogs([log, ...logs.value]);
    try {
      await persistLogs(logs.value);
    } catch (error) {
      console.error('Failed to save console logs:', error);
    }
  }

  async function clearLogs() {
    logs.value = [];
    try {
      await persistLogs([]);
    } catch (error) {
      console.error('Failed to clear console logs:', error);
    }
  }

  async function flush() {
    try {
      await persistenceQueue;
    } catch (error) {
      console.error('Failed to flush console logs:', error);
    }
  }

  return {
    logs,
    isLoading,
    loadLogs,
    addLog,
    clearLogs,
    flush,
  };
});
