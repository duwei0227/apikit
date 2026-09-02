<script setup>
import { defineAsyncComponent, ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import { useAppStateStore } from '@/stores/appState';
import { useHistoryStore } from '@/stores/history';
import { useWorkflowsStore } from '@/stores/workflows';
import { generateId } from '@/utils/id-generator';
import { createDefaultTestConfig } from '@/utils/requestTests';
import {
  createTemporaryRequest,
  createTemporaryRequestFromHistory,
} from '@/utils/temporaryRequest';
import AsyncPanelLoader from './AsyncPanelLoader.vue';
import EnvironmentManager from './EnvironmentManager.vue';
import HistoryPanel from './HistoryPanel.vue';
import CollectionsPanel from './CollectionsPanel.vue';
import WorkflowsPanel from './WorkflowsPanel.vue';

const HttpRequestWrapper = defineAsyncComponent({
  loader: () => import('./HttpRequestWrapper.vue'),
  loadingComponent: AsyncPanelLoader,
  delay: 0,
});
const WorkflowWorkspace = defineAsyncComponent({
  loader: () => import('./WorkflowWorkspace.vue'),
  loadingComponent: AsyncPanelLoader,
  delay: 0,
});

const emit = defineEmits(['add-console-log', 'ready']);

// Stores
const collectionsStore = useCollectionsStore();
const requestsStore = useRequestsStore();
const appStateStore = useAppStateStore();
const historyStore = useHistoryStore();
const workflowsStore = useWorkflowsStore();

const activeTab = ref(1);
const searchQuery = ref('');
const toolbarMenu = ref();
const tabContextMenu = ref();
const selectedTabIndex = ref(-1);
const environmentManagerRef = ref(null);
const collectionsPanelRef = ref(null);
const requestWrapperRefs = ref({});
const workflowWorkspaceRef = ref(null);
const contentTabsRoot = ref(null);
const showWorkflowWorkspace = ref(false);
const mountedWorkflowId = ref(null);
const mountedRequestIds = ref([]);
const workflowUnsavedChangesMap = ref({});

// Sidebar resize state
const INITIAL_SIDEBAR_WIDTH = 320; // 初始宽度 (w-80 = 320px)
const COLLAPSE_THRESHOLD = INITIAL_SIDEBAR_WIDTH * 0.4; // 收起阈值：初始宽度的40%（缩小60%）= 128px
const MIN_SIDEBAR_WIDTH = Math.max(COLLAPSE_THRESHOLD - 50, 100); // 最小宽度设置为收起阈值以下，确保能触发收起
const sidebarWidth = ref(INITIAL_SIDEBAR_WIDTH);
const sidebarCollapsed = ref(false);
const isResizing = ref(false);
const maxSidebarWidth = ref(800); // 默认最大宽度，会在 mounted 时计算

// Calculate max sidebar width (40% of window width)
const updateMaxSidebarWidth = () => {
  maxSidebarWidth.value = Math.floor(window.innerWidth * 0.4);
};

// Handle sidebar resize
const startResize = (event) => {
  if (sidebarCollapsed.value) return;
  isResizing.value = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
};

const handleResize = (event) => {
  if (!isResizing.value) return;
  
  const newWidth = event.clientX;
  
  // 限制宽度范围
  if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= maxSidebarWidth.value) {
    sidebarWidth.value = newWidth;
    
    // 检查是否需要自动收起
    if (newWidth < COLLAPSE_THRESHOLD) {
      sidebarCollapsed.value = true;
      isResizing.value = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }
};

const stopResize = () => {
  isResizing.value = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
};

// Toggle sidebar collapse
const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  if (!sidebarCollapsed.value) {
    // 展开时恢复到初始宽度
    sidebarWidth.value = INITIAL_SIDEBAR_WIDTH;
  }
};

// Use store state
const openRequests = computed(() => appStateStore.openRequests);
const activeRequestIndex = computed({
  get: () => appStateStore.activeRequestIndex,
  set: (value) => appStateStore.setActiveRequest(value)
});

const openWorkflowTabs = computed({
  get: () => appStateStore.openWorkflows,
  set: (value) => appStateStore.updateOpenWorkflows(value)
});

const activeContentIndex = computed({
  get: () => appStateStore.activeContentIndex,
  set: (value) => appStateStore.setActiveContent(value)
});

// Get the active request object from the active HttpRequestWrapper component
const activeRequest = computed(() => {
  if (activeRequestIndex.value >= 0 && openRequests.value[activeRequestIndex.value]) {
    const requestId = openRequests.value[activeRequestIndex.value];
    const wrapperRef = requestWrapperRefs.value[requestId];
    
    // 从 HttpRequestWrapper 组件获取实时的 request 对象
    if (wrapperRef && wrapperRef.request) {
      // 如果是 ref，需要解包
      const req = wrapperRef.request.__v_isRef ? wrapperRef.request.value : wrapperRef.request;
      return req;
    }
    // 如果组件还没加载，从 store 获取
    return requestsStore.requests.get(requestId) || null;
  }
  return null;
});

const contentTabs = computed(() => [
  ...openRequests.value.map(id => ({ type: 'request', id })),
  ...openWorkflowTabs.value.map(id => ({ type: 'workflow', id }))
]);

const activeContentTab = computed(() => contentTabs.value[activeContentIndex.value] || null);
const mountedOpenRequestIds = computed(() => {
  const openIds = new Set(openRequests.value);
  return mountedRequestIds.value.filter(id => openIds.has(id));
});

const ensureRequestMounted = (requestId) => {
  if (!requestId || mountedRequestIds.value.includes(requestId)) return;
  mountedRequestIds.value = [...mountedRequestIds.value, requestId];
};

const removeMountedRequest = (requestId) => {
  if (!requestId) return;
  mountedRequestIds.value = mountedRequestIds.value.filter(id => id !== requestId);
  delete requestWrapperRefs.value[requestId];
};

const setRequestWrapperRef = (requestId, instance) => {
  if (instance) {
    requestWrapperRefs.value[requestId] = instance;
  } else {
    delete requestWrapperRefs.value[requestId];
  }
};

const waitForRequestWrapper = async (requestId, timeoutMs = 3000) => {
  const deadline = performance.now() + timeoutMs;

  while (performance.now() < deadline) {
    const wrapper = requestWrapperRefs.value[requestId];
    if (wrapper) return wrapper;
    await nextTick();
    await new Promise(resolve => setTimeout(resolve, 16));
  }

  return requestWrapperRefs.value[requestId] || null;
};

// Some request entry points (for example cURL import and console history) update
// the shared app state directly. Keep the mounted workspace in sync so those
// paths get the same persistent-component behavior as clicks on the content tabs.
watch(
  () => {
    const tab = activeContentTab.value;
    return tab ? `${tab.type}:${tab.id}` : null;
  },
  () => {
    const tab = activeContentTab.value;
    if (!tab) {
      showWorkflowWorkspace.value = false;
      return;
    }

    if (tab.type === 'request') {
      ensureRequestMounted(tab.id);
      showWorkflowWorkspace.value = false;
      return;
    }

    mountedWorkflowId.value = tab.id;
    showWorkflowWorkspace.value = true;
  },
  { immediate: true }
);

const getWorkflowName = (workflowId) => {
  return workflowsStore.getWorkflowDraft(workflowId)?.name
    || workflowsStore.workflows.find(workflow => workflow.id === workflowId)?.name
    || 'Untitled Workflow';
};

const findContentTabIndex = (type, id) => {
  return contentTabs.value.findIndex(tab => tab.type === type && tab.id === id);
};

const scrollContentTabIntoView = async (index) => {
  await nextTick();
  const tabElement = contentTabsRoot.value?.querySelector(`[data-content-tab-index="${index}"]`);
  if (!tabElement) return;

  tabElement.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest',
    inline: 'center'
  });
};

const selectContentTab = (index) => {
  const nextIndex = Number(index);
  activeContentIndex.value = nextIndex;
  const tab = contentTabs.value[nextIndex];
  if (!tab) {
    showWorkflowWorkspace.value = false;
    appStateStore.setActiveRequest(-1);
    return;
  }

  if (tab.type === 'request') {
    ensureRequestMounted(tab.id);
    const requestIndex = openRequests.value.indexOf(tab.id);
    appStateStore.setActiveRequest(requestIndex);
    showWorkflowWorkspace.value = false;
  } else {
    appStateStore.setActiveRequest(-1);
    workflowsStore.activeWorkflowId = tab.id;
    mountedWorkflowId.value = tab.id;
    showWorkflowWorkspace.value = true;
  }

  scrollContentTabIntoView(nextIndex);
};

// ==================== Tab 拖拽排序 ====================
const draggingTabIndex = ref(null);
const dragOverTabIndex = ref(null);

const onTabDragStart = (event, index) => {
  draggingTabIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    // 部分浏览器要求设置数据才会触发拖拽
    event.dataTransfer.setData('text/plain', String(index));
  }
};

const onTabDragOver = (event, index) => {
  if (draggingTabIndex.value === null) return;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dragOverTabIndex.value = index;
};

const onTabDrop = (event, index) => {
  if (draggingTabIndex.value === null) return;
  reorderContentTabs(draggingTabIndex.value, index);
  draggingTabIndex.value = null;
  dragOverTabIndex.value = null;
};

const onTabDragEnd = () => {
  draggingTabIndex.value = null;
  dragOverTabIndex.value = null;
};

// 将拖拽的 tab 从 fromIndex 移动到 toIndex，并写回到底层数组
const reorderContentTabs = (fromIndex, toIndex) => {
  if (fromIndex === toIndex || fromIndex === null || toIndex === null) return;

  // 记录当前激活的 tab，排序后保持选中
  const activeTab = contentTabs.value[activeContentIndex.value] || null;

  const tabs = [...contentTabs.value];
  const [moved] = tabs.splice(fromIndex, 1);
  tabs.splice(toIndex, 0, moved);

  // contentTabs 由 openRequests + openWorkflows 拼接而成，
  // 拆分回各自数组时保持新的相对顺序（同类型内可任意排序）
  const newRequests = tabs.filter(t => t.type === 'request').map(t => t.id);
  const newWorkflows = tabs.filter(t => t.type === 'workflow').map(t => t.id);

  appStateStore.updateOpenRequests(newRequests);
  appStateStore.updateOpenWorkflows(newWorkflows);

  // 重新定位激活 tab，避免排序后选中错乱
  nextTick(() => {
    if (activeTab) {
      const newIndex = findContentTabIndex(activeTab.type, activeTab.id);
      if (newIndex >= 0) selectContentTab(newIndex);
    }
  });
};

const openWorkflowTab = (workflowId) => {
  if (!openWorkflowTabs.value.includes(workflowId)) {
    openWorkflowTabs.value = [...openWorkflowTabs.value, workflowId];
  }
  workflowUnsavedChangesMap.value[workflowId] = Boolean(workflowsStore.getWorkflowDraft(workflowId));
  nextTick(() => {
    const index = findContentTabIndex('workflow', workflowId);
    if (index >= 0) selectContentTab(index);
  });
};

const createNewWorkflow = async () => {
  const workflow = await workflowsStore.createWorkflow(`Workflow ${workflowsStore.workflows.length + 1}`);
  openWorkflowTab(workflow.id);
};

const closeWorkflowTab = (workflowId) => {
  const contentIndex = findContentTabIndex('workflow', workflowId);
  if (contentIndex < 0) return;

  const activeIndexBeforeClose = activeContentIndex.value;
  const wasActive = activeContentTab.value?.type === 'workflow' && activeContentTab.value.id === workflowId;
  openWorkflowTabs.value = openWorkflowTabs.value.filter(id => id !== workflowId);
  delete workflowUnsavedChangesMap.value[workflowId];
  workflowsStore.clearWorkflowDraft(workflowId);
  if (mountedWorkflowId.value === workflowId) {
    mountedWorkflowId.value = null;
  }

  if (contentTabs.value.length === 0) {
    selectContentTab(0);
    return;
  }

  if (wasActive) {
    const nextIndex = Math.min(contentIndex, contentTabs.value.length - 1);
    selectContentTab(nextIndex);
  } else if (contentIndex < activeIndexBeforeClose) {
    selectContentTab(activeIndexBeforeClose - 1);
  }
};

const saveWorkflowById = async (workflowId) => {
  if (workflowWorkspaceRef.value && activeContentTab.value?.type === 'workflow' && activeContentTab.value.id === workflowId) {
    await workflowWorkspaceRef.value.saveCurrentWorkflow();
    return;
  }

  const draft = workflowsStore.getWorkflowDraft(workflowId);
  if (draft) {
    await workflowsStore.saveWorkflow(draft);
    workflowUnsavedChangesMap.value[workflowId] = false;
  }
};

const restoreWorkflowById = async (workflowId) => {
  if (workflowWorkspaceRef.value && activeContentTab.value?.type === 'workflow' && activeContentTab.value.id === workflowId) {
    await workflowWorkspaceRef.value.restoreOriginalWorkflow();
    return;
  }

  await workflowsStore.restoreWorkflowDraft(workflowId);
  workflowUnsavedChangesMap.value[workflowId] = false;
};

const clearWorkflowTabs = () => {
  openWorkflowTabs.value.forEach(id => workflowsStore.clearWorkflowDraft(id));
  openWorkflowTabs.value = [];
  mountedWorkflowId.value = null;
  showWorkflowWorkspace.value = false;
  workflowUnsavedChangesMap.value = {};
};

const discardRequestDraft = async (requestId) => {
  const wrapperRef = requestWrapperRefs.value[requestId];
  if (wrapperRef && typeof wrapperRef.restoreOriginalRequest === 'function') {
    console.log('[MainContent] Discarding changes for request:', requestId);
    await wrapperRef.restoreOriginalRequest();
  } else {
    // 标签未挂载时，直接在 store 层丢弃草稿（删除暂存编辑并载回已保存版本）
    await requestsStore.discardRequestDraft(requestId);
  }
  delete unsavedChangesMap.value[requestId];
};

const discardWorkflowDraft = async (workflowId) => {
  await restoreWorkflowById(workflowId);
  delete workflowUnsavedChangesMap.value[workflowId];
};

const discardUnsavedDrafts = async (requestIds = [], workflowIds = []) => {
  for (const requestId of requestIds) {
    await discardRequestDraft(requestId);
  }
  for (const workflowId of workflowIds) {
    await discardWorkflowDraft(workflowId);
  }
};

const confirmDiscardTabs = (unsavedCount, acceptLabel, onAccept) => {
  if (unsavedCount <= 0 || !window.$confirm) {
    return onAccept();
  }

  return new Promise((resolve) => {
    let handled = false;
    window.$confirm.require({
      message: `You have ${unsavedCount} tab(s) with unsaved changes. Do you want to discard the changes and close them?`,
      header: 'Unsaved Changes',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel,
      rejectLabel: 'Cancel',
      acceptClass: 'p-button-danger',
      accept: async () => {
        handled = true;
        await onAccept();
        resolve(true);
      },
      reject: () => {
        handled = true;
        resolve(false);
      },
      onHide: () => {
        if (!handled) resolve(false);
      }
    });
  });
};

const closeContentTab = async (tab, contentIndex) => {
  if (tab.type === 'request') {
    const requestIndex = openRequests.value.indexOf(tab.id);
    if (requestIndex >= 0) {
      await closeRequest(requestIndex);
      await nextTick();
      activeContentIndex.value = Math.min(contentIndex, Math.max(0, contentTabs.value.length - 1));
      selectContentTab(activeContentIndex.value);
    }
  } else {
    if (hasWorkflowUnsavedChanges(tab.id) && window.$confirm) {
      return new Promise((resolve) => {
        let handled = false;
        window.$confirm.require({
          message: 'You have unsaved workflow changes. What would you like to do?',
          header: 'Unsaved Changes',
          icon: 'pi pi-exclamation-triangle',
          acceptLabel: 'Save',
          rejectLabel: 'Discard',
          acceptClass: 'p-button-success',
          rejectClass: 'p-button-danger',
          accept: async () => {
            handled = true;
            await saveWorkflowById(tab.id);
            closeWorkflowTab(tab.id);
            resolve(true);
          },
          reject: async () => {
            handled = true;
            await restoreWorkflowById(tab.id);
            closeWorkflowTab(tab.id);
            resolve(true);
          },
          onHide: () => {
            if (!handled) resolve(false);
          }
        });
      });
    } else {
      closeWorkflowTab(tab.id);
    }
  }
};

const toolbarMenuModel = ref([
  {
    label: 'Close All Tabs',
    icon: 'pi pi-times',
    command: () => handleToolbarAction('closeAllTabs')
  },
  {
    label: 'Close All Saved Tabs',
    icon: 'pi pi-check-circle',
    command: () => handleToolbarAction('closeAllSavedTabs')
  }
]);

const tabContextMenuModel = ref([
  {
    label: 'Duplicate Tab',
    icon: 'pi pi-copy',
    command: () => handleTabAction('duplicate')
  },
  { separator: true },
  {
    label: 'Close',
    icon: 'pi pi-times',
    command: () => handleTabAction('close')
  },
  {
    label: 'Close Other Tabs',
    icon: 'pi pi-times-circle',
    command: () => handleTabAction('closeOthers')
  },
  {
    label: 'Close All Tabs',
    icon: 'pi pi-times',
    command: () => handleTabAction('closeAll')
  },
  {
    label: 'Close All Saved Tabs',
    icon: 'pi pi-check-circle',
    command: () => handleTabAction('closeAllSaved')
  }
]);

const showToolbarMenu = (event) => {
  toolbarMenu.value.show(event);
};

const handleToolbarAction = async (action) => {
  switch(action) {
    case 'closeAllTabs':
      await closeAllTabs();
      break;
    case 'closeAllSavedTabs':
      await closeAllSavedTabs();
      break;
  }
};

const showTabContextMenu = (event, index) => {
  event.preventDefault();
  selectedTabIndex.value = index;
  tabContextMenu.value.show(event);
};

const duplicateRequestTab = async (requestTab) => {
  const requestIndex = openRequests.value.indexOf(requestTab.id);
  const originalRequest = await requestsStore.loadRequest(requestTab.id);
  if (!originalRequest) return;

  const duplicatedRequest = {
    ...originalRequest,
    id: generateId(),
    name: `${originalRequest.name} (Copy)`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const requests = [...openRequests.value];
  await requestsStore.saveRequest(duplicatedRequest);
  requests.splice(requestIndex + 1, 0, duplicatedRequest.id);
  appStateStore.updateOpenRequests(requests);
  appStateStore.setActiveRequest(requestIndex + 1);
  await nextTick();
  const index = findContentTabIndex('request', duplicatedRequest.id);
  if (index >= 0) selectContentTab(index);
};

const duplicateWorkflowTab = async (workflowTab) => {
  const workflow = workflowsStore.getWorkflowDraft(workflowTab.id)
    || workflowsStore.workflows.find(item => item.id === workflowTab.id);
  if (!workflow) return;

  const now = new Date().toISOString();
  const duplicatedWorkflow = JSON.parse(JSON.stringify(workflow));
  duplicatedWorkflow.id = generateId();
  duplicatedWorkflow.name = `${workflow.name} (Copy)`;
  duplicatedWorkflow.createdAt = now;
  duplicatedWorkflow.updatedAt = now;

  await workflowsStore.saveWorkflow(duplicatedWorkflow);
  const workflowIndex = openWorkflowTabs.value.indexOf(workflowTab.id);
  const workflows = [...openWorkflowTabs.value];
  workflows.splice(workflowIndex + 1, 0, duplicatedWorkflow.id);
  openWorkflowTabs.value = workflows;
  await nextTick();
  const index = findContentTabIndex('workflow', duplicatedWorkflow.id);
  if (index >= 0) selectContentTab(index);
};

const closeOtherContentTabs = async (keepContentIndex) => {
  const keepTab = contentTabs.value[keepContentIndex];
  if (!keepTab) return;

  const requestIdsToClose = keepTab.type === 'request'
    ? openRequests.value.filter(id => id !== keepTab.id)
    : [...openRequests.value];
  const workflowIdsToClose = keepTab.type === 'workflow'
    ? openWorkflowTabs.value.filter(id => id !== keepTab.id)
    : [...openWorkflowTabs.value];
  const unsavedRequests = requestIdsToClose.filter(requestId => hasRequestUnsavedChanges(requestId));
  const unsavedWorkflows = workflowIdsToClose.filter(workflowId => hasWorkflowUnsavedChanges(workflowId));

  await confirmDiscardTabs(
    unsavedRequests.length + unsavedWorkflows.length,
    'Discard & Close',
    async () => {
      await discardUnsavedDrafts(unsavedRequests, unsavedWorkflows);
      workflowIdsToClose.forEach(workflowId => workflowsStore.clearWorkflowDraft(workflowId));

      if (keepTab.type === 'request') {
        appStateStore.updateOpenRequests([keepTab.id]);
        appStateStore.setActiveRequest(0);
        openWorkflowTabs.value = [];
        workflowUnsavedChangesMap.value = {};
        activeContentIndex.value = 0;
        syncCollectionsPanelSelection(keepTab.id);
      } else {
        unsavedChangesMap.value = {};
        appStateStore.updateOpenRequests([]);
        appStateStore.setActiveRequest(-1);
        openWorkflowTabs.value = [keepTab.id];
        workflowUnsavedChangesMap.value = {
          [keepTab.id]: workflowUnsavedChangesMap.value[keepTab.id] || false
        };
        await nextTick();
        selectContentTab(0);
      }
      return true;
    }
  );
};

const handleTabAction = async (action) => {
  const selectedTab = contentTabs.value[selectedTabIndex.value];
  
  switch(action) {
    case 'duplicate':
      if (selectedTab?.type === 'request') {
        await duplicateRequestTab(selectedTab);
      } else if (selectedTab?.type === 'workflow') {
        await duplicateWorkflowTab(selectedTab);
      }
      break;
      
    case 'close':
      if (selectedTab) {
        await closeContentTab(selectedTab, selectedTabIndex.value);
      }
      break;
      
    case 'closeOthers':
      if (selectedTabIndex.value >= 0) {
        await closeOtherContentTabs(selectedTabIndex.value);
      }
      break;
      
    case 'closeAll':
      await closeAllTabs();
      break;
    case 'closeAllSaved':
      await closeAllSavedTabs();
      break;
  }
};

const openTemporaryRequest = async (request) => {
  showWorkflowWorkspace.value = false;
  await requestsStore.saveRequest(request);
  appStateStore.addOpenRequest(request.id);
  await nextTick();
  const index = findContentTabIndex('request', request.id);
  if (index >= 0) selectContentTab(index);
};

const createNewRequest = async () => {
  try {
    await openTemporaryRequest(createTemporaryRequest());
  } catch (error) {
    console.error('Failed to create new request:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to create new request',
        life: 3000
      });
    }
  }
};

const closeRequest = async (index) => {
  // 检查是否有未保存的变化
  const requestId = openRequests.value[index];
  const hasChanges = hasRequestUnsavedChanges(requestId);
  
  if (hasChanges) {
    // 检查请求是否已保存过（是否有 collectionId）
    const request = await requestsStore.loadRequest(requestId);
    const hasCollection = request && request.collectionId;
    
    // 显示确认对话框
    return new Promise((resolve) => {
      if (window.$confirm) {
        window.$confirm.require({
          message: 'You have unsaved changes. What would you like to do?',
          header: 'Unsaved Changes',
          icon: 'pi pi-exclamation-triangle',
          acceptLabel: 'Save',
          rejectLabel: 'Discard',
          acceptClass: 'p-button-success',
          rejectClass: 'p-button-danger',
          accept: async () => {
            let wrapperRef = requestWrapperRefs.value[requestId];
            
            if (!hasCollection) {
              // 请求未保存过，打开保存对话框让用户选择位置
              if (!wrapperRef) {
                const contentIndex = findContentTabIndex('request', requestId);
                if (contentIndex >= 0) {
                  selectContentTab(contentIndex);
                  wrapperRef = await waitForRequestWrapper(requestId);
                }
              }
              if (wrapperRef && typeof wrapperRef.openSaveDialog === 'function') {
                wrapperRef.openSaveDialog();
              }
              // 不关闭 tab，让用户完成保存后手动关闭
              resolve(false);
            } else {
              // 请求已保存过，直接保存并关闭
              if (wrapperRef && typeof wrapperRef.saveCurrentRequest === 'function') {
                await wrapperRef.saveCurrentRequest();
              } else {
                const currentRequest = await requestsStore.loadRequest(requestId);
                if (currentRequest) await requestsStore.saveRequest(currentRequest);
              }
              
              // 关闭 tab
              performCloseRequest(index);
              resolve(true);
            }
          },
          reject: async () => {
            // 丢弃修改：恢复到原始版本
            const wrapperRef = requestWrapperRefs.value[requestId];
            if (wrapperRef && typeof wrapperRef.restoreOriginalRequest === 'function') {
              await wrapperRef.restoreOriginalRequest();
            } else {
              await requestsStore.discardRequestDraft(requestId);
            }
            // 关闭 tab
            performCloseRequest(index);
            resolve(true);
          },
          onHide: () => {
            // 取消，不关闭
            resolve(false);
          }
        });
      } else {
        // 如果没有 confirm 服务，直接关闭
        performCloseRequest(index);
        resolve(true);
      }
    });
  }
  
  // 没有变化，直接关闭
  performCloseRequest(index);
};

const performCloseRequest = (index) => {
  const requests = [...openRequests.value];
  const requestId = requests[index];
  
  // 清除未保存状态
  if (requestId) {
    delete unsavedChangesMap.value[requestId];
    removeMountedRequest(requestId);
  }
  
  requests.splice(index, 1);
  
  // 更新打开的请求列表
  appStateStore.updateOpenRequests(requests);
  
  // 调整 activeRequestIndex
  let newActiveIndex = -1;
  if (requests.length === 0) {
    // 如果没有打开的 tab 了，重置为 -1（显示默认页面）
    newActiveIndex = -1;
  } else if (index <= activeRequestIndex.value) {
    // 如果关闭的是当前选中的 tab 或之前的 tab
    if (index === activeRequestIndex.value) {
      // 关闭的是当前选中的 tab
      // 如果关闭的是最后一个 tab，选中前一个；否则保持当前索引（会自动选中下一个）
      newActiveIndex = index >= requests.length ? requests.length - 1 : index;
    } else {
      // 关闭的是当前选中 tab 之前的 tab，索引需要前移
      newActiveIndex = activeRequestIndex.value - 1;
    }
  } else {
    // 如果关闭的是当前选中 tab 之后的 tab，activeRequestIndex 不需要改变
    newActiveIndex = activeRequestIndex.value;
  }
  
  appStateStore.setActiveRequest(newActiveIndex);
  
  // 同步更新 CollectionsPanel 的选中状态
  if (newActiveIndex >= 0 && requests[newActiveIndex]) {
    syncCollectionsPanelSelection(requests[newActiveIndex]);
  } else {
    // 清除 CollectionsPanel 的选中状态（最后一个 Tab 关闭）
    if (collectionsPanelRef.value && typeof collectionsPanelRef.value.clearSelection === 'function') {
      collectionsPanelRef.value.clearSelection();
    }
  }
};

// 关闭其他 tabs
const closeOtherTabs = async (keepIndex) => {
  const requests = [...openRequests.value];
  const keepRequestId = requests[keepIndex];
  
  // 检查其他 tabs 是否有未保存的变化
  const unsavedRequests = [];
  for (let i = 0; i < requests.length; i++) {
    if (i !== keepIndex && hasRequestUnsavedChanges(requests[i])) {
      unsavedRequests.push(requests[i]);
    }
  }
  
  if (unsavedRequests.length > 0) {
    // 有未保存的变化，显示确认对话框
    return new Promise((resolve) => {
      if (window.$confirm) {
        window.$confirm.require({
          message: `You have ${unsavedRequests.length} tab(s) with unsaved changes. Do you want to discard the changes and close them?`,
          header: 'Unsaved Changes',
          icon: 'pi pi-exclamation-triangle',
          acceptLabel: 'Discard & Close',
          rejectLabel: 'Cancel',
          acceptClass: 'p-button-danger',
          accept: async () => {
            // 还原所有有未保存变化的请求
            for (const requestId of unsavedRequests) {
              await discardRequestDraft(requestId);
            }
            
            // 只保留指定的 tab
            appStateStore.updateOpenRequests([keepRequestId]);
            appStateStore.setActiveRequest(0);
            clearWorkflowTabs();
            activeContentIndex.value = 0;
            
            // 同步 CollectionsPanel 选中状态
            syncCollectionsPanelSelection(keepRequestId);
            
            resolve(true);
          },
          reject: () => {
            resolve(false);
          }
        });
      } else {
        // 没有 confirm 服务，直接关闭
        appStateStore.updateOpenRequests([keepRequestId]);
        appStateStore.setActiveRequest(0);
        clearWorkflowTabs();
        activeContentIndex.value = 0;
        syncCollectionsPanelSelection(keepRequestId);
        resolve(true);
      }
    });
  }
  
  // 没有未保存的变化，直接关闭
  appStateStore.updateOpenRequests([keepRequestId]);
  appStateStore.setActiveRequest(0);
  clearWorkflowTabs();
  activeContentIndex.value = 0;
  syncCollectionsPanelSelection(keepRequestId);
};

// 关闭所有 tabs
const closeAllTabs = async () => {
  const requests = [...openRequests.value];
  const workflows = [...openWorkflowTabs.value];
  
  // 检查是否有未保存的变化
  const unsavedRequests = requests.filter(requestId => hasRequestUnsavedChanges(requestId));
  const unsavedWorkflows = workflows.filter(workflowId => hasWorkflowUnsavedChanges(workflowId));
  
  return confirmDiscardTabs(
    unsavedRequests.length + unsavedWorkflows.length,
    'Discard & Close All',
    async () => {
      await discardUnsavedDrafts(unsavedRequests, unsavedWorkflows);
      workflows.forEach(workflowId => workflowsStore.clearWorkflowDraft(workflowId));

      // 清除所有未保存状态
      unsavedChangesMap.value = {};
      workflowUnsavedChangesMap.value = {};
      
      // 关闭所有 tabs
      appStateStore.updateOpenRequests([]);
      appStateStore.setActiveRequest(-1);
      openWorkflowTabs.value = [];
      activeContentIndex.value = 0;
      
      // 清除 CollectionsPanel 的选中状态
      if (collectionsPanelRef.value && typeof collectionsPanelRef.value.clearSelection === 'function') {
        collectionsPanelRef.value.clearSelection();
      }
      
      return true;
    }
  );
};

// 只关闭已保存的 tabs，保留有未保存变更的 tabs
const closeAllSavedTabs = async () => {
  const requests = [...openRequests.value];
  const workflows = [...openWorkflowTabs.value];

  const savedRequests = requests.filter(requestId => !hasRequestUnsavedChanges(requestId));
  const savedWorkflows = workflows.filter(workflowId => !hasWorkflowUnsavedChanges(workflowId));

  if (savedRequests.length === 0 && savedWorkflows.length === 0) return;

  // 关闭已保存的 request tabs
  const remainingRequests = requests.filter(requestId => hasRequestUnsavedChanges(requestId));
  appStateStore.updateOpenRequests(remainingRequests);

  // 关闭已保存的 workflow tabs
  savedWorkflows.forEach(workflowId => workflowsStore.clearWorkflowDraft(workflowId));
  openWorkflowTabs.value = workflows.filter(workflowId => hasWorkflowUnsavedChanges(workflowId));

  // 修正 activeContentIndex：确保仍指向一个有效的 tab
  await nextTick();
  const newLength = contentTabs.value.length;
  if (newLength === 0) {
    activeContentIndex.value = 0;
    appStateStore.setActiveRequest(-1);
    if (collectionsPanelRef.value && typeof collectionsPanelRef.value.clearSelection === 'function') {
      collectionsPanelRef.value.clearSelection();
    }
  } else {
    activeContentIndex.value = Math.min(activeContentIndex.value, newLength - 1);
    selectContentTab(activeContentIndex.value);
  }
};

// 同步 CollectionsPanel 的选中状态
const syncCollectionsPanelSelection = async (requestId) => {
  try {
    const request = await requestsStore.loadRequest(requestId);
    if (request && request.collectionId && collectionsPanelRef.value) {
      collectionsPanelRef.value.selectRequestNode(
        request.id,
        request.collectionId,
        request.folderId
      );
    }
  } catch (error) {
    console.error('Failed to sync collections panel selection:', error);
  }
};

const addToHistory = (log) => {
  if (!log) return;

  const endTime = log.endTime || Date.now();
  historyStore.addHistoryItem({
    id: String(log.id || endTime),
    method: log.method || 'GET',
    url: log.url || '',
    status: log.status ?? 0,
    duration: log.duration || '',
    timestamp: new Date(endTime).toISOString(),
    requestData: {
      method: log.method || 'GET',
      url: log.url || '',
      headers: log.requestHeaders || {},
      body: log.requestBody ?? null,
    },
    responseData: {
      headers: log.responseHeaders || {},
      body: log.responseBody ?? '',
      statusText: log.statusText || '',
    },
  });
};

const openFromHistory = async (historyItem) => {
  try {
    await openTemporaryRequest(createTemporaryRequestFromHistory(historyItem));
  } catch (error) {
    console.error('Failed to open from history:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to open request from history',
        life: 3000,
      });
    }
  }
};

const handleAddRequest = async (requestData) => {
  try {
    // 创建基本的请求对象
    const newRequest = {
      id: generateId(),
      name: requestData.name || 'New Request',
      method: 'GET',
      url: '',
      params: [{ key: '', value: '', enabled: true }],
      headers: [{ key: '', value: '', enabled: true }],
      body: {
        type: 'none',
        raw: '',
        formData: [{ key: '', value: '', type: 'text', enabled: true }],
        urlencoded: [{ key: '', value: '', enabled: true }]
      },
      auth: {
        type: 'none',
        token: '',
        username: '',
        password: ''
      },
      tests: createDefaultTestConfig(),
      testsConfig: createDefaultTestConfig(),
      collectionId: requestData.collection?.id || null,
      folderId: requestData.folder?.id || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // 保存请求数据到存储
    await requestsStore.saveRequest(newRequest);
    
    // 如果有 collection，添加引用
    if (requestData.collection) {
      await collectionsStore.addRequestReference(
        requestData.collection.id,
        newRequest.id,
        newRequest.name,
        newRequest.method,
        newRequest.url,
        requestData.folder?.id
      );
    }
    
    // 打开 tab
    appStateStore.addOpenRequest(newRequest.id);
    
    // 触发名称更新
    requestNamesVersion.value++;
    
    // 自动选中新创建的 request
    if (requestData.collection && collectionsPanelRef.value) {
      collectionsPanelRef.value.selectRequestNode(
        newRequest.id,
        requestData.collection.id,
        requestData.folder?.id
      );
    }
  } catch (error) {
    console.error('Failed to add request:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to create request',
        life: 3000
      });
    }
  }
};

const handleOpenRequest = (requestData) => {
  showWorkflowWorkspace.value = false;
  const { request } = requestData;
  appStateStore.addOpenRequest(request.id);
  nextTick(() => {
    const index = findContentTabIndex('request', request.id);
    if (index >= 0) selectContentTab(index);
  });
  // 触发名称更新
  requestNamesVersion.value++;
};

const handleOpenRequestById = async (requestId) => {
  const request = await requestsStore.loadRequest(requestId);
  if (!request) return;
  handleOpenRequest({
    request: {
      id: request.id,
      name: request.name,
      method: request.method,
      url: request.url
    }
  });
};

const handleOpenWorkflow = ({ workflowId }) => {
  openWorkflowTab(workflowId);
};

const handleWorkflowDeleted = (workflowId) => {
  closeWorkflowTab(workflowId);
};

const handleRequestDeleted = (requestId) => {
  const contentIndex = findContentTabIndex('request', requestId);
  // 从打开的 tabs 中移除被删除的 request
  const requests = [...openRequests.value];
  const deletedIndex = requests.indexOf(requestId);
  
  if (deletedIndex !== -1) {
    removeMountedRequest(requestId);
    requests.splice(deletedIndex, 1);
    
    // 更新打开的请求列表
    appStateStore.updateOpenRequests(requests);
    
    // 调整 activeRequestIndex
    if (requests.length === 0) {
      // 如果没有打开的 tab 了，重置为 -1（显示默认页面）
      appStateStore.setActiveRequest(-1);
    } else if (deletedIndex <= activeRequestIndex.value) {
      // 如果删除的是当前选中的 tab 或之前的 tab
      if (deletedIndex === activeRequestIndex.value) {
        // 删除的是当前选中的 tab
        // 如果删除的是最后一个 tab，选中前一个；否则保持当前索引（会自动选中下一个）
        const newIndex = deletedIndex >= requests.length ? requests.length - 1 : deletedIndex;
        appStateStore.setActiveRequest(newIndex);
      } else {
        // 删除的是当前选中 tab 之前的 tab，索引需要前移
        appStateStore.setActiveRequest(activeRequestIndex.value - 1);
      }
    }
    // 如果删除的是当前选中 tab 之后的 tab，activeRequestIndex 不需要改变
  }
  nextTick(() => {
    if (contentIndex >= 0) {
      activeContentIndex.value = Math.min(contentIndex, Math.max(0, contentTabs.value.length - 1));
      selectContentTab(activeContentIndex.value);
    }
  });
};

const handleRequestDuplicated = (requestId) => {
  // 打开新创建的 duplicated request
  appStateStore.addOpenRequest(requestId);
  nextTick(() => {
    const index = findContentTabIndex('request', requestId);
    if (index >= 0) selectContentTab(index);
  });
  // 触发名称更新
  requestNamesVersion.value++;
};

const handleSaveRequest = async (saveData) => {
  const { request, collection, folder } = saveData;
  
  try {
    // 获取请求的旧位置信息（从请求对象本身）
    const oldCollectionId = request.collectionId;
    const oldFolderId = request.folderId;
    
    // 检查是否需要移动（位置发生变化）
    const needsMove = oldCollectionId && (oldCollectionId !== collection.id || (oldFolderId ?? null) !== (folder?.id ?? null));
    
    if (needsMove) {
      await collectionsStore.removeRequestReference(oldCollectionId, request.id);
    }
    
    // 更新请求的 collectionId 和 folderId
    request.collectionId = collection.id;
    request.folderId = folder?.id;
    
    // 保存请求数据
    await requestsStore.saveRequest(request);
    
    // 如果是首次保存或移动，添加到新位置
    if (!oldCollectionId || needsMove) {
      await collectionsStore.addRequestReference(
        collection.id,
        request.id,
        request.name,
        request.method,
        request.url,
        folder?.id
      );
    } else {
      // 只是更新内容，更新 collection 中的请求引用
      await collectionsStore.updateRequestReference(
        collection.id,
        request.id,
        request.name,
        request.method,
        request.url,
        folder?.id
      );
    }
    
    // 清除未保存状态
    updateUnsavedStatus(request.id, false);

    // 触发名称更新
    requestNamesVersion.value++;

    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Saved',
        detail: `Request "${request.name}" saved successfully`,
        life: 2000
      });
    }
  } catch (error) {
    console.error('Failed to save request:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to save request',
        life: 3000
      });
    }
  }
};

// 处理未保存变化状态更新
const handleUnsavedChanges = (requestId, hasChanges) => {
  console.log('[MainContent] handleUnsavedChanges called, requestId:', requestId, 'hasChanges:', hasChanges);
  updateUnsavedStatus(requestId, hasChanges);
  // 同时触发名称更新（因为名称可能也变了）
  requestNamesVersion.value++;
};

// 获取请求的显示名称
const getRequestName = (requestId) => {
  const request = requestsStore.requests.get(requestId);
  return request?.name || 'Untitled Request';
};

// 用于触发名称更新的响应式变量
const requestNamesVersion = ref(0);

// 创建一个 computed 来追踪所有打开请求的名称（确保响应式）
const openRequestNames = computed(() => {
  // 依赖 requestNamesVersion 和 openRequests 来触发重新计算
  requestNamesVersion.value;
  const names = {};
  for (const requestId of openRequests.value) {
    const request = requestsStore.requests.get(requestId);
    const name = request?.name || 'Untitled Request';
    names[requestId] = name;
  }
  return names;
});

// 监听 openRequests 变化，触发名称更新
watch(openRequests, (newRequests, oldRequests) => {
  requestNamesVersion.value++;
  const openIds = new Set(newRequests || []);
  mountedRequestIds.value
    .filter(requestId => !openIds.has(requestId))
    .forEach(removeMountedRequest);
  
  // 如果从空变为非空，加载请求
  if (oldRequests && oldRequests.length === 0 && newRequests && newRequests.length > 0) {
    loadOpenRequests();
  }
}, { deep: true });

// 存储每个请求的未保存状态
const unsavedChangesMap = ref({});

// 检查请求是否有未保存的变化
const hasRequestUnsavedChanges = (requestId) => {
  return unsavedChangesMap.value[requestId] || false;
};

const hasWorkflowUnsavedChanges = (workflowId) => {
  return workflowUnsavedChangesMap.value[workflowId] || false;
};

const handleWorkflowUnsavedChanges = (workflowId, hasChanges) => {
  workflowUnsavedChangesMap.value[workflowId] = hasChanges;
};

// 更新请求的未保存状态
const updateUnsavedStatus = (requestId, hasChanges) => {
  unsavedChangesMap.value[requestId] = hasChanges;
};

// 监听 activeRequestIndex 变化，同步 CollectionsPanel 的选中状态
watch(activeRequestIndex, async (newIndex) => {
  if (newIndex >= 0 && openRequests.value[newIndex]) {
    const requestId = openRequests.value[newIndex];
    const request = await requestsStore.loadRequest(requestId);
    
    if (request && request.collectionId && collectionsPanelRef.value) {
      collectionsPanelRef.value.selectRequestNode(
        request.id,
        request.collectionId,
        request.folderId
      );
    }
  }
}, { immediate: true });

// 组件挂载时预加载所有打开的请求到缓存
onMounted(async () => {
  // 计算最大侧边栏宽度
  updateMaxSidebarWidth();
  
  // 监听窗口大小变化
  window.addEventListener('resize', updateMaxSidebarWidth);
  window.addEventListener('mousemove', handleResize);
  window.addEventListener('mouseup', stopResize);
  
  const restoreInitialTabs = async () => {
    await nextTick();
    await loadOpenRequests();
    await restoreOpenWorkflows();
    emit('ready');
  };

  // 等待 appState 和 workflows 都加载完成，避免启动恢复时误清空 workflow tabs
  if (appStateStore.isLoading || workflowsStore.isLoading) {
    const unwatch = watch(
      () => [appStateStore.isLoading, workflowsStore.isLoading],
      async ([isAppStateLoading, isWorkflowsLoading]) => {
        if (!isAppStateLoading && !isWorkflowsLoading) {
          unwatch();
          await restoreInitialTabs();
        }
      },
      { immediate: true }
    );
  } else {
    await restoreInitialTabs();
  }
});

// 清理事件监听器
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateMaxSidebarWidth);
  window.removeEventListener('mousemove', handleResize);
  window.removeEventListener('mouseup', stopResize);
});

// 加载打开的请求
const loadOpenRequests = async () => {
  // 获取所有打开的请求 ID
  const openRequestIds = openRequests.value;
  
  if (openRequestIds.length > 0) {
    try {
      // 预加载所有打开的请求到缓存
      await requestsStore.loadMultipleRequests(openRequestIds);
      
      // 未保存状态以「是否存在草稿」为准：草稿（requests/_drafts/）表示有持久化的
      // 暂存编辑。这统一了「已绑定 collection」与「未绑定 collection」两种情况，并且
      // 在重启后能正确恢复未保存标记（与 workflow 草稿机制一致）。
      for (const requestId of openRequestIds) {
        if (requestsStore.hasRequestDraft(requestId)) {
          updateUnsavedStatus(requestId, true);
        }
      }
      
      // 触发名称更新
      requestNamesVersion.value++;
    } catch (error) {
      console.error('[MainContent] Failed to load open requests:', error);
    }
  }
};

const restoreOpenWorkflows = async () => {
  const existingWorkflowIds = new Set(workflowsStore.workflows.map(workflow => workflow.id));
  const restoredWorkflowIds = openWorkflowTabs.value.filter(workflowId => existingWorkflowIds.has(workflowId));

  if (restoredWorkflowIds.length !== openWorkflowTabs.value.length) {
    openWorkflowTabs.value = restoredWorkflowIds;
  }

  restoredWorkflowIds.forEach(workflowId => {
    workflowUnsavedChangesMap.value[workflowId] = Boolean(workflowsStore.getWorkflowDraft(workflowId));
  });

  await nextTick();
  const maxIndex = contentTabs.value.length - 1;
  if (maxIndex < 0) {
    selectContentTab(0);
    return;
  }

  const restoredIndex = Math.min(activeContentIndex.value || 0, maxIndex);
  selectContentTab(restoredIndex);
};

defineExpose({
  createNewRequest,
  collectionsPanelRef,
  environmentManagerRef
});
</script>

<template>
  <div class="main-content flex-1 flex overflow-hidden">
    <!-- Collapsed Sidebar Button -->
    <div 
      v-if="sidebarCollapsed"
      class="collapsed-sidebar-button bg-surface-0 dark:bg-surface-950 border-r border-surface-200 dark:border-surface-700 flex flex-col items-center py-3 gap-2"
    >
      <Button
        icon="pi pi-angle-right"
        text
        rounded
        size="small"
        severity="secondary"
        title="Expand Sidebar"
        @click="toggleSidebar"
      />
      <Button
        icon="pi pi-history"
        text
        rounded
        size="small"
        severity="secondary"
        title="History"
        :class="{ 'bg-primary-50 dark:bg-primary-900/20': activeTab === 0 }"
        @click="activeTab = 0; toggleSidebar()"
      />
      <Button
        icon="pi pi-folder"
        text
        rounded
        size="small"
        severity="secondary"
        title="Collections"
        :class="{ 'bg-primary-50 dark:bg-primary-900/20': activeTab === 1 }"
        @click="activeTab = 1; toggleSidebar()"
      />
      <Button
        icon="pi pi-sitemap"
        text
        rounded
        size="small"
        severity="secondary"
        title="Workflows"
        :class="{ 'bg-primary-50 dark:bg-primary-900/20': activeTab === 2 }"
        @click="activeTab = 2; toggleSidebar()"
      />
    </div>

    <!-- Sidebar -->
    <aside 
      v-if="!sidebarCollapsed"
      class="sidebar bg-surface-0 dark:bg-surface-950 border-r border-surface-200 dark:border-surface-700 flex flex-col relative"
      :style="{ width: sidebarWidth + 'px' }"
    >
      <!-- Search Box -->
      <div class="p-3 border-b border-surface-200 dark:border-surface-700">
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText 
            v-model="searchQuery"
            placeholder="Search..."
            class="w-full text-sm"
            size="small"
          />
          <button
            v-if="searchQuery"
            type="button"
            aria-label="Clear search"
            title="Clear Search"
            class="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-6 h-6 inline-flex items-center justify-center rounded-full text-surface-400 hover:text-surface-700 hover:bg-surface-100 dark:text-surface-500 dark:hover:text-surface-200 dark:hover:bg-surface-800 transition"
            @mousedown.prevent
            @click="searchQuery = ''"
          >
            <i class="pi pi-times text-xs" aria-hidden="true" />
          </button>
        </IconField>
      </div>

      <!-- Tabs -->
      <TabView v-model:activeIndex="activeTab" class="sidebar-tabs">
        <TabPanel header="History">
          <HistoryPanel 
            :searchQuery="searchQuery"
            @open-from-history="openFromHistory"
          />
        </TabPanel>

        <TabPanel header="Collections" contentClass="collections-tab-panel">
          <CollectionsPanel 
            ref="collectionsPanelRef"
            :searchQuery="searchQuery"
            @add-request="handleAddRequest"
            @open-request="handleOpenRequest"
            @request-deleted="handleRequestDeleted"
            @request-duplicated="handleRequestDuplicated"
          />
        </TabPanel>

        <TabPanel header="Workflows">
          <WorkflowsPanel
            :searchQuery="searchQuery"
            @open-workflow="handleOpenWorkflow"
            @workflow-deleted="handleWorkflowDeleted"
          />
        </TabPanel>
      </TabView>

      <!-- Resize Handle -->
      <div 
        class="resize-handle"
        @mousedown="startResize"
      ></div>
    </aside>
    
    <!-- Request Editor -->
    <main class="flex-1 bg-surface-0 dark:bg-surface-950 flex flex-col overflow-hidden">
      <!-- Top Toolbar with Tabs -->
      <div class="flex items-center border-b border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-950">
        <!-- Request Tabs -->
        <div ref="contentTabsRoot" class="flex-1 overflow-hidden">
          <Tabs
            v-if="contentTabs.length > 0"
            class="content-tabs"
            :value="activeContentIndex"
            @update:value="selectContentTab($event)"
            scrollable
          >
            <TabList>
              <Tab
                v-for="(tab, index) in contentTabs"
                :key="`${tab.type}-${tab.id}`"
                :value="index"
                :data-content-tab-index="index"
                draggable="true"
                @dragstart="onTabDragStart($event, index)"
                @dragover.prevent="onTabDragOver($event, index)"
                @drop.prevent="onTabDrop($event, index)"
                @dragend="onTabDragEnd"
                @contextmenu="showTabContextMenu($event, index)"
                class="request-tab-fixed"
                :class="{
                  'tab-dragging': draggingTabIndex === index,
                  'tab-drag-over': dragOverTabIndex === index && draggingTabIndex !== null && draggingTabIndex !== index
                }"
              >
                <div class="flex items-center gap-1 min-w-0 flex-1">
                  <span
                    v-if="(tab.type === 'request' && hasRequestUnsavedChanges(tab.id)) || (tab.type === 'workflow' && hasWorkflowUnsavedChanges(tab.id))"
                    class="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0"
                  ></span>
                  <i v-if="tab.type === 'workflow'" class="pi pi-sitemap text-xs text-primary-500"></i>
                  <span
                    class="text-xs truncate"
                    :class="{ 'text-orange-600 dark:text-orange-400': (tab.type === 'request' && hasRequestUnsavedChanges(tab.id)) || (tab.type === 'workflow' && hasWorkflowUnsavedChanges(tab.id)) }"
                    :title="tab.type === 'request' ? openRequestNames[tab.id] : getWorkflowName(tab.id)"
                  >{{ tab.type === 'request' ? openRequestNames[tab.id] : getWorkflowName(tab.id) }}</span>
                </div>
                <i
                  class="pi pi-times text-xs ml-1 hover:text-red-600 cursor-pointer flex-shrink-0"
                  @click.stop="closeContentTab(tab, index)"
                ></i>
              </Tab>
            </TabList>
          </Tabs>
        </div>

        <!-- Action Buttons -->
        <div class="flex items-center gap-1 px-2 border-l border-surface-200 dark:border-surface-700">
          <Button 
            icon="pi pi-plus"
            text
            rounded
            size="small"
            severity="secondary"
            title="New Request"
            @click="createNewRequest"
          />
          <Button
            icon="pi pi-sitemap"
            text
            rounded
            size="small"
            severity="secondary"
            title="New Workflow"
            @click="createNewWorkflow"
          />
          <Button 
            icon="pi pi-ellipsis-v"
            text
            rounded
            size="small"
            severity="secondary"
            title="More Options"
            @click="showToolbarMenu"
          />
          
          <EnvironmentManager 
            ref="environmentManagerRef" 
            :currentRequest="activeRequest"
          />
        </div>
      </div>
      
      <!-- Content Area -->
      <div class="flex-1 overflow-hidden">
        <WorkflowWorkspace
          v-if="mountedWorkflowId"
          v-show="showWorkflowWorkspace"
          ref="workflowWorkspaceRef"
          :workflowId="mountedWorkflowId"
          :isActive="activeContentTab?.type === 'workflow' && activeContentTab.id === mountedWorkflowId"
          :environmentManager="environmentManagerRef"
          @add-console-log="(log) => { emit('add-console-log', log); addToHistory(log); }"
          @unsaved-change="handleWorkflowUnsavedChanges"
          @open-workflow="handleOpenWorkflow"
          @open-request="handleOpenRequestById"
        />

        <!-- Empty State -->
        <div v-if="contentTabs.length === 0" class="h-full flex items-center justify-center">
          <div class="text-center">
            <div class="mb-4">
              <i class="pi pi-inbox text-6xl text-surface-300 dark:text-surface-600"></i>
            </div>
            <h3 class="text-lg font-medium text-surface-700 dark:text-surface-300 mb-2">
              Nothing Open
            </h3>
            <p class="text-sm text-surface-500 dark:text-surface-400 mb-4">
              Select or create a request to get started
            </p>
            <div class="flex gap-2 justify-center">
              <Button label="New Request" icon="pi pi-plus" size="small" @click="createNewRequest" />
            </div>
          </div>
        </div>

        <!-- Active Request -->
        <HttpRequestWrapper
          v-for="requestId in mountedOpenRequestIds"
          :key="requestId"
          v-show="activeContentTab?.type === 'request' && activeContentTab.id === requestId"
          :ref="el => setRequestWrapperRef(requestId, el)"
          :requestId="requestId"
          :isActive="activeContentTab?.type === 'request' && activeContentTab.id === requestId"
          :environmentManager="environmentManagerRef"
          :collections="collectionsStore.collections"
          @close="closeRequest(openRequests.indexOf(requestId))"
          @add-console-log="(log) => { emit('add-console-log', log); addToHistory(log); }"
          @save-request="handleSaveRequest"
          @unsaved-changes="(hasChanges) => handleUnsavedChanges(requestId, hasChanges)"
        />
      </div>
    </main>

    <!-- Toolbar Menu -->
    <ContextMenu ref="toolbarMenu" :model="toolbarMenuModel" />
    
    <!-- Tab Context Menu -->
    <ContextMenu ref="tabContextMenu" :model="tabContextMenuModel" />
  </div>
</template>

<style scoped>
:deep(.sidebar-tabs) {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

:deep(.sidebar-tabs .p-tabview-nav-container) {
  border-bottom: 1px solid var(--surface-border);
}

:deep(.sidebar-tabs .p-tabview-nav) {
  background: transparent;
  border: none;
}

:deep(.sidebar-tabs .p-tabview-nav-link) {
  padding: 0.5rem 0.75rem;
  font-size: 12px;
  font-weight: 500;
}

:deep(.sidebar-tabs .p-tabview-panels) {
  flex: 1;
  overflow-y: auto;
  padding: 0;
  background: transparent;
}

:deep(.sidebar-tabs .p-tabview-panel) {
  padding: 0;
}

:deep(.sidebar-tabs .p-tabview-panel.collections-tab-panel) {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

/* Sidebar resize handle */
.sidebar {
  position: relative;
}

.resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  background: transparent;
  transition: background-color 0.2s;
  z-index: 10;
}

.resize-handle:hover {
  background: var(--primary-color);
}

.resize-handle:active {
  background: var(--primary-color);
}

/* Collapsed sidebar button */
.collapsed-sidebar-button {
  width: 48px;
  flex-shrink: 0;
}

/* Prevent text selection during resize */
body.resizing {
  user-select: none;
  cursor: col-resize;
}

:deep(.request-tab-fixed) {
  width: 126px !important;
  min-width: 126px !important;
  max-width: 126px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
}

:deep(.request-tab-fixed.p-tab) {
  border: 1px solid var(--p-surface-200) !important;   /* 同 HttpRequest 标题分割线(亮) */
  border-radius: 3px !important;
  margin-right: 6px !important;
  padding: 0.8rem 0.5rem !important;
}

/* 暗色页签边框与 HttpRequest 标题分割线(dark:border-surface-700)一致。
   .p-tab 根元素带有作用域属性(组件根透传)，故写作用域选择器即可——
   关键是 .p-dark 必须在 :deep() 外作为普通祖先，否则编译成 [data-v] .p-dark … 永不匹配。 */
.p-dark .request-tab-fixed.p-tab {
  border-color: var(--p-surface-700) !important;
}

/* ===== 激活页签视觉强化：明亮蓝强调 =====
   Noir 是单色主题(无品牌色)，故引入固定的明亮蓝(blue-500 #3b82f6)作为激活强调色，
   与「未保存」的橙色冷暖互补、互不冲突。结构：蓝边框 + 2px 顶部蓝条 + 字重 600（背景沿用页签默认）。
   顶部条用 inset box-shadow 实现，不改变页签高度，无布局抖动。
   不覆盖标签文字颜色——这样页签既激活又未保存时，橙色提示仍保留。 */

/* 亮色：蓝边框 + 蓝顶条（背景保持页签默认） */
:deep(.request-tab-fixed.p-tab[data-p-active="true"]) {
  border-color: #93c5fd !important;          /* blue-300 */
  box-shadow: inset 0 2px 0 0 #3b82f6;       /* blue-500 顶条 */
}

/* 字重提升与主题无关，两种主题通用 */
:deep(.request-tab-fixed.p-tab[data-p-active="true"] .text-xs) {
  font-weight: 600;
}

/* 暗色：亮蓝边框 + 更亮蓝顶条（背景保持页签默认） */
.p-dark .request-tab-fixed.p-tab[data-p-active="true"] {
  border-color: rgba(96, 165, 250, 0.6) !important;  /* blue-400 @60% */
  box-shadow: inset 0 2px 0 0 #60a5fa;               /* blue-400 顶条，暗底更亮更跳 */
}

/* 激活页签的指示条(active bar)默认取 primary 色，在 Noir 暗色下 = 近白(surface.50)，
   过亮且与其他分割线不一致。统一为页签边框/分割线颜色（亮:300 / 暗:600）。
   .content-tabs 限定只作用于顶部编辑器页签，不影响内部 request/response 页签。
   注意：.p-dark 在 <html> 上，必须作为普通祖先选择器（不能包进 :deep()，
   否则会编译成 [data-v] .p-dark …，永远匹配不到）；:deep() 只包裹子组件类名。 */
.content-tabs :deep(.p-tablist-active-bar) {
  background: var(--p-surface-200) !important;
}

.p-dark .content-tabs :deep(.p-tablist-active-bar) {
  background: var(--p-surface-700) !important;
}

/* 拖拽排序视觉反馈 */
:deep(.request-tab-fixed[draggable="true"]) {
  cursor: grab;
}

:deep(.request-tab-fixed.tab-dragging) {
  opacity: 0.4;
}

:deep(.request-tab-fixed.tab-drag-over) {
  border-color: var(--p-primary-color) !important;
  box-shadow: -2px 0 0 0 var(--p-primary-color);
}
</style>
