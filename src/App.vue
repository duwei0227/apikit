<script setup lang="ts">
import { defineAsyncComponent, ref, onMounted, onBeforeUnmount } from 'vue';
import { useToast } from 'primevue/usetoast';
import { useConfirm } from 'primevue/useconfirm';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { storageService } from '@/services/storage';
import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import { useEnvironmentsStore } from '@/stores/environments';
import { useHistoryStore } from '@/stores/history';
import { useAppStateStore } from '@/stores/appState';
import { useSequencesStore } from '@/stores/sequences';
import { useWorkflowsStore } from '@/stores/workflows';
import { useMocksStore } from '@/stores/mocks';
import { useConsoleLogsStore } from '@/stores/consoleLogs';
import { useMcpStore } from '@/stores/mcp';
import { consoleLogToHistoryItem } from '@/utils/history';
import { useContextMenuEscape } from '@/composables/useContextMenuEscape';
import { useTheme } from '@/composables/useTheme';
import Navbar from "@/components/Navbar.vue";
import Footer from "@/components/Footer.vue";
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { ConsoleLog } from '@/types/models';
import { matchesShortcut } from '@/utils/shortcuts';

/** MainContent 通过 defineExpose 暴露的接口（模板引用会自动解包其中的 ref） */
interface WorkspaceHandle {
  createNewRequest: () => Promise<void>;
  collectionsPanelRef: { openCreateDialog: (mode?: 'collection' | 'folder') => void } | null;
  environmentManagerRef: { openCreateDialog: () => void } | null;
  showMocks: () => void;
  openNewMockDialog: () => void;
}

type WorkspaceAction = (workspace: WorkspaceHandle) => void;

const Toolbar = defineAsyncComponent(() => import('@/components/Toolbar.vue'));
const MainContent = defineAsyncComponent(() => import('@/components/MainContent.vue'));
const CreateNewModal = defineAsyncComponent(() => import('@/components/CreateNewModal.vue'));
const McpConfirmDialog = defineAsyncComponent(() => import('@/components/McpConfirmDialog.vue'));

const toast = useToast();
const { toggleTheme } = useTheme();
const confirm = useConfirm();
const mainContentRef = ref<WorkspaceHandle | null>(null);
const showCreateNewModal = ref(false);
const pendingWorkspaceActions: WorkspaceAction[] = [];

// Initialize stores
const collectionsStore = useCollectionsStore();
const requestsStore = useRequestsStore();
const environmentsStore = useEnvironmentsStore();
const historyStore = useHistoryStore();
const appStateStore = useAppStateStore();
const sequencesStore = useSequencesStore();
const workflowsStore = useWorkflowsStore();
const consoleLogsStore = useConsoleLogsStore();
const mcpStore = useMcpStore();
const mocksStore = useMocksStore();

// ── Editable-area right-click context menu ─────────────────────────────
// 输入框、文本框和可编辑区域的右键菜单（剪切、复制、粘贴、全选）。
// 菜单打开时焦点会移到菜单上，执行命令前先把焦点和选区还给原来的元素。
const editMenu = ref<{ show: (event: Event) => void; hide: () => void } | null>(null);
const { onShow: onEditMenuShow, onHide: onEditMenuHide } = useContextMenuEscape(editMenu);
let editCtxTarget: HTMLElement | null = null;
let editCtxRange: Range | null = null;

const isTextField = (el: HTMLElement): el is HTMLInputElement | HTMLTextAreaElement => (
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
);

const restoreEditTarget = () => {
  const el = editCtxTarget;
  if (!el) return;
  el.focus({ preventScroll: true });
  // 输入框获得焦点时保留原来的选区；可编辑区域需要手动恢复
  if (!isTextField(el) && editCtxRange) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(editCtxRange);
  }
};

const ctxPaste = async () => {
  restoreEditTarget();
  try {
    const text = await navigator.clipboard.readText();
    document.execCommand('insertText', false, text);
  } catch {
    document.execCommand('paste');
  }
};

const ctxSelectAll = () => {
  const el = editCtxTarget;
  if (!el) return;
  restoreEditTarget();
  if (isTextField(el)) el.select();
  else document.execCommand('selectAll');
};

const editMenuItems = [
  { label: 'Cut', icon: 'pi pi-minus-circle', command: () => { restoreEditTarget(); document.execCommand('cut'); } },
  { label: 'Copy', icon: 'pi pi-copy', command: () => { restoreEditTarget(); document.execCommand('copy'); } },
  { label: 'Paste', icon: 'pi pi-clipboard', command: ctxPaste },
  { separator: true },
  { label: 'Select All', icon: 'pi pi-check-square', command: ctxSelectAll },
];

// Always prevent the browser's default context menu.
// For editable elements, also show the edit menu.
const handleContextMenu = (event: MouseEvent) => {
  event.preventDefault();

  const target = event.target as HTMLElement;
  const isEditable =
    (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'hidden') ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable ||
    !!target.closest('[contenteditable="true"]');

  if (isEditable) {
    editCtxTarget = target;
    const selection = window.getSelection();
    editCtxRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    editMenu.value?.show(event);
  } else {
    editMenu.value?.hide();
  }
};

onMounted(async () => {
  window.$toast = toast;
  window.$confirm = confirm;

  // Disable default browser context menu (Back/Refresh/Save As/Print)
  document.addEventListener('contextmenu', handleContextMenu);

  // Add global keyboard shortcut for Ctrl+N
  window.addEventListener('keydown', handleGlobalKeyDown);
  
  try {
    // Initialize storage service
    await storageService.initialize();

    // Restore staged request edits BEFORE anything else. Tab restoration
    // (MainContent) is gated only on appState/workflows loading, so the draft
    // map MUST be populated before `loadState` can trigger a `loadRequest`.
    // Otherwise the saved version gets cached as the working copy and a
    // subsequent no-op auto-save deletes the draft — losing the edits.
    await requestsStore.loadRequestDrafts();

    // Load all data
    await Promise.all([
      collectionsStore.loadCollections(),
      environmentsStore.loadEnvironments(),
      historyStore.loadHistory(),
      consoleLogsStore.loadLogs(),
      appStateStore.loadState(),
      sequencesStore.loadSequences(),
      workflowsStore.loadWorkflows(),
      mocksStore.loadServices()
    ]);

    performance.mark('data-ready');

    // 数据加载完成后再接收 Mock 请求，并启动设为随 ApiKit 启动的服务
    await mocksStore.initialize();

    // 数据加载完成后再启动 MCP 服务，避免 AI 读到空数据
    await mcpStore.initialize({
      // 与编辑器发送的请求一致：同时写入 Console 和 History
      onConsoleLog: (log) => {
        handleAddConsoleLog(log);
        void historyStore.addHistoryItem(consoleLogToHistoryItem(log));
      }
    });
    
  } catch (error) {
    console.error('Failed to initialize application:', error);
    toast.add({
      severity: 'error',
      summary: 'Initialization Error',
      detail: 'Failed to load application data',
      life: 5000
    });
  }
});

// 写完所有延迟或合并保存的数据（标签页状态、日志、序列号、全局变量、Collection 和请求）
const flushPendingSaves = async () => {
  try {
    await appStateStore.saveState();
    await Promise.all([
      historyStore.flush(),
      consoleLogsStore.flush(),
      sequencesStore.flush(),
      environmentsStore.flush(),
      mocksStore.flush(),
    ]);
    await storageService.flush();
  } catch (error) {
    console.error('Failed to save app state:', error);
  }
};

// 关闭窗口时 webview 直接销毁，不会触发 onBeforeUnmount；在关闭请求中先保存再关闭
let unlistenCloseRequested: UnlistenFn | null = null;
getCurrentWindow().onCloseRequested(async () => {
  await flushPendingSaves();
}).then(unlisten => {
  unlistenCloseRequested = unlisten;
}).catch(error => {
  console.error('Failed to register close handler:', error);
});

onBeforeUnmount(async () => {
  // Remove global keyboard shortcut
  window.removeEventListener('keydown', handleGlobalKeyDown);
  // Remove context menu blockers
  document.removeEventListener('contextmenu', handleContextMenu);
  unlistenCloseRequested?.();
  await flushPendingSaves();
});

const handleClearConsole = () => {
  void consoleLogsStore.clearLogs();
};

const handleAddConsoleLog = (log: ConsoleLog) => {
  void consoleLogsStore.addLog(log);
};

const runWhenWorkspaceReady = (action: WorkspaceAction) => {
  if (mainContentRef.value) {
    action(mainContentRef.value);
    return;
  }

  pendingWorkspaceActions.push(action);
};

const handleMainContentReady = () => {
  const workspace = mainContentRef.value;
  if (!workspace) return;

  const actions = pendingWorkspaceActions.splice(0);
  actions.forEach(action => action(workspace));
};

const handleNewRequest = () => {
  runWhenWorkspaceReady(workspace => workspace.createNewRequest());
};

const handleImportCurl = async (curlCommand: string) => {
  try {
    const { parseCurl, requestFromCurl } = await import('@/utils/curl-parser');
    const parsed = parseCurl(curlCommand);
    const newRequest = requestFromCurl(parsed);
    
    // Save request
    await requestsStore.saveRequest(newRequest);
    
    // Open in tab
    appStateStore.addOpenRequest(newRequest.id);

    if (parsed.warnings.length > 0) {
      toast.add({
        severity: 'warn',
        summary: 'Imported with warnings',
        detail: parsed.warnings.map(warning => warning.message).join(' '),
        life: 5000
      });
    }
    
    toast.add({
      severity: 'success',
      summary: 'Success',
      detail: 'cURL command imported successfully',
      life: 3000
    });
  } catch (error) {
    console.error('Failed to import cURL:', error);
    toast.add({
      severity: 'error',
      summary: 'Import Failed',
      detail: 'Failed to parse cURL command',
      life: 5000
    });
  }
};

// Global keyboard shortcut handler
const handleGlobalKeyDown = (event: KeyboardEvent) => {
  // Ctrl+N or Cmd+N to open Create New modal
  if (matchesShortcut(event, { key: 'n', mod: true })) {
    event.preventDefault();
    showCreateNewModal.value = true;
  }
  
  // Ctrl+D or Cmd+D to duplicate selected item in Collections
  // CollectionsPanel has its own handler, so we don't need to do anything here
  // The event will bubble up to CollectionsPanel's global listener
  
  // Ctrl+Alt+D to toggle theme（Ctrl+Shift+D 留给编辑器复制行；macOS 上用 Ctrl+Option+D，Cmd+Option+D 是系统的隐藏 Dock）
  if (matchesShortcut(event, { key: 'd', mod: true, alt: true })) {
    event.preventDefault();
    toggleTheme();
  }
};

// Handle create action from modal
const handleCreate = (type: 'request' | 'collection' | 'environment' | 'mock') => {
  if (type === 'request') {
    handleNewRequest();
  } else if (type === 'collection') {
    runWhenWorkspaceReady(workspace => {
      workspace.collectionsPanelRef?.openCreateDialog('collection');
    });
  } else if (type === 'environment') {
    runWhenWorkspaceReady(workspace => {
      workspace.environmentManagerRef?.openCreateDialog();
    });
  } else if (type === 'mock') {
    runWhenWorkspaceReady(workspace => {
      workspace.showMocks();
      workspace.openNewMockDialog();
    });
  }
};
</script>

<template>
  <div class="app-container flex flex-col h-screen bg-surface-0 dark:bg-surface-950 relative">
    <Toast position="top-right" />
    <ConfirmDialog />

    <!-- 可编辑区域的右键菜单 -->
    <ContextMenu ref="editMenu" :model="editMenuItems" @before-show="onEditMenuShow" @hide="onEditMenuHide" />

    <CreateNewModal
      v-if="showCreateNewModal"
      v-model:visible="showCreateNewModal"
      @create="handleCreate"
    />
    
    <Navbar />
    <Suspense>
      <Toolbar
        @new-request="handleNewRequest"
        @import-curl="handleImportCurl"
      />
      <template #fallback>
        <div class="h-[49px] border-b border-surface-200 bg-surface-0 dark:border-surface-700 dark:bg-surface-900"></div>
      </template>
    </Suspense>
    <Suspense>
      <MainContent
        ref="mainContentRef"
        class="pb-[33px]"
        @add-console-log="handleAddConsoleLog"
        @ready="handleMainContentReady"
      />
      <template #fallback>
        <div class="flex-1 flex items-center justify-center bg-surface-0 dark:bg-surface-950">
          <div class="text-center text-surface-500">
            <i class="pi pi-spin pi-spinner text-2xl mb-2"></i>
            <p class="m-0 text-xs">Loading workspace…</p>
          </div>
        </div>
      </template>
    </Suspense>
    <Footer
      :consoleLogs="consoleLogsStore.logs"
      @clear-console="handleClearConsole"
      @open-mocks="mainContentRef?.showMocks()"
    />
    <McpConfirmDialog v-if="mcpStore.currentConfirmation" />
  </div>
</template>

<style scoped>
</style>
