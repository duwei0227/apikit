import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { storageService } from '@/services/storage';
import { debounce } from '@/utils/debounce';
import type { AppState } from '@/types/models';

export type ContentTabType = 'request' | 'workflow' | 'mock';

export interface ContentTab {
  type: ContentTabType;
  id: string;
}

export const useAppStateStore = defineStore('appState', () => {
  // State
  const openRequests = ref<string[]>([]);
  const activeRequestIndex = ref(0);
  const openWorkflows = ref<string[]>([]);
  const openMocks = ref<string[]>([]);
  const activeContentIndex = ref(0);
  // 内容页签（请求 + workflow + Mock 服务）的统一显示顺序，元素为 `request:<id>` / `workflow:<id>` / `mock:<id>`
  const tabOrder = ref<string[]>([]);
  const sidebarWidth = ref(320);
  const footerHeight = ref(200);
  const isLoading = ref(true);

  // Debounced save function
  const debouncedSave = debounce(async () => {
    const state: AppState = {
      openRequests: openRequests.value,
      activeRequestIndex: activeRequestIndex.value,
      openWorkflows: openWorkflows.value,
      openMocks: openMocks.value,
      activeContentIndex: activeContentIndex.value,
      tabOrder: tabOrder.value,
      sidebarWidth: sidebarWidth.value,
      footerHeight: footerHeight.value,
      lastSavedAt: new Date().toISOString()
    };
    
    try {
      await storageService.saveAppState(state);
    } catch (e) {
      console.error('Failed to save app state:', e);
    }
  }, 1000);

  const toTabKey = (type: ContentTabType, id: string) => `${type}:${id}`;

  const parseTabKey = (key: string): ContentTab => {
    const separatorIndex = key.indexOf(':');
    return {
      type: key.slice(0, separatorIndex) as ContentTabType,
      id: key.slice(separatorIndex + 1)
    };
  };

  // 让 tabOrder 与已打开的请求/workflow 保持一致：移除已关闭的页签，新打开的页签追加到末尾
  function syncTabOrder() {
    const openKeys = [
      ...openRequests.value.map(id => toTabKey('request', id)),
      ...openWorkflows.value.map(id => toTabKey('workflow', id)),
      ...openMocks.value.map(id => toTabKey('mock', id))
    ];
    const openKeySet = new Set(openKeys);
    const next = tabOrder.value.filter(key => openKeySet.has(key));
    const seen = new Set(next);
    openKeys.forEach(key => {
      if (!seen.has(key)) {
        next.push(key);
        seen.add(key);
      }
    });

    const changed = next.length !== tabOrder.value.length
      || next.some((key, index) => key !== tabOrder.value[index]);
    if (changed) tabOrder.value = next;
  }

  // 同步执行，保证 openRequests/openWorkflows 变化后 contentTabs 立即可用
  watch([openRequests, openWorkflows, openMocks], syncTabOrder, { deep: true, flush: 'sync' });

  const contentTabs = computed<ContentTab[]>(() => tabOrder.value.map(parseTabKey));

  // Watch for changes and auto-save
  watch([openRequests, activeRequestIndex, openWorkflows, openMocks, activeContentIndex, tabOrder, sidebarWidth, footerHeight], () => {
    debouncedSave();
  }, { deep: true });

  // Actions
  async function loadState() {
    isLoading.value = true;
    try {
      const state = await storageService.loadAppState();
      if (state) {
        openRequests.value = state.openRequests || [];
        activeRequestIndex.value = state.activeRequestIndex || 0;
        openWorkflows.value = state.openWorkflows || [];
        openMocks.value = state.openMocks || [];
        // 旧版本状态无 tabOrder 时回退为「请求在前、workflow 在后」
        tabOrder.value = state.tabOrder || [];
        syncTabOrder();
        activeContentIndex.value = state.activeContentIndex ?? activeRequestIndex.value ?? 0;
        sidebarWidth.value = state.sidebarWidth || 320;
        footerHeight.value = state.footerHeight || 200;
      }
    } catch (e) {
      console.error('Failed to load app state:', e);
    } finally {
      isLoading.value = false;
    }
  }

  async function saveState() {
    const state: AppState = {
      openRequests: openRequests.value,
      activeRequestIndex: activeRequestIndex.value,
      openWorkflows: openWorkflows.value,
      openMocks: openMocks.value,
      activeContentIndex: activeContentIndex.value,
      tabOrder: tabOrder.value,
      sidebarWidth: sidebarWidth.value,
      footerHeight: footerHeight.value,
      lastSavedAt: new Date().toISOString()
    };
    
    try {
      await storageService.saveAppState(state);
    } catch (e) {
      console.error('Failed to save app state:', e);
      throw e;
    }
  }

  function updateOpenRequests(requests: string[]) {
    openRequests.value = requests;
  }

  function updateOpenWorkflows(workflows: string[]) {
    openWorkflows.value = workflows;
  }

  function updateOpenMocks(mocks: string[]) {
    openMocks.value = mocks;
  }

  function moveTab(fromIndex: number, toIndex: number) {
    const order = [...tabOrder.value];
    if (fromIndex < 0 || fromIndex >= order.length || toIndex < 0 || toIndex >= order.length) return;
    const [moved] = order.splice(fromIndex, 1);
    order.splice(toIndex, 0, moved);
    tabOrder.value = order;
  }

  // 将页签移动到另一个页签右侧（如复制页签时紧挨原页签）
  function moveTabAfter(tab: ContentTab, afterTab: ContentTab) {
    const key = toTabKey(tab.type, tab.id);
    const order = tabOrder.value.filter(item => item !== key);
    const afterIndex = order.indexOf(toTabKey(afterTab.type, afterTab.id));
    if (afterIndex < 0 || order.length === tabOrder.value.length) return;
    order.splice(afterIndex + 1, 0, key);
    tabOrder.value = order;
  }

  function getContentTabIndex(type: ContentTabType, id: string) {
    return tabOrder.value.indexOf(toTabKey(type, id));
  }

  function setActiveRequest(index: number) {
    if (index === -1) {
      activeRequestIndex.value = -1;
    } else if (index >= 0 && index < openRequests.value.length) {
      activeRequestIndex.value = index;
    }
  }

  function addOpenRequest(requestId: string) {
    if (!openRequests.value.includes(requestId)) {
      openRequests.value.push(requestId);
      activeRequestIndex.value = openRequests.value.length - 1;
    } else {
      // Switch to existing tab
      activeRequestIndex.value = openRequests.value.indexOf(requestId);
    }
    activeContentIndex.value = Math.max(0, getContentTabIndex('request', requestId));
  }

  function setActiveContent(index: number) {
    activeContentIndex.value = Math.max(0, index);
  }

  function removeOpenRequest(requestId: string) {
    const index = openRequests.value.indexOf(requestId);
    if (index !== -1) {
      openRequests.value.splice(index, 1);
      
      // Adjust active index
      if (activeRequestIndex.value >= openRequests.value.length) {
        activeRequestIndex.value = Math.max(0, openRequests.value.length - 1);
      }
    }
  }

  return {
    // State
    openRequests,
    activeRequestIndex,
    openWorkflows,
    openMocks,
    activeContentIndex,
    tabOrder,
    contentTabs,
    sidebarWidth,
    footerHeight,
    isLoading,
    
    // Actions
    loadState,
    saveState,
    updateOpenRequests,
    updateOpenWorkflows,
    updateOpenMocks,
    setActiveRequest,
    setActiveContent,
    moveTab,
    moveTabAfter,
    getContentTabIndex,
    addOpenRequest,
    removeOpenRequest
  };
});
