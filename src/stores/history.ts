import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { storageService } from '@/services/storage';
import type { HistoryItem } from '@/types/models';
import { pruneHistoryItems } from '@/utils/history';

export const useHistoryStore = defineStore('history', () => {
  // State
  const history = ref<HistoryItem[]>([]);
  const isLoading = ref(false);
  let persistenceQueue: Promise<void> = Promise.resolve();

  const persistHistory = (items: HistoryItem[]): Promise<void> => {
    const snapshot = JSON.parse(JSON.stringify(items)) as HistoryItem[];
    const operation = persistenceQueue
      .catch(() => undefined)
      .then(() => storageService.saveHistory(snapshot));
    persistenceQueue = operation;
    return operation;
  };

  // Getters
  const recentHistory = computed(() => {
    return (limit: number = 20) => history.value.slice(0, limit);
  });

  const getHistoryByRequestId = computed(() => {
    return (requestId: string) => {
      return history.value.filter(h => h.requestId === requestId);
    };
  });

  // Actions
  async function loadHistory() {
    isLoading.value = true;
    try {
      const storedHistory = await storageService.loadHistory();
      history.value = pruneHistoryItems(storedHistory);

      if (history.value.length !== storedHistory.length) {
        void persistHistory(history.value).catch(error => {
          console.error('Failed to persist pruned history:', error);
        });
      }
    } catch (e) {
      console.error('Failed to load history:', e);
    } finally {
      isLoading.value = false;
    }
  }

  async function addHistoryItem(item: HistoryItem) {
    history.value = pruneHistoryItems([item, ...history.value]);
    
    try {
      await persistHistory(history.value);
    } catch (e) {
      console.error('Failed to save history:', e);
    }
  }

  async function clearHistory() {
    history.value = [];
    try {
      await persistHistory([]);
    } catch (e) {
      console.error('Failed to clear history:', e);
      throw e;
    }
  }

  async function deleteHistoryItem(id: string) {
    const index = history.value.findIndex(h => h.id === id);
    if (index !== -1) {
      history.value.splice(index, 1);
      try {
        await persistHistory(history.value);
      } catch (e) {
        console.error('Failed to delete history item:', e);
        throw e;
      }
    }
  }

  async function flush() {
    try {
      await persistenceQueue;
    } catch (error) {
      console.error('Failed to flush history:', error);
    }
  }

  return {
    // State
    history,
    isLoading,
    
    // Getters
    recentHistory,
    getHistoryByRequestId,
    
    // Actions
    loadHistory,
    addHistoryItem,
    clearHistory,
    deleteHistoryItem,
    flush,
  };
});
