<script setup lang="ts">
import { defineAsyncComponent, ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { onItemDeleted } from '@/composables/useDeletedItems';
import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import { useAppStateStore } from '@/stores/appState';
import { useHistoryStore } from '@/stores/history';
import { consoleLogToHistoryItem } from '@/utils/history';
import { useWorkflowsStore } from '@/stores/workflows';
import { useMocksStore } from '@/stores/mocks';
import { registerWorkspaceTabBridge } from '@/services/workspaceTabBridge';
import { createEmptyRequest } from '@/utils/requestFactory';
import {
  createTemporaryRequest,
  createTemporaryRequestFromHistory,
} from '@/utils/temporaryRequest';
import { useSidebarResize } from '@/composables/useSidebarResize';
import {
  useWorkspaceTabs,
  type CollectionsPanelHandle,
  type RequestWrapperHandle,
  type WorkflowWorkspaceHandle,
} from '@/composables/useWorkspaceTabs';
import type { RequestSaveData } from '@/composables/useRequestSave';
import type { ContentTab } from '@/stores/appState';
import type { Collection, ConsoleLog, Folder, HistoryItem, HttpMethod, MockOpenRequest } from '@/types/models';
import AsyncPanelLoader from './AsyncPanelLoader.vue';
import ContentTabStrip from './ContentTabStrip.vue';
import EnvironmentManager from './EnvironmentManager.vue';
import HistoryPanel from './HistoryPanel.vue';
import CollectionsPanel from './CollectionsPanel.vue';
import WorkflowsPanel from './WorkflowsPanel.vue';
import MocksPanel from './MocksPanel.vue';

const HttpRequestWrapper = defineAsyncComponent({
  loader: () => import('./HttpRequestWrapper.vue'),
  loadingComponent: AsyncPanelLoader,
  delay: 0,
});
const MockWorkspace = defineAsyncComponent({
  loader: () => import('./MockWorkspace.vue'),
  loadingComponent: AsyncPanelLoader,
  delay: 0,
});
const NewMockDialog = defineAsyncComponent(() => import('./NewMockDialog.vue'));
const WorkflowWorkspace = defineAsyncComponent({
  loader: () => import('./WorkflowWorkspace.vue'),
  loadingComponent: AsyncPanelLoader,
  delay: 0,
});

const emit = defineEmits<{
  'add-console-log': [log: ConsoleLog];
  ready: [];
}>();

/** 侧边栏的请求引用：打开请求时只需要这些字段 */
interface RequestSummary {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
}

type ToolbarAction = 'closeAllTabs' | 'closeAllSavedTabs';
type TabAction = 'duplicate' | 'close' | 'closeOthers' | 'closeAll' | 'closeAllSaved';

/** PrimeVue Menu / ContextMenu 实例 */
interface PopupMenuHandle {
  show: (event: Event) => void;
}

// Stores
const collectionsStore = useCollectionsStore();
const requestsStore = useRequestsStore();
const appStateStore = useAppStateStore();
const historyStore = useHistoryStore();
const workflowsStore = useWorkflowsStore();
const mocksStore = useMocksStore();

const activeTab = ref(1);
const searchQuery = ref('');
const toolbarMenu = ref<PopupMenuHandle | null>(null);
const tabContextMenu = ref<PopupMenuHandle | null>(null);
const selectedTabIndex = ref(-1);
const environmentManagerRef = ref<InstanceType<typeof EnvironmentManager> | null>(null);
const collectionsPanelRef = ref<CollectionsPanelHandle | null>(null);
const tabStripRef = ref<InstanceType<typeof ContentTabStrip> | null>(null);

// Sidebar resize
const { sidebarWidth, sidebarCollapsed, startResize, toggleSidebar } = useSidebarResize();

// 内容区页签（请求与 Workflow）
const {
  openRequests,
  activeRequestIndex,
  activeContentIndex,
  activeRequest,
  contentTabs,
  activeContentTab,
  showWorkflowWorkspace,
  mountedOpenRequestIds,
  mountedOpenWorkflowIds,
  setRequestWrapperRef,
  setWorkflowWorkspaceRef,
  removeMountedRequest,
  getWorkflowName,
  findContentTabIndex,
  selectContentTab,
  reorderContentTabs,
  openRequestTab,
  openWorkflowTab,
  openMockTabs,
  openMockTab,
  closeMockTab,
  restoreOpenMocks,
  createNewWorkflow,
  closeWorkflowTab,
  closeContentTab,
  closeRequest,
  duplicateRequestTab,
  duplicateWorkflowTab,
  closeOtherContentTabs,
  closeAllTabs,
  closeAllSavedTabs,
  openTemporaryRequest,
  requestNamesVersion,
  openRequestNames,
  hasRequestUnsavedChanges,
  hasWorkflowUnsavedChanges,
  handleWorkflowUnsavedChanges,
  updateUnsavedStatus,
  loadOpenRequests,
  restoreOpenWorkflows,
  inspectRequestTab,
  inspectWorkflowTab,
  closeRequestTabFromMcp,
  closeWorkflowTabFromMcp,
} = useWorkspaceTabs({
  collectionsPanelRef,
  scrollTabIntoView: (index) => tabStripRef.value?.scrollTabIntoView(index),
});

const unregisterWorkspaceTabBridge = registerWorkspaceTabBridge({
  openRequest: openRequestTab,
  openWorkflow: async (workflowId) => {
    openWorkflowTab(workflowId);
    await nextTick();
    const index = findContentTabIndex('workflow', workflowId);
    if (index >= 0) selectContentTab(index);
  },
  inspectRequest: inspectRequestTab,
  inspectWorkflow: inspectWorkflowTab,
  closeRequest: closeRequestTabFromMcp,
  closeWorkflow: closeWorkflowTabFromMcp,
});

onBeforeUnmount(unregisterWorkspaceTabBridge);

// 页签栏显示用
const getTabLabel = (tab: ContentTab) => {
  if (tab.type === 'request') return openRequestNames.value[tab.id];
  if (tab.type === 'mock') return mocksStore.getService(tab.id)?.name || 'Mock Service';
  return getWorkflowName(tab.id);
};
const isTabUnsaved = (tab: ContentTab) => (
  (tab.type === 'request' && hasRequestUnsavedChanges(tab.id)) || (tab.type === 'workflow' && hasWorkflowUnsavedChanges(tab.id))
);

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

const showToolbarMenu = (event: MouseEvent) => {
  toolbarMenu.value?.show(event);
};

const handleToolbarAction = async (action: ToolbarAction) => {
  switch(action) {
    case 'closeAllTabs':
      await closeAllTabs();
      break;
    case 'closeAllSavedTabs':
      await closeAllSavedTabs();
      break;
  }
};

const showTabContextMenu = (event: MouseEvent, index: number) => {
  event.preventDefault();
  selectedTabIndex.value = index;
  tabContextMenu.value?.show(event);
};

const handleTabAction = async (action: TabAction) => {
  const selectedTab = contentTabs.value[selectedTabIndex.value];
  
  switch(action) {
    case 'duplicate':
      if (selectedTab?.type === 'request') {
        await duplicateRequestTab(selectedTab);
      } else if (selectedTab?.type === 'workflow') {
        await duplicateWorkflowTab(selectedTab);
      } else if (selectedTab?.type === 'mock') {
        const copy = await mocksStore.duplicateService(selectedTab.id);
        if (copy) handleOpenMock(copy.id);
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

const addToHistory = (log: ConsoleLog | null | undefined) => {
  if (!log) return;
  historyStore.addHistoryItem(consoleLogToHistoryItem(log));
};

const openFromHistory = async (historyItem: HistoryItem) => {
  try {
    // 请求体单独保存，打开时才读取
    const requestData = { ...historyItem.requestData, body: await historyStore.loadRequestBody(historyItem.id) };
    await openTemporaryRequest(createTemporaryRequestFromHistory({ ...historyItem, requestData }));
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

const handleAddRequest = async (requestData: { name?: string; collection?: Collection | null; folder?: Folder | null }) => {
  try {
    // 创建基本的请求对象
    const newRequest = createEmptyRequest({
      name: requestData.name || 'New Request',
      collectionId: requestData.collection?.id || null,
      folderId: requestData.folder?.id || null,
    });
    
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

const handleOpenRequest = (requestData: { request: RequestSummary }) => {
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

const handleOpenRequestById = async (requestId: string) => {
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

const handleOpenWorkflow = ({ workflowId }: { workflowId: string }) => {
  openWorkflowTab(workflowId);
};

const handleWorkflowDeleted = (workflowId: string) => {
  closeWorkflowTab(workflowId);
};

const handleRequestDeleted = (requestId: string) => {
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

const handleRequestDuplicated = (requestId: string) => {
  // 打开新创建的 duplicated request
  appStateStore.addOpenRequest(requestId);
  nextTick(() => {
    const index = findContentTabIndex('request', requestId);
    if (index >= 0) selectContentTab(index);
  });
  // 触发名称更新
  requestNamesVersion.value++;
};

const handleSaveRequest = async (saveData: RequestSaveData) => {
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
const handleUnsavedChanges = (requestId: string, hasChanges: boolean) => {
  updateUnsavedStatus(requestId, hasChanges);
  // 同时触发名称更新（因为名称可能也变了）
  requestNamesVersion.value++;
};

// 不经过界面的删除（例如 MCP）也关闭对应页签
const stopDeletedItems = onItemDeleted((kind, id) => {
  if (kind === 'request') handleRequestDeleted(id);
  else handleWorkflowDeleted(id);
});
onBeforeUnmount(stopDeletedItems);

// 组件挂载时预加载所有打开的请求到缓存
onMounted(async () => {
  const restoreInitialTabs = async () => {
    await nextTick();
    await loadOpenRequests();
    restoreOpenMocks(mocksStore.services.map(service => service.id));
    await restoreOpenWorkflows();
    emit('ready');
  };

  // 等待 appState 和 workflows 都加载完成，避免启动恢复时误清空 workflow tabs
  if (appStateStore.isLoading || workflowsStore.isLoading || mocksStore.isLoading) {
    const unwatch = watch(
      () => [appStateStore.isLoading, workflowsStore.isLoading, mocksStore.isLoading],
      async ([isAppStateLoading, isWorkflowsLoading, isMocksLoading]) => {
        if (!isAppStateLoading && !isWorkflowsLoading && !isMocksLoading) {
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

// Mock 服务
const showNewMockDialog = ref(false);

const handleOpenMock = (serviceId: string) => {
  mocksStore.activeServiceId = serviceId;
  openMockTab(serviceId);
};

// 服务被删除后关闭它的页签
watch(() => mocksStore.services.map(service => service.id), (ids) => {
  if (mocksStore.isLoading) return;
  const existing = new Set(ids);
  openMockTabs.value.filter(id => !existing.has(id)).forEach(closeMockTab);
});

/** Mock 路由或日志中的「Open as Request」：新建一个发往这个服务的临时请求 */
const openMockRequest = async (request: MockOpenRequest, serviceId: string) => {
  const service = mocksStore.getService(serviceId);
  const url = `${service ? mocksStore.baseUrl(service) : ''}${request.path}`;
  await openTemporaryRequest(createTemporaryRequestFromHistory({
    method: request.method,
    url,
    requestData: { method: request.method, url, headers: request.headers, body: request.body || null },
  }));
};

defineExpose({
  showMocks: () => {
    activeTab.value = 3;
    if (sidebarCollapsed.value) toggleSidebar();
  },
  openNewMockDialog: () => { showNewMockDialog.value = true; },
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
      class="collapsed-sidebar-button bg-surface-0 dark:bg-surface-900 border-r border-surface-200 dark:border-surface-700 flex flex-col items-center py-3 gap-2"
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
      <Button
        icon="pi pi-server"
        text
        rounded
        size="small"
        severity="secondary"
        title="Mocks"
        :class="{ 'bg-primary-50 dark:bg-primary-900/20': activeTab === 3 }"
        @click="activeTab = 3; toggleSidebar()"
      />
    </div>

    <!-- Sidebar -->
    <aside 
      v-if="!sidebarCollapsed"
      class="sidebar bg-surface-0 dark:bg-surface-900 border-r border-surface-200 dark:border-surface-700 flex flex-col relative"
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
          <!-- PrimeVue 按钮自带 position: relative，用外层定位到输入框右侧 -->
          <span v-if="searchQuery" class="absolute right-1 top-1/2 -translate-y-1/2 z-10 flex">
            <Button
              icon="pi pi-times"
              text
              rounded
              size="small"
              severity="secondary"
              aria-label="Clear search"
              title="Clear Search"
              @mousedown.prevent
              @click="searchQuery = ''"
            />
          </span>
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

        <TabPanel header="Mocks">
          <MocksPanel
            :searchQuery="searchQuery"
            @new-mock="showNewMockDialog = true"
            @open-mock="handleOpenMock"
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
      <div class="flex items-center border-b border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-900">
        <!-- Request Tabs -->
        <ContentTabStrip
          ref="tabStripRef"
          :tabs="contentTabs"
          :active-index="activeContentIndex"
          :get-label="getTabLabel"
          :is-unsaved="isTabUnsaved"
          @select="selectContentTab"
          @close="closeContentTab"
          @reorder="reorderContentTabs"
          @contextmenu="showTabContextMenu"
        />

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
            :currentRequest="activeRequest ?? undefined"
          />
        </div>
      </div>
      
      <!-- Content Area -->
      <div class="flex-1 overflow-hidden">
        <WorkflowWorkspace
          v-for="workflowId in mountedOpenWorkflowIds"
          :key="workflowId"
          v-show="showWorkflowWorkspace && activeContentTab?.type === 'workflow' && activeContentTab.id === workflowId"
          :ref="el => setWorkflowWorkspaceRef(workflowId, el as unknown as WorkflowWorkspaceHandle | null)"
          :workflowId="workflowId"
          :isActive="activeContentTab?.type === 'workflow' && activeContentTab.id === workflowId"
          @add-console-log="(log) => { emit('add-console-log', log); addToHistory(log); }"
          @unsaved-change="handleWorkflowUnsavedChanges"
          @open-workflow="handleOpenWorkflow"
          @open-request="handleOpenRequestById"
        />

        <MockWorkspace
          v-if="activeContentTab?.type === 'mock'"
          :key="activeContentTab.id"
          :serviceId="activeContentTab.id"
          @open-request="(request: MockOpenRequest) => activeContentTab && openMockRequest(request, activeContentTab.id)"
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
          :ref="el => setRequestWrapperRef(requestId, el as unknown as RequestWrapperHandle | null)"
          :requestId="requestId"
          :isActive="activeContentTab?.type === 'request' && activeContentTab.id === requestId"
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
    
    <NewMockDialog v-if="showNewMockDialog" v-model:visible="showNewMockDialog" @created="handleOpenMock" />

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

:deep(.sidebar-tabs .p-tabview-nav-link),
:deep(.sidebar-tabs .p-tabview-tab-header) {
  padding: 0.75rem 0.625rem;
  font-size: 13px;
  font-weight: 500;
}

/* 四个页签平分宽度，窄侧栏中也不需要横向滚动 */
:deep(.sidebar-tabs .p-tabview-tablist-item) {
  flex: 1 1 auto;
}

:deep(.sidebar-tabs .p-tabview-tab-header) {
  justify-content: center;
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
</style>
