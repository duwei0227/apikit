<script setup>
import { defineAsyncComponent, ref, onMounted } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
const KeyboardShortcutsDialog = defineAsyncComponent(() => import('./KeyboardShortcutsDialog.vue'));
const AboutDialog = defineAsyncComponent(() => import('./AboutDialog.vue'));
const UpdateDialog = defineAsyncComponent(() => import('./UpdateDialog.vue'));

const isDark = ref(false);
const isMaximized = ref(false);
const appWindow = getCurrentWindow();

// Help menu state
const helpMenuRef = ref(null);
const showShortcutsDialog = ref(false);
const showAboutDialog = ref(false);

// Update dialog state
const showUpdateDialog = ref(false);
const updateInfo = ref(null);
const isDownloading = ref(false);
const downloadProgress = ref(0);

const helpMenuItems = ref([
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

const toggleTheme = () => {
  isDark.value = !isDark.value;
  const element = document.documentElement;
  
  if (isDark.value) {
    element.classList.add('p-dark');
  } else {
    element.classList.remove('p-dark');
  }
  
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
};

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

// Help menu functions
const checkForUpdate = async () => {
  try {
    console.log('Checking for updates...');
    
    const update = await check();
    
    if (update) {
      console.log(`Update available: ${update.version} from ${update.date}`);
      
      // Show update dialog with changelog
      updateInfo.value = update;
      showUpdateDialog.value = true;
    } else {
      console.log('No update available');
      
      // Show "up to date" message
      if (window.$toast) {
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
    
    // 更友好的错误提示
    let errorMessage = 'Unable to check for updates. Please try again later.';
    
    if (error.message && error.message.includes('Could not fetch a valid release JSON')) {
      errorMessage = 'No updates available yet. This feature will be enabled after the first release.';
    }
    
    if (window.$toast) {
      window.$toast.add({
        severity: 'warn',
        summary: 'Update Check',
        detail: errorMessage,
        life: 4000
      });
    }
  }
};

const handleInstallUpdate = async () => {
  if (!updateInfo.value) return;
  
  try {
    isDownloading.value = true;
    downloadProgress.value = 0;
    
    console.log('Starting update download and installation...');
    
    // Download and install the update with progress tracking
    let contentLength = 0;
    let downloaded = 0;
    
    await updateInfo.value.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength || 0;
          console.log(`Started downloading ${contentLength} bytes`);
          break;
        case 'Progress':
          downloaded += event.data.chunkLength || 0;
          if (contentLength > 0) {
            downloadProgress.value = Math.round((downloaded / contentLength) * 100);
          }
          console.log(`Download progress: ${downloadProgress.value}%`);
          break;
        case 'Finished':
          console.log('Download finished');
          downloadProgress.value = 100;
          break;
      }
    });
    
    console.log('Update installed successfully');
    
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
    
    // Relaunch the application
    await relaunch();
  } catch (error) {
    console.error('Failed to install update:', error);
    
    isDownloading.value = false;
    
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Update Failed',
        detail: error.message || 'Failed to install update. Please try again later.',
        life: 3000
      });
    }
  }
};

const handleCancelUpdate = () => {
  if (!isDownloading.value) {
    showUpdateDialog.value = false;
    updateInfo.value = null;
  }
};

const showHelpMenu = (event) => {
  helpMenuRef.value.toggle(event);
};

// Manually handle titlebar click events
const handleTitlebarMouseDown = async (e) => {
  // Check if clicking on a button
  if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
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
  const savedTheme = localStorage.getItem('theme');
  isDark.value = savedTheme === 'dark';

  if (isDark.value) {
    document.documentElement.classList.add('p-dark');
  } else {
    document.documentElement.classList.remove('p-dark');
  }
  
  try {
    isMaximized.value = await appWindow.isMaximized();
  } catch (e) {
    console.error('Failed to get window state:', e);
  }
  
  // Add global keyboard shortcut listeners
  window.addEventListener('keydown', handleGlobalShortcuts);
});

// Global keyboard shortcut handler
const handleGlobalShortcuts = (event) => {
  // Ctrl+/ or Cmd+/ to show shortcuts
  if ((event.ctrlKey || event.metaKey) && event.key === '/') {
    event.preventDefault();
    showShortcutsDialog.value = true;
  }
};
</script>

<template>
  <nav 
    class="navbar bg-surface-0 dark:bg-surface-950 text-surface-900 dark:text-surface-50 px-4 py-2 border-b border-surface-200 dark:border-surface-700 select-none"
    @mousedown="handleTitlebarMouseDown"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-4">
        <img src="../assets/logo.svg" class="w-6 h-6 rounded-md" alt="ApiKit" draggable="false" />
        <h1 class="text-sm font-semibold">ApiKit</h1>
      </div>
      <div class="flex items-center gap-1">
        <button 
          @click="showHelpMenu"
          class="px-2 py-1 rounded hover:bg-surface-100 dark:hover:bg-surface-800 transition"
          title="Help"
        >
          <i class="pi pi-question-circle"></i>
        </button>
        <button 
          @click="toggleTheme"
          class="px-2 py-1 rounded hover:bg-surface-100 dark:hover:bg-surface-800 transition"
          :title="isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
        >
          <i :class="isDark ? 'pi pi-sun' : 'pi pi-moon'"></i>
        </button>
        
        <!-- Separator -->
        <div class="h-5 w-px bg-surface-300 dark:bg-surface-600 mx-2"></div>
        
        <button 
          @click="minimizeWindow"
          class="px-2 py-1 rounded hover:bg-surface-100 dark:hover:bg-surface-800 transition"
          title="Minimize"
        >
          <i class="pi pi-minus text-xs"></i>
        </button>
        <button 
          @click="toggleMaximize"
          class="px-2 py-1 rounded hover:bg-surface-100 dark:hover:bg-surface-800 transition"
          title="Maximize/Restore"
        >
          <i :class="isMaximized ? 'pi pi-clone' : 'pi pi-stop'" class="text-xs"></i>
        </button>
        <button 
          @click="closeWindow"
          class="px-2 py-1 rounded hover:bg-red-600 hover:text-white transition"
          title="Close"
        >
          <i class="pi pi-times"></i>
        </button>
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

/* Ensure buttons can receive click events */
button {
  cursor: pointer;
  user-select: none;
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
