<script setup>
import { defineAsyncComponent, ref, onMounted, onBeforeUnmount } from 'vue';
import { useToast } from 'primevue/usetoast';
import { useConfirm } from 'primevue/useconfirm';
import { storageService } from '@/services/storage';
import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import { useEnvironmentsStore } from '@/stores/environments';
import { useHistoryStore } from '@/stores/history';
import { useAppStateStore } from '@/stores/appState';
import { useSequencesStore } from '@/stores/sequences';
import { useWorkflowsStore } from '@/stores/workflows';
import { useConsoleLogsStore } from '@/stores/consoleLogs';
import { importExportService } from '@/services/import-export';
import { parseCurl } from '@/utils/curl-parser';
import { generateId } from '@/utils/id-generator';
import { parseRequestUrl } from '@/utils/urlQuery';
import { createDefaultTestConfig } from '@/utils/requestTests';
import Navbar from "@/components/Navbar.vue";
import Footer from "@/components/Footer.vue";

const Toolbar = defineAsyncComponent(() => import('@/components/Toolbar.vue'));
const MainContent = defineAsyncComponent(() => import('@/components/MainContent.vue'));
const CreateNewModal = defineAsyncComponent(() => import('@/components/CreateNewModal.vue'));

const toast = useToast();
const confirm = useConfirm();
const mainContentRef = ref(null);
const showCreateNewModal = ref(false);
const pendingWorkspaceActions = [];

// Initialize stores
const collectionsStore = useCollectionsStore();
const requestsStore = useRequestsStore();
const environmentsStore = useEnvironmentsStore();
const historyStore = useHistoryStore();
const appStateStore = useAppStateStore();
const sequencesStore = useSequencesStore();
const workflowsStore = useWorkflowsStore();
const consoleLogsStore = useConsoleLogsStore();

// ── Editable-area right-click context menu ─────────────────────────────
const editCtxMenu = ref({ visible: false, x: 0, y: 0 });
let editCtxTarget = null;

const closeEditContextMenu = () => {
  editCtxMenu.value = { ...editCtxMenu.value, visible: false };
};

// Close on any outside mousedown
const handleOutsideMouseDown = () => {
  if (editCtxMenu.value.visible) closeEditContextMenu();
};

// Always prevent the browser's default context menu.
// For editable elements, also show our custom 4-item menu.
const handleContextMenu = (event) => {
  event.preventDefault();

  const target = event.target;
  const isEditable =
    (target.tagName === 'INPUT' && target.type !== 'hidden') ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable ||
    !!target.closest('[contenteditable="true"]');

  if (isEditable) {
    editCtxTarget = target;
    const menuW = 148, menuH = 152;
    editCtxMenu.value = {
      visible: true,
      x: Math.min(event.clientX, window.innerWidth  - menuW - 8),
      y: Math.min(event.clientY, window.innerHeight - menuH - 8),
    };
  } else {
    closeEditContextMenu();
  }
};

const ctxCut = () => { document.execCommand('cut'); closeEditContextMenu(); };
const ctxCopy = () => { document.execCommand('copy'); closeEditContextMenu(); };
const ctxPaste = async () => {
  try {
    const text = await navigator.clipboard.readText();
    document.execCommand('insertText', false, text);
  } catch {
    document.execCommand('paste');
  }
  closeEditContextMenu();
};
const ctxSelectAll = () => {
  const el = editCtxTarget;
  if (el) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.select();
    } else {
      document.execCommand('selectAll');
    }
  }
  closeEditContextMenu();
};

onMounted(async () => {
  window.$toast = toast;
  window.$confirm = confirm;

  // Disable default browser context menu (Back/Refresh/Save As/Print)
  document.addEventListener('contextmenu', handleContextMenu);
  // Close custom context menu on outside click
  document.addEventListener('mousedown', handleOutsideMouseDown);

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
      workflowsStore.loadWorkflows()
    ]);

    performance.mark('data-ready');
    
    console.log('Application data loaded successfully');
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

onBeforeUnmount(async () => {
  // Remove global keyboard shortcut
  window.removeEventListener('keydown', handleGlobalKeyDown);
  // Remove context menu blockers
  document.removeEventListener('contextmenu', handleContextMenu);
  document.removeEventListener('mousedown', handleOutsideMouseDown);
  
  try {
    // Save app state before closing
    await appStateStore.saveState();
    await historyStore.flush();
    await consoleLogsStore.flush();
    // Flush any pending saves
    await storageService.flush();
  } catch (error) {
    console.error('Failed to save app state:', error);
  }
});

const handleClearConsole = () => {
  void consoleLogsStore.clearLogs();
};

const handleAddConsoleLog = (log) => {
  void consoleLogsStore.addLog(log);
};

const runWhenWorkspaceReady = (action) => {
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

const handleImportFile = async () => {
  try {
    const result = await importExportService.importCollection();
    if (!result) return; // User cancelled

    const collectionsToImport = result.collections || (result.collection ? [result.collection] : []);
    const importedNames = [];

    for (const collection of collectionsToImport) {
      const requests = result.requests.filter(request => request.collectionId === collection.id);

      // Check for duplicate collection name and rename if necessary
      let collectionName = collection.name;
      if (collectionsStore.collections.some(c => c.name === collectionName)) {
        // First try with "Imported"
        collectionName = `${collection.name} (Imported)`;
        let counter = 2;
        // If still duplicate, add counter
        while (collectionsStore.collections.some(c => c.name === collectionName)) {
          collectionName = `${collection.name} (Imported ${counter})`;
          counter++;
        }
      }

      // Create collection with potentially renamed name
      const newCollection = await collectionsStore.createCollection(
        collectionName,
        collection.description
      );

      if (newCollection) {
        // Update collection structure with remapped IDs
        await collectionsStore.updateCollection(newCollection.id, {
          folders: collection.folders,
          requests: collection.requests
        });

        // Save all requests with remapped IDs
        for (const request of requests) {
          // Ensure collectionId is set to the new collection
          request.collectionId = newCollection.id;
          await requestsStore.saveRequest(request);
        }

        importedNames.push(collectionName);
      }
    }

    if (importedNames.length > 0) {
      toast.add({
        severity: 'success',
        summary: 'Success',
        detail: importedNames.length === 1
          ? `Collection "${importedNames[0]}" imported successfully`
          : `${importedNames.length} collections imported successfully`,
        life: 3000
      });
    }
  } catch (error) {
    console.error('Failed to import collection:', error);
    toast.add({
      severity: 'error',
      summary: 'Import Failed',
      detail: error.message || 'Failed to import collection',
      life: 5000
    });
  }
};

const handleImportCurl = async (curlCommand) => {
  try {
    const parsed = parseCurl(curlCommand);
    
    // Create a new request from parsed cURL
    const { params: urlParams } = parseRequestUrl(parsed.url);
    const params = urlParams.length > 0
      ? [...urlParams, { key: '', value: '', enabled: true }]
      : [{ key: '', value: '', enabled: true }];

    let requestName = 'Untitled Request';

    const newRequest = {
      id: generateId(),
      name: requestName,
      method: parsed.method,
      url: parsed.url,
      params,
      headers: parsed.headers,
      body: parsed.body,
      auth: parsed.auth,
      settings: parsed.settings,
      tests: createDefaultTestConfig(),
      testsConfig: createDefaultTestConfig(),
      collectionId: null,
      folderId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
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
const handleGlobalKeyDown = (event) => {
  // Ctrl+N or Cmd+N to open Create New modal
  if ((event.ctrlKey || event.metaKey) && event.key === 'n' && !event.shiftKey) {
    event.preventDefault();
    showCreateNewModal.value = true;
  }
  
  // Ctrl+D or Cmd+D to duplicate selected item in Collections
  // CollectionsPanel has its own handler, so we don't need to do anything here
  // The event will bubble up to CollectionsPanel's global listener
  
  // Ctrl+Shift+D or Cmd+Shift+D to toggle theme
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'D') {
    event.preventDefault();
    handleToggleTheme();
  }
};

// Handle create action from modal
const handleCreate = (type) => {
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
  }
};

// Handle toggle theme
const handleToggleTheme = () => {
  const isDark = document.documentElement.classList.contains('p-dark');
  
  if (isDark) {
    document.documentElement.classList.remove('p-dark');
    localStorage.setItem('theme', 'light');
  } else {
    document.documentElement.classList.add('p-dark');
    localStorage.setItem('theme', 'dark');
  }
};
</script>

<template>
  <div class="app-container flex flex-col h-screen bg-surface-0 dark:bg-surface-950 relative">
    <Toast position="top-right" />
    <ConfirmDialog />

    <!-- Custom right-click context menu for editable areas -->
    <Teleport to="body">
      <div
        v-if="editCtxMenu.visible"
        class="fixed z-[9999] min-w-[140px] rounded-lg border border-surface-200 bg-surface-0 py-1 shadow-xl dark:border-surface-600 dark:bg-surface-800"
        :style="{ left: editCtxMenu.x + 'px', top: editCtxMenu.y + 'px' }"
        @mousedown.stop.prevent
        @contextmenu.prevent
      >
        <button
          class="flex w-full items-center gap-2.5 px-3 py-[6px] text-left text-sm text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
          @click="ctxCut"
        >
          <i class="pi pi-minus-circle text-meta opacity-60"></i>
          Cut
        </button>
        <button
          class="flex w-full items-center gap-2.5 px-3 py-[6px] text-left text-sm text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
          @click="ctxCopy"
        >
          <i class="pi pi-copy text-meta opacity-60"></i>
          Copy
        </button>
        <button
          class="flex w-full items-center gap-2.5 px-3 py-[6px] text-left text-sm text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
          @click="ctxPaste"
        >
          <i class="pi pi-clipboard text-meta opacity-60"></i>
          Paste
        </button>
        <div class="mx-1 my-1 border-t border-surface-200 dark:border-surface-600"></div>
        <button
          class="flex w-full items-center gap-2.5 px-3 py-[6px] text-left text-sm text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
          @click="ctxSelectAll"
        >
          <i class="pi pi-check-square text-meta opacity-60"></i>
          Select All
        </button>
      </div>
    </Teleport>

    <CreateNewModal
      v-if="showCreateNewModal"
      v-model:visible="showCreateNewModal"
      @create="handleCreate"
    />
    
    <Navbar />
    <Suspense>
      <Toolbar
        @new-request="handleNewRequest"
        @import-file="handleImportFile"
        @import-curl="handleImportCurl"
      />
      <template #fallback>
        <div class="h-[49px] border-b border-surface-200 bg-surface-0 dark:border-surface-700 dark:bg-surface-950"></div>
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
    />
  </div>
</template>

<style scoped>
</style>
