<script setup lang="ts">
import { computed, defineAsyncComponent, ref, shallowRef, onMounted, onBeforeUnmount } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { Channel, invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { docsUrlFor } from '@/utils/appLinks';
import { useMcpStore } from '@/stores/mcp';
import { useTheme } from '@/composables/useTheme';
import { matchesShortcut } from '@/utils/shortcuts';
const KeyboardShortcutsDialog = defineAsyncComponent(() => import('./KeyboardShortcutsDialog.vue'));
const AboutDialog = defineAsyncComponent(() => import('./AboutDialog.vue'));
const McpDialog = defineAsyncComponent(() => import('./McpDialog.vue'));
const UpdateDialog = defineAsyncComponent(() => import('./UpdateDialog.vue'));

const { isDark, toggleTheme, restoreTheme } = useTheme();
const isMaximized = ref(false);
const appWindow = getCurrentWindow();

// Help menu state
const helpMenuRef = ref<{ toggle: (event: Event) => void } | null>(null);
const showShortcutsDialog = ref(false);
const showAboutDialog = ref(false);
const mcpStore = useMcpStore();
// MCP 状态点：运行中为绿色，启动失败为红色，未开启时不显示
const mcpBadgeSeverity = computed(() => {
  if (mcpStore.status === 'running') return 'success';
  if (mcpStore.status === 'error') return 'danger';
  return null;
});
const mcpButton = computed(() => ({
  icon: 'pi pi-sparkles',
  text: true,
  rounded: true,
  size: 'small',
  severity: 'secondary',
  title: `AI Integration (MCP): ${mcpStore.statusText}`,
  'aria-label': `AI Integration (MCP): ${mcpStore.statusText}`,
  onClick: () => mcpStore.openDialog(),
}));

// Update dialog state
const showUpdateDialog = ref(false);
// Update 实例带 #rid 私有字段，不能被 reactive Proxy 包装，否则调用 downloadAndInstall 会报
// "Cannot read private member #rid from an object whose class did not declare it"
const updateInfo = shallowRef<Update | null>(null);
const isDownloading = ref(false);
const downloadProgress = ref(0);

const openDocumentation = () => {
  openUrl(docsUrlFor(navigator.language)).catch(error => console.error('Failed to open documentation:', error));
};

const helpMenuItems = ref([
  {
    label: 'Documentation',
    icon: 'pi pi-book',
    command: openDocumentation
  },
  {
    label: 'Check For Update',
    icon: 'pi pi-refresh',
    command: () => checkForUpdate()
  },
  {
    label: 'Keyboard Shortcuts',
    icon: 'pi pi-sliders-h',
    command: () => showShortcutsDialog.value = true
  },
  { separator: true },
  {
    label: 'About ApiKit',
    icon: 'pi pi-info-circle',
    command: () => showAboutDialog.value = true
  }
]);

const minimizeWindow = async () => {
  await appWindow.minimize();
};

const toggleMaximize = async () => {
  if (isMaximized.value) {
    await appWindow.unmaximize();
  } else {
    await appWindow.maximize();
  }
  isMaximized.value = !isMaximized.value;
};

const closeWindow = async () => {
  await appWindow.close();
};

// 启动后延迟检查一次，之后定时检查；发现新版本时在标题旁显示 New
const AUTO_CHECK_DELAY = 30 * 1000;
const AUTO_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
let autoCheckTimer: ReturnType<typeof setTimeout> | undefined;
let autoCheckInterval: ReturnType<typeof setInterval> | undefined;

// 保存检查到的新版本，New 标记与 Check For Update 共用同一个弹窗
const setAvailableUpdate = async (update: Update | null) => {
  const previous = updateInfo.value;
  if (previous && update && previous.version === update.version) {
    await update.close().catch(() => {});
    return;
  }
  updateInfo.value = update;
  if (previous) {
    await previous.close().catch(() => {});
  }
};

// silent: 自动检查时不提示"已是最新"和检查失败
const checkForUpdate = async ({ silent = false } = {}) => {
  // 弹窗打开或下载中时不替换当前的 Update 实例
  if (isDownloading.value || (silent && showUpdateDialog.value)) return;

  try {
    
    const update = await check();
    
    if (update) {
      await setAvailableUpdate(update);
      if (!silent) {
        showUpdateDialog.value = true;
      }
    } else {
      await setAvailableUpdate(null);
      
      if (!silent && window.$toast) {
        window.$toast.add({
          severity: 'info',
          summary: 'Up to Date',
          detail: 'You are using the latest version',
          life: 3000
        });
      }
    }
  } catch (error) {
    console.error('Failed to check for updates:', error);
    if (silent) return;
    
    // 更友好的错误提示；附上原始错误，便于排查网络等问题
    const detail = String(error instanceof Error ? error.message : error ?? '').trim();
    let errorMessage = detail
      ? `Unable to check for updates: ${detail}`
      : 'Unable to check for updates. Please try again later.';
    
    if (detail.includes('Could not fetch a valid release JSON')) {
      errorMessage = 'No updates available yet. This feature will be enabled after the first release.';
    }
    
    if (window.$toast) {
      window.$toast.add({
        severity: 'warn',
        summary: 'Update Check',
        detail: errorMessage,
        life: 8000
      });
    }
  }
};

const openUpdateDialog = () => {
  if (updateInfo.value) {
    showUpdateDialog.value = true;
  }
};

const IS_WINDOWS = navigator.userAgent.includes('Windows');

const handleInstallUpdate = async () => {
  const update = updateInfo.value;
  if (!update) return;
  
  try {
    isDownloading.value = true;
    downloadProgress.value = 0;
    
    
    // Download the update with progress tracking
    let contentLength = 0;
    let downloaded = 0;
    const onDownloadEvent = (event: DownloadEvent) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength || 0;
          break;
        case 'Progress':
          downloaded += event.data.chunkLength || 0;
          if (contentLength > 0) {
            downloadProgress.value = Math.min(100, Math.round((downloaded / contentLength) * 100));
          }
          break;
        case 'Finished':
          downloadProgress.value = 100;
          break;
      }
    };

    // 下载与安装分两步：下载完成、进度显示到 100% 之后再开始安装
    if (IS_WINDOWS) {
      // Windows 统一下载 NSIS 安装包并运行安装向导，安装目录默认为当前程序所在目录，可在向导中修改
      const channel = new Channel<DownloadEvent>();
      channel.onmessage = onDownloadEvent;
      await invoke('download_windows_installer', { onEvent: channel });
      downloadProgress.value = 100;

      if (window.$toast) {
        window.$toast.add({
          severity: 'success',
          summary: 'Download Complete',
          detail: 'ApiKit will close and the installer will start',
          life: 2000
        });
      }
      await new Promise(resolve => setTimeout(resolve, 1200));
      // 启动安装程序后应用退出
      await invoke('launch_windows_installer');
      return;
    }

    await update.download(onDownloadEvent);
    downloadProgress.value = 100;
    await update.install();
    
    
    // Show success message
    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Update Installed',
        detail: 'The application will now restart to apply the update',
        life: 2000
      });
    }
    
    // Wait a moment for the toast to show
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 新进程启动时要用同样的端口，重启前先停止 MCP 和 Mock 服务
    await invoke('stop_local_servers');
    // Relaunch the application
    await relaunch();
  } catch (error) {
    console.error('Failed to install update:', error);
    
    isDownloading.value = false;
    
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Update Failed',
        // Tauri 插件抛出的错误通常是字符串而非 Error 对象，error.message 为 undefined
        detail: (typeof error === 'string' ? error : (error as Error | null)?.message) || 'Failed to install update. Please try again later.',
        life: 6000
      });
    }
  }
};

const handleCancelUpdate = () => {
  // 只关闭弹窗，保留新版本信息，标题旁的 New 继续显示
  if (!isDownloading.value) {
    showUpdateDialog.value = false;
  }
};

const showHelpMenu = (event: MouseEvent) => {
  helpMenuRef.value?.toggle(event);
};

// Manually handle titlebar click events
const handleTitlebarMouseDown = async (e: MouseEvent) => {
  // 按钮和按钮上的状态点（OverlayBadge 的徽标在按钮外）不拖动窗口
  const target = e.target as HTMLElement;
  if (target.closest('button, .p-overlaybadge')) {
    return;
  }
  
  if (e.buttons === 1) {
    // Primary button (left click)
    if (e.detail === 2) {
      // Double-click to maximize/restore
      await toggleMaximize();
    } else {
      // Single click to start dragging
      await appWindow.startDragging();
    }
  }
};

onMounted(async () => {
  restoreTheme();
  
  try {
    isMaximized.value = await appWindow.isMaximized();
  } catch (e) {
    console.error('Failed to get window state:', e);
  }
  
  // Add global keyboard shortcut listeners
  window.addEventListener('keydown', handleGlobalShortcuts);

  autoCheckTimer = setTimeout(() => checkForUpdate({ silent: true }), AUTO_CHECK_DELAY);
  autoCheckInterval = setInterval(() => checkForUpdate({ silent: true }), AUTO_CHECK_INTERVAL);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalShortcuts);
  clearTimeout(autoCheckTimer);
  clearInterval(autoCheckInterval);
});

// Global keyboard shortcut handler
const handleGlobalShortcuts = (event: KeyboardEvent) => {
  // F1 to show shortcuts（Ctrl+/ 留给编辑器的切换注释）
  if (matchesShortcut(event, { key: 'F1' })) {
    event.preventDefault();
    showShortcutsDialog.value = true;
  }
};
</script>

<template>
  <nav 
    class="navbar bg-surface-0 dark:bg-surface-900 text-surface-900 dark:text-surface-50 px-4 py-1.5 border-b border-surface-200 dark:border-surface-700 select-none"
    @mousedown="handleTitlebarMouseDown"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-4">
        <img src="../assets/logo.svg" class="w-6 h-6 rounded-md" alt="ApiKit" draggable="false" />
        <div class="flex items-center gap-2">
          <h1 class="text-sm font-semibold">ApiKit</h1>
          <Button
            v-if="updateInfo"
            :label="`New v${updateInfo.version}`"
            size="small"
            rounded
            severity="help"
            :title="`ApiKit ${updateInfo.version} is available`"
            @click="openUpdateDialog"
          />
        </div>
      </div>
      <div class="flex items-center gap-1">
        <OverlayBadge v-if="mcpBadgeSeverity" :severity="mcpBadgeSeverity">
          <Button v-bind="mcpButton" />
        </OverlayBadge>
        <Button v-else v-bind="mcpButton" />
        <Button
          icon="pi pi-question-circle"
          text
          rounded
          size="small"
          severity="secondary"
          title="Help"
          aria-label="Help"
          @click="showHelpMenu"
        />
        <Button
          :icon="isDark ? 'pi pi-sun' : 'pi pi-moon'"
          text
          rounded
          size="small"
          severity="secondary"
          :title="isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
          :aria-label="isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
          @click="toggleTheme"
        />
        
        <!-- Separator -->
        <div class="h-5 w-px bg-surface-300 dark:bg-surface-600 mx-2"></div>
        
        <Button
          icon="pi pi-minus"
          text
          size="small"
          severity="secondary"
          title="Minimize"
          aria-label="Minimize"
          @click="minimizeWindow"
        />
        <Button
          :icon="isMaximized ? 'pi pi-clone' : 'pi pi-stop'"
          text
          size="small"
          severity="secondary"
          title="Maximize/Restore"
          aria-label="Maximize/Restore"
          @click="toggleMaximize"
        />
        <Button
          icon="pi pi-times"
          text
          size="small"
          severity="secondary"
          class="window-close"
          title="Close"
          aria-label="Close"
          @click="closeWindow"
        />
      </div>
    </div>
    
    <!-- Help Menu -->
    <ContextMenu ref="helpMenuRef" :model="helpMenuItems" :style="{ minWidth: '220px' }">
      <template #item="{ item, props }">
        <a v-ripple class="flex items-center gap-2" v-bind="props.action">
          <i v-if="item.icon" :class="item.icon"></i>
          <span>{{ item.label }}</span>
        </a>
      </template>
    </ContextMenu>
    
    <!-- Dialogs -->
    <KeyboardShortcutsDialog
      v-if="showShortcutsDialog"
      v-model:visible="showShortcutsDialog"
    />
    
    <AboutDialog
      v-if="showAboutDialog"
      v-model:visible="showAboutDialog"
    />

    <McpDialog
      v-if="mcpStore.dialogVisible"
      v-model:visible="mcpStore.dialogVisible"
    />
    
    <UpdateDialog
      v-if="showUpdateDialog"
      v-model:visible="showUpdateDialog"
      :updateInfo="updateInfo"
      :downloading="isDownloading"
      :downloadProgress="downloadProgress"
      @install="handleInstallUpdate"
      @cancel="handleCancelUpdate"
    />
  </nav>
</template>

<style scoped>
/* Disable text selection for smoother dragging */
.navbar {
  cursor: default;
  user-select: none;
}

/* 关闭按钮悬停时显示红色，与系统窗口的关闭按钮一致；选择器要比 PrimeVue 文字按钮的悬停样式更具体 */
.navbar .window-close.p-button:not(:disabled):hover {
  background: var(--p-red-600);
  border-color: var(--p-red-600);
  color: #fff;
}

/* Ensure ContextMenu items have proper spacing for icons */
:deep(.p-contextmenu .p-menuitem-link) {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

:deep(.p-contextmenu .p-menuitem-icon) {
  flex-shrink: 0;
  width: 1rem;
}

:deep(.p-contextmenu .p-menuitem-text) {
  flex: 1;
  white-space: nowrap;
}
</style>
