import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { storageService } from '@/services/storage';
import { debounce } from '@/utils/debounce';
import type { AppState } from '@/types/models';

export const useAppStateStore = defineStore('appState', () => {
  // State
  const openRequests = ref<string[]>([]);
  const activeRequestIndex = ref(0);
  const openWorkflows = ref<string[]>([]);
  const activeContentIndex = ref(0);
  const sidebarWidth = ref(320);
  const footerHeight = ref(200);
  const isLoading = ref(true);

  // Debounced save function
  const debouncedSave = debounce(async () => {
    const state: AppState = {
      openRequests: openRequests.value,
      activeRequestIndex: activeRequestIndex.value,
      openWorkflows: openWorkflows.value,
      activeContentIndex: activeContentIndex.value,
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

  // Watch for changes and auto-save
  watch([openRequests, activeRequestIndex, openWorkflows, activeContentIndex, sidebarWidth, footerHeight], () => {
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
      activeContentIndex: activeContentIndex.value,
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
      activeContentIndex.value = activeRequestIndex.value;
    } else {
      // Switch to existing tab
      activeRequestIndex.value = openRequests.value.indexOf(requestId);
      activeContentIndex.value = activeRequestIndex.value;
    }
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
    activeContentIndex,
    sidebarWidth,
    footerHeight,
    isLoading,
    
    // Actions
    loadState,
    saveState,
    updateOpenRequests,
    updateOpenWorkflows,
    setActiveRequest,
    setActiveContent,
    addOpenRequest,
    removeOpenRequest
  };
});
