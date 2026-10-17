import { ref, computed, watch, nextTick, type Ref } from 'vue';
import { cloneJson } from '@/utils/clone';
import { generateId } from '@/utils/id-generator';
import { useAppStateStore } from '@/stores/appState';
import { useRequestsStore } from '@/stores/requests';
import { useWorkflowsStore } from '@/stores/workflows';
import type { ContentTab, ContentTabType } from '@/stores/appState';
import type { Request, WorkflowDefinition } from '@/types/models';

/** HttpRequestWrapper 通过 defineExpose 暴露的接口（模板引用会自动解包其中的 ref） */
export interface RequestWrapperHandle {
  request: Request | null;
  hasUnsavedChanges: () => boolean;
  saveCurrentRequest: () => Promise<void>;
  openSaveDialog: () => void;
  restoreOriginalRequest: () => Promise<void>;
}

/** WorkflowWorkspace 通过 defineExpose 暴露的接口 */
export interface WorkflowWorkspaceHandle {
  saveCurrentWorkflow: () => Promise<void>;
  restoreOriginalWorkflow: () => Promise<void>;
  workflow: WorkflowDefinition | null;
}

/** CollectionsPanel 中页签用到的接口 */
export interface CollectionsPanelHandle {
  selectRequestNode: (requestId: string, collectionId: string, folderId?: string | null) => void;
  clearSelection: () => void;
}

export interface WorkspaceTabsOptions {
  /** 侧边栏集合面板，用来同步选中的请求 */
  collectionsPanelRef: Ref<CollectionsPanelHandle | null>;
  /** 把指定页签滚动到可见位置 */
  scrollTabIntoView: (index: number) => void;
}

/**
 * 内容区页签：请求与 Workflow 页签的打开、选择、排序、关闭、复制和未保存标记，
 * 以及每个页签对应的编辑器保持挂载（切换页签只隐藏不销毁）。启动时恢复上次打开的页签。
 */
export function useWorkspaceTabs({ collectionsPanelRef, scrollTabIntoView }: WorkspaceTabsOptions) {
  const appStateStore = useAppStateStore();
  const requestsStore = useRequestsStore();
  const workflowsStore = useWorkflowsStore();

  // 组件实例不需要深层响应式，只按 id 查找
  const requestWrapperRefs = ref<Record<string, RequestWrapperHandle>>({});
  const workflowWorkspaceRefs = ref<Record<string, WorkflowWorkspaceHandle>>({});
  const showWorkflowWorkspace = ref(false);
  // 每个打开过的 workflow 页签各自保持挂载（与请求页签一致），
  // 切换页签只隐藏不销毁，保留其中输入框的撤销历史
  const mountedWorkflowIds = ref<string[]>([]);
  const mountedRequestIds = ref<string[]>([]);
  const workflowUnsavedChangesMap = ref<Record<string, boolean>>({});

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

  const openMockTabs = computed({
    get: () => appStateStore.openMocks,
    set: (value) => appStateStore.updateOpenMocks(value)
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
      if (wrapperRef?.request) return wrapperRef.request;
      // 如果组件还没加载，从 store 获取
      return requestsStore.requests.get(requestId) || null;
    }
    return null;
  });

  // 请求与 workflow 页签共用一套顺序（appState.tabOrder），可任意混排
  const contentTabs = computed(() => appStateStore.contentTabs);

  const activeContentTab = computed<ContentTab | null>(() => contentTabs.value[activeContentIndex.value] || null);
  const mountedOpenRequestIds = computed(() => {
    const openIds = new Set(openRequests.value);
    return mountedRequestIds.value.filter(id => openIds.has(id));
  });

  const ensureRequestMounted = (requestId: string) => {
    if (!requestId || mountedRequestIds.value.includes(requestId)) return;
    mountedRequestIds.value = [...mountedRequestIds.value, requestId];
  };

  const mountedOpenWorkflowIds = computed(() => {
    const openIds = new Set(openWorkflowTabs.value);
    return mountedWorkflowIds.value.filter(id => openIds.has(id));
  });

  const ensureWorkflowMounted = (workflowId: string) => {
    if (!workflowId || mountedWorkflowIds.value.includes(workflowId)) return;
    mountedWorkflowIds.value = [...mountedWorkflowIds.value, workflowId];
  };

  const removeMountedWorkflow = (workflowId: string) => {
    if (!workflowId) return;
    mountedWorkflowIds.value = mountedWorkflowIds.value.filter(id => id !== workflowId);
    delete workflowWorkspaceRefs.value[workflowId];
  };

  watch(openWorkflowTabs, (workflowIds) => {
    const openIds = new Set(workflowIds || []);
    mountedWorkflowIds.value
      .filter(workflowId => !openIds.has(workflowId))
      .forEach(removeMountedWorkflow);
  });

  const setWorkflowWorkspaceRef = (workflowId: string, instance: WorkflowWorkspaceHandle | null) => {
    if (instance) {
      workflowWorkspaceRefs.value[workflowId] = instance;
    } else {
      delete workflowWorkspaceRefs.value[workflowId];
    }
  };

  const removeMountedRequest = (requestId: string) => {
    if (!requestId) return;
    mountedRequestIds.value = mountedRequestIds.value.filter(id => id !== requestId);
    delete requestWrapperRefs.value[requestId];
  };

  const setRequestWrapperRef = (requestId: string, instance: RequestWrapperHandle | null) => {
    if (instance) {
      requestWrapperRefs.value[requestId] = instance;
    } else {
      delete requestWrapperRefs.value[requestId];
    }
  };

  const waitForRequestWrapper = async (requestId: string, timeoutMs = 3000): Promise<RequestWrapperHandle | null> => {
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
      if (tab.type === 'mock') {
        showWorkflowWorkspace.value = false;
        return;
      }

      ensureWorkflowMounted(tab.id);
      showWorkflowWorkspace.value = true;
    },
    { immediate: true }
  );

  const getWorkflowName = (workflowId: string) => {
    return workflowsStore.getWorkflowDraft(workflowId)?.name
      || workflowsStore.workflows.find(workflow => workflow.id === workflowId)?.name
      || 'Untitled Workflow';
  };

  const findContentTabIndex = (type: ContentTabType, id: string) => {
    return appStateStore.getContentTabIndex(type, id);
  };


  const selectContentTab = (index: number) => {
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
    } else if (tab.type === 'mock') {
      appStateStore.setActiveRequest(-1);
      showWorkflowWorkspace.value = false;
    } else {
      appStateStore.setActiveRequest(-1);
      workflowsStore.activeWorkflowId = tab.id;
      ensureWorkflowMounted(tab.id);
      showWorkflowWorkspace.value = true;
    }

    scrollTabIntoView(nextIndex);
  };

  // 将拖拽的 tab 从 fromIndex 移动到 toIndex（只改统一页签顺序）
  const reorderContentTabs = (fromIndex: number | null, toIndex: number | null) => {
    if (fromIndex === toIndex || fromIndex === null || toIndex === null) return;

    // 记录当前激活的 tab，排序后保持选中
    const activeTab = contentTabs.value[activeContentIndex.value] || null;

    appStateStore.moveTab(fromIndex, toIndex);

    // 重新定位激活 tab，避免排序后选中错乱
    nextTick(() => {
      if (activeTab) {
        const newIndex = findContentTabIndex(activeTab.type, activeTab.id);
        if (newIndex >= 0) selectContentTab(newIndex);
      }
    });
  };

  const openWorkflowTab = (workflowId: string) => {
    if (!openWorkflowTabs.value.includes(workflowId)) {
      openWorkflowTabs.value = [...openWorkflowTabs.value, workflowId];
    }
    workflowUnsavedChangesMap.value[workflowId] = Boolean(workflowsStore.getWorkflowDraft(workflowId));
    nextTick(() => {
      const index = findContentTabIndex('workflow', workflowId);
      if (index >= 0) selectContentTab(index);
    });
  };

  const openRequestTab = async (requestId: string) => {
    appStateStore.addOpenRequest(requestId);
    await nextTick();
    const index = findContentTabIndex('request', requestId);
    if (index >= 0) selectContentTab(index);
  };

  const openMockTab = (serviceId: string) => {
    if (!openMockTabs.value.includes(serviceId)) {
      openMockTabs.value = [...openMockTabs.value, serviceId];
    }
    nextTick(() => {
      const index = findContentTabIndex('mock', serviceId);
      if (index >= 0) selectContentTab(index);
    });
  };

  // Mock 服务的修改直接保存，关闭页签不需要确认
  const closeMockTab = (serviceId: string) => {
    const contentIndex = findContentTabIndex('mock', serviceId);
    if (contentIndex < 0) return;

    const activeIndexBeforeClose = activeContentIndex.value;
    const wasActive = activeContentTab.value?.type === 'mock' && activeContentTab.value.id === serviceId;
    openMockTabs.value = openMockTabs.value.filter(id => id !== serviceId);

    if (contentTabs.value.length === 0) {
      selectContentTab(0);
      return;
    }
    if (wasActive) {
      selectContentTab(Math.min(contentIndex, contentTabs.value.length - 1));
    } else if (contentIndex < activeIndexBeforeClose) {
      selectContentTab(activeIndexBeforeClose - 1);
    }
  };

  const createNewWorkflow = async () => {
    const workflow = await workflowsStore.createWorkflow(`Workflow ${workflowsStore.workflows.length + 1}`);
    openWorkflowTab(workflow.id);
  };

  const closeWorkflowTab = (workflowId: string) => {
    const contentIndex = findContentTabIndex('workflow', workflowId);
    if (contentIndex < 0) return;

    const activeIndexBeforeClose = activeContentIndex.value;
    const wasActive = activeContentTab.value?.type === 'workflow' && activeContentTab.value.id === workflowId;
    openWorkflowTabs.value = openWorkflowTabs.value.filter(id => id !== workflowId);
    delete workflowUnsavedChangesMap.value[workflowId];
    workflowsStore.clearWorkflowDraft(workflowId);
    removeMountedWorkflow(workflowId);

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

  const saveWorkflowById = async (workflowId: string) => {
    const workspace = workflowWorkspaceRefs.value[workflowId];
    if (workspace) {
      await workspace.saveCurrentWorkflow();
      return;
    }

    const draft = workflowsStore.getWorkflowDraft(workflowId);
    if (draft) {
      await workflowsStore.saveWorkflow(draft);
      workflowUnsavedChangesMap.value[workflowId] = false;
    }
  };

  const restoreWorkflowById = async (workflowId: string) => {
    const workspace = workflowWorkspaceRefs.value[workflowId];
    if (workspace) {
      await workspace.restoreOriginalWorkflow();
      return;
    }

    await workflowsStore.restoreWorkflowDraft(workflowId);
    workflowUnsavedChangesMap.value[workflowId] = false;
  };

  const clearWorkflowTabs = () => {
    openWorkflowTabs.value.forEach(id => workflowsStore.clearWorkflowDraft(id));
    openWorkflowTabs.value = [];
    mountedWorkflowIds.value = [];
    workflowWorkspaceRefs.value = {};
    showWorkflowWorkspace.value = false;
    workflowUnsavedChangesMap.value = {};
  };

  const discardRequestDraft = async (requestId: string) => {
    const wrapperRef = requestWrapperRefs.value[requestId];
    if (wrapperRef && typeof wrapperRef.restoreOriginalRequest === 'function') {
      await wrapperRef.restoreOriginalRequest();
    } else {
      // 标签未挂载时，直接在 store 层丢弃草稿（删除暂存编辑并载回已保存版本）
      await requestsStore.discardRequestDraft(requestId);
    }
    delete unsavedChangesMap.value[requestId];
  };

  const discardWorkflowDraft = async (workflowId: string) => {
    await restoreWorkflowById(workflowId);
    delete workflowUnsavedChangesMap.value[workflowId];
  };

  const discardUnsavedDrafts = async (requestIds: string[] = [], workflowIds: string[] = []) => {
    for (const requestId of requestIds) {
      await discardRequestDraft(requestId);
    }
    for (const workflowId of workflowIds) {
      await discardWorkflowDraft(workflowId);
    }
  };

  const confirmDiscardTabs = (unsavedCount: number, acceptLabel: string, onAccept: () => Promise<boolean>): Promise<boolean> => {
    const confirm = window.$confirm;
    if (unsavedCount <= 0 || !confirm) {
      return onAccept();
    }

    return new Promise((resolve) => {
      let handled = false;
      confirm.require({
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

  const closeContentTab = async (tab: ContentTab, contentIndex: number) => {
    if (tab.type === 'request') {
      const requestIndex = openRequests.value.indexOf(tab.id);
      if (requestIndex >= 0) {
        const activeTabBeforeClose = activeContentTab.value;
        const wasActive = activeTabBeforeClose?.type === 'request' && activeTabBeforeClose.id === tab.id;
        await closeRequest(requestIndex);
        await nextTick();
        // 用户取消关闭（或需先另存）时页签仍在，保持现状
        if (openRequests.value.includes(tab.id)) return;

        if (contentTabs.value.length === 0) {
          selectContentTab(0);
          return;
        }
        // 关闭后台页签不切换当前页签；关闭当前页签则激活右侧相邻页签（无则左侧）
        const keepIndex = !wasActive && activeTabBeforeClose
          ? findContentTabIndex(activeTabBeforeClose.type, activeTabBeforeClose.id)
          : -1;
        selectContentTab(keepIndex >= 0 ? keepIndex : Math.min(contentIndex, contentTabs.value.length - 1));
      }
    } else if (tab.type === 'mock') {
      closeMockTab(tab.id);
    } else {
      const confirm = window.$confirm;
      if (hasWorkflowUnsavedChanges(tab.id) && confirm) {
        return new Promise((resolve) => {
          let handled = false;
          confirm.require({
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


  const duplicateRequestTab = async (requestTab: ContentTab) => {
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
    appStateStore.moveTabAfter({ type: 'request', id: duplicatedRequest.id }, requestTab);
    await nextTick();
    const index = findContentTabIndex('request', duplicatedRequest.id);
    if (index >= 0) selectContentTab(index);
  };

  const duplicateWorkflowTab = async (workflowTab: ContentTab) => {
    const workflow = workflowsStore.getWorkflowDraft(workflowTab.id)
      || workflowsStore.workflows.find(item => item.id === workflowTab.id);
    if (!workflow) return;

    const now = new Date().toISOString();
    const duplicatedWorkflow = cloneJson(workflow);
    duplicatedWorkflow.id = generateId();
    duplicatedWorkflow.name = `${workflow.name} (Copy)`;
    duplicatedWorkflow.createdAt = now;
    duplicatedWorkflow.updatedAt = now;

    await workflowsStore.saveWorkflow(duplicatedWorkflow);
    const workflowIndex = openWorkflowTabs.value.indexOf(workflowTab.id);
    const workflows = [...openWorkflowTabs.value];
    workflows.splice(workflowIndex + 1, 0, duplicatedWorkflow.id);
    openWorkflowTabs.value = workflows;
    appStateStore.moveTabAfter({ type: 'workflow', id: duplicatedWorkflow.id }, workflowTab);
    await nextTick();
    const index = findContentTabIndex('workflow', duplicatedWorkflow.id);
    if (index >= 0) selectContentTab(index);
  };

  const closeOtherContentTabs = async (keepContentIndex: number) => {
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

        openMockTabs.value = keepTab.type === 'mock' ? [keepTab.id] : [];
        if (keepTab.type === 'request') {
          appStateStore.updateOpenRequests([keepTab.id]);
          appStateStore.setActiveRequest(0);
          openWorkflowTabs.value = [];
          workflowUnsavedChangesMap.value = {};
          activeContentIndex.value = 0;
          syncCollectionsPanelSelection(keepTab.id);
        } else if (keepTab.type === 'mock') {
          unsavedChangesMap.value = {};
          appStateStore.updateOpenRequests([]);
          appStateStore.setActiveRequest(-1);
          openWorkflowTabs.value = [];
          workflowUnsavedChangesMap.value = {};
          await nextTick();
          selectContentTab(0);
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

  const openTemporaryRequest = async (request: Request) => {
    showWorkflowWorkspace.value = false;
    await requestsStore.saveRequest(request);
    appStateStore.addOpenRequest(request.id);
    await nextTick();
    const index = findContentTabIndex('request', request.id);
    if (index >= 0) selectContentTab(index);
  };

  const closeRequest = async (index: number): Promise<boolean | void> => {
    // 检查是否有未保存的变化
    const requestId = openRequests.value[index];
    const hasChanges = hasRequestUnsavedChanges(requestId);

    if (hasChanges) {
      // 检查请求是否已保存过（是否有 collectionId）
      const request = await requestsStore.loadRequest(requestId);
      const hasCollection = request && request.collectionId;

      // 显示确认对话框
      return new Promise((resolve) => {
        const confirm = window.$confirm;
        if (confirm) {
          confirm.require({
            message: 'You have unsaved changes. What would you like to do?',
            header: 'Unsaved Changes',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: 'Save',
            rejectLabel: 'Discard',
            acceptClass: 'p-button-success',
            rejectClass: 'p-button-danger',
            accept: async () => {
              let wrapperRef: RequestWrapperHandle | null | undefined = requestWrapperRefs.value[requestId];

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

  const inspectRequestTab = async (requestId: string) => {
    const wrapper = requestWrapperRefs.value[requestId];
    const request = wrapper?.request
      || requestsStore.getRequestDraft(requestId)
      || requestsStore.requests.get(requestId)
      || await requestsStore.loadRequest(requestId);
    if (!request) throw new Error(`Request not found: ${requestId}`);
    return {
      isOpen: openRequests.value.includes(requestId),
      hasUnsavedEdits: Boolean(
        wrapper?.hasUnsavedChanges()
        || hasRequestUnsavedChanges(requestId)
        || requestsStore.hasRequestDraft(requestId)
      ),
      request: cloneJson(request),
    };
  };

  const inspectWorkflowTab = async (workflowId: string) => {
    const workspace = workflowWorkspaceRefs.value[workflowId];
    const draft = workflowsStore.getWorkflowDraft(workflowId);
    const workflow = draft
      || workspace?.workflow
      || workflowsStore.workflows.find(item => item.id === workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
    return {
      isOpen: openWorkflowTabs.value.includes(workflowId),
      hasUnsavedEdits: Boolean(hasWorkflowUnsavedChanges(workflowId) || draft),
      workflow: cloneJson(workflow),
    };
  };

  const closeRequestTabFromMcp = async (requestId: string, decision?: 'save' | 'discard') => {
    let index = openRequests.value.indexOf(requestId);
    if (index < 0) throw new Error(`The request is not open in ApiKit: ${requestId}`);

    const inspection = await inspectRequestTab(requestId);
    if (inspection.hasUnsavedEdits && !decision) {
      throw new Error('Unsaved request edits require a save or discard decision');
    }
    if (decision === 'save') {
      const wrapper = requestWrapperRefs.value[requestId];
      if (wrapper) {
        await wrapper.saveCurrentRequest();
      } else {
        const request = requestsStore.getRequestDraft(requestId);
        if (!request) throw new Error(`Could not save request edits: ${requestId}`);
        await requestsStore.saveRequest(request);
      }
      if (requestWrapperRefs.value[requestId]?.hasUnsavedChanges() || requestsStore.hasRequestDraft(requestId)) {
        throw new Error('Could not save the request. Assign it to a collection or resolve the save error in ApiKit first.');
      }
      delete unsavedChangesMap.value[requestId];
    } else if (decision === 'discard') {
      await discardRequestDraft(requestId);
    }

    index = findContentTabIndex('request', requestId);
    if (index >= 0) await closeContentTab({ type: 'request', id: requestId }, index);
  };

  const closeWorkflowTabFromMcp = async (workflowId: string, decision?: 'save' | 'discard') => {
    if (!openWorkflowTabs.value.includes(workflowId)) {
      throw new Error(`The workflow is not open in ApiKit: ${workflowId}`);
    }
    if (workflowsStore.runningWorkflowId === workflowId) {
      throw new Error('The workflow is running in ApiKit and cannot be closed yet');
    }

    const inspection = await inspectWorkflowTab(workflowId);
    if (inspection.hasUnsavedEdits && !decision) {
      throw new Error('Unsaved workflow edits require a save or discard decision');
    }
    if (decision === 'save') {
      await saveWorkflowById(workflowId);
      if (hasWorkflowUnsavedChanges(workflowId) || workflowsStore.getWorkflowDraft(workflowId)) {
        throw new Error('Could not save the workflow edits. Resolve the save error in ApiKit first.');
      }
    } else if (decision === 'discard') {
      await discardWorkflowDraft(workflowId);
    }
    const contentIndex = findContentTabIndex('workflow', workflowId);
    if (contentIndex >= 0) await closeContentTab({ type: 'workflow', id: workflowId }, contentIndex);
  };

  const performCloseRequest = (index: number) => {
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
        openMockTabs.value = [];
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

    if (savedRequests.length === 0 && savedWorkflows.length === 0 && openMockTabs.value.length === 0) return;
    openMockTabs.value = [];

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
  const syncCollectionsPanelSelection = async (requestId: string) => {
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

  // 用于触发名称更新的响应式变量
  const requestNamesVersion = ref(0);

  // 创建一个 computed 来追踪所有打开请求的名称（确保响应式）
  const openRequestNames = computed(() => {
    // 依赖 requestNamesVersion 和 openRequests 来触发重新计算
    requestNamesVersion.value;
    const names: Record<string, string> = {};
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
  const unsavedChangesMap = ref<Record<string, boolean>>({});

  // 检查请求是否有未保存的变化
  const hasRequestUnsavedChanges = (requestId: string) => {
    return unsavedChangesMap.value[requestId] || false;
  };

  const hasWorkflowUnsavedChanges = (workflowId: string) => {
    return workflowUnsavedChangesMap.value[workflowId] || false;
  };

  const handleWorkflowUnsavedChanges = (workflowId: string, hasChanges: boolean) => {
    workflowUnsavedChangesMap.value[workflowId] = hasChanges;
  };

  // 更新请求的未保存状态
  const updateUnsavedStatus = (requestId: string, hasChanges: boolean) => {
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

  const restoreOpenMocks = (existingIds: string[]) => {
    const existing = new Set(existingIds);
    const restored = openMockTabs.value.filter(id => existing.has(id));
    if (restored.length !== openMockTabs.value.length) openMockTabs.value = restored;
  };

  return {
    openRequests,
    activeRequestIndex,
    openWorkflowTabs,
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
    inspectRequestTab,
    inspectWorkflowTab,
    closeRequestTabFromMcp,
    closeWorkflowTabFromMcp,
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
  };
}
