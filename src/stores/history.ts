import { defineStore } from 'pinia';
import { ref, shallowRef, computed } from 'vue';
import { storageService } from '@/services/storage';
import { createLogBodyStore, removedLogIds } from '@/services/storage/logBodies';
import type { HistoryItem } from '@/types/models';
import { hasInlineHistoryBody, pruneHistoryItems, splitHistoryItem } from '@/utils/history';
import { createCoalescedPersister } from '@/utils/coalescedPersister';

export const useHistoryStore = defineStore('history', () => {
  // State：内存中只保留摘要，请求体在 bodies 中按条保存
  const history = shallowRef<HistoryItem[]>([]);
  const isLoading = ref(false);
  const bodies = createLogBodyStore('history');
  // 连续发送请求（如 workflow 循环）时合并写入索引，写入时才序列化最新数据
  const persister = createCoalescedPersister<HistoryItem[]>(items => storageService.saveHistory(items));
  const readHistory = () => history.value;

  // Getters
  const recentHistory = computed(() => {
    return (limit: number = 20) => history.value.slice(0, limit);
  });

  const getHistoryByRequestId = computed(() => {
    return (requestId: string) => {
      return history.value.filter(h => h.requestId === requestId);
    };
  });

  /** 更新列表，并删除被清理掉的记录的请求体 */
  function replaceHistory(before: HistoryItem[], next: HistoryItem[]) {
    history.value = next;
    bodies.remove(removedLogIds(before, next));
  }

  // Actions
  async function loadHistory() {
    isLoading.value = true;
    try {
      const storedHistory = await storageService.loadHistory();
      // 旧版本的请求体保存在索引中：拆到各自的文件
      let migrated = false;
      const summaries = storedHistory.map(stored => {
        if (!hasInlineHistoryBody(stored)) return stored;
        migrated = true;
        const { summary, body } = splitHistoryItem(stored);
        if (body.body) bodies.save(stored.id, body);
        return summary;
      });
      history.value = pruneHistoryItems(summaries);
      // 删除被清理掉的记录和崩溃后残留的请求体
      bodies.keepOnly(history.value.map(item => item.id));

      if (migrated) {
        // 请求体文件写完后再重写索引，中途退出也不会丢失旧记录的请求体
        void bodies.flush().then(() => persister.persistNow(readHistory)).catch(error => {
          console.error('Failed to migrate history:', error);
        });
      } else if (history.value.length !== storedHistory.length || history.value.some((item, index) => item !== storedHistory[index])) {
        persister.schedule(readHistory);
      }
    } catch (e) {
      console.error('Failed to load history:', e);
    } finally {
      isLoading.value = false;
    }
  }

  async function addHistoryItem(item: HistoryItem) {
    const { summary, body } = splitHistoryItem(item);
    if (body.body) bodies.save(item.id, body);
    const before = [summary, ...history.value];
    replaceHistory(before, pruneHistoryItems(before));
    persister.schedule(readHistory);
  }

  /** 读取一条记录的请求体，用来重新打开请求 */
  async function loadRequestBody(id: string): Promise<string | null> {
    return (await bodies.load(id))?.body ?? null;
  }

  async function clearHistory() {
    history.value = [];
    bodies.keepOnly([]);
    try {
      await Promise.all([persister.persistNow(readHistory), bodies.flush()]);
    } catch (e) {
      console.error('Failed to clear history:', e);
      throw e;
    }
  }

  async function deleteHistoryItem(id: string) {
    const next = history.value.filter(h => h.id !== id);
    if (next.length === history.value.length) return;
    replaceHistory(history.value, next);
    try {
      await persister.persistNow(readHistory);
    } catch (e) {
      console.error('Failed to delete history item:', e);
      throw e;
    }
  }

  async function flush() {
    try {
      await Promise.all([persister.flush(), bodies.flush()]);
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
    loadRequestBody,
    clearHistory,
    deleteHistoryItem,
    flush,
  };
});
