<script setup>
import { ref, computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  updateInfo: {
    type: Object,
    default: () => null
  },
  downloading: {
    type: Boolean,
    default: false
  },
  downloadProgress: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits(['update:visible', 'install', 'cancel']);

const localVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
});

// 将 Markdown 转换为 HTML
const formattedNotes = computed(() => {
  if (!props.updateInfo?.body) return '';
  
  try {
    // 配置 marked 选项
    marked.setOptions({
      breaks: true,
      gfm: true
    });
    
    // 转换 Markdown 为 HTML
    const html = marked.parse(props.updateInfo.body);
    
    // 使用 DOMPurify 清理 HTML，防止 XSS 攻击
    return DOMPurify.sanitize(html);
  } catch (error) {
    console.error('Failed to parse markdown:', error);
    return props.updateInfo.body;
  }
});

const handleInstall = () => {
  emit('install');
};

const handleCancel = () => {
  emit('cancel');
  localVisible.value = false;
};

const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (e) {
    return dateString;
  }
};

const formatBytes = (bytes) => {
  if (!bytes) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};
</script>

<template>
  <Dialog
    v-model:visible="localVisible"
    modal
    :closable="!downloading"
    :closeOnEscape="!downloading"
    :style="{ width: '600px' }"
    header="Update Available"
  >
    <div v-if="updateInfo" class="space-y-4">
      <!-- Version Info -->
      <div class="flex items-center justify-between p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
        <div>
          <div class="text-sm text-surface-600 dark:text-surface-400">New Version</div>
          <div class="text-2xl font-bold text-primary">{{ updateInfo.version }}</div>
        </div>
        <div class="text-right">
          <div class="text-sm text-surface-600 dark:text-surface-400">Release Date</div>
          <div class="text-sm font-medium">{{ formatDate(updateInfo.date) }}</div>
        </div>
      </div>

      <!-- Release Notes -->
      <div v-if="updateInfo.body" class="space-y-2">
        <h3 class="text-lg font-semibold">What's New</h3>
        <div 
          class="p-4 bg-surface-50 dark:bg-surface-800 rounded-lg max-h-64 overflow-y-auto prose prose-sm dark:prose-invert max-w-none"
          v-html="formattedNotes"
        ></div>
      </div>

      <!-- Download Progress -->
      <div v-if="downloading" class="space-y-2">
        <div class="flex items-center justify-between text-sm">
          <span class="text-surface-600 dark:text-surface-400">Downloading update...</span>
          <span class="font-medium">{{ downloadProgress }}%</span>
        </div>
        <ProgressBar :value="downloadProgress" :showValue="false" />
        <div class="text-xs text-surface-500 dark:text-surface-500 text-center">
          Please wait while the update is being downloaded
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button
          label="Cancel"
          severity="secondary"
          @click="handleCancel"
          :disabled="downloading"
        />
        <Button
          label="Install Update"
          icon="pi pi-download"
          @click="handleInstall"
          :loading="downloading"
          :disabled="downloading"
        />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
/* Ensure proper text wrapping in release notes */
:deep(.p-dialog-content) {
  overflow-y: auto;
}

/* Markdown 样式 */
:deep(.prose) {
  color: inherit;
}

:deep(.prose h1),
:deep(.prose h2),
:deep(.prose h3),
:deep(.prose h4) {
  color: inherit;
  font-weight: 600;
  margin-top: 1em;
  margin-bottom: 0.5em;
}

:deep(.prose h2) {
  font-size: 16px;
  border-bottom: 1px solid var(--surface-200);
  padding-bottom: 0.3em;
}

:deep(.dark .prose h2) {
  border-bottom-color: var(--surface-700);
}

:deep(.prose h3) {
  font-size: 14px;
}

:deep(.prose ul),
:deep(.prose ol) {
  margin-top: 0.5em;
  margin-bottom: 0.5em;
  padding-left: 1.5em;
}

:deep(.prose li) {
  margin-top: 0.25em;
  margin-bottom: 0.25em;
}

:deep(.prose p) {
  margin-top: 0.5em;
  margin-bottom: 0.5em;
}

:deep(.prose code) {
  background-color: var(--surface-100);
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-size: 13px;
}

:deep(.dark .prose code) {
  background-color: var(--surface-900);
}

:deep(.prose pre) {
  background-color: var(--surface-100);
  padding: 1em;
  border-radius: 6px;
  overflow-x: auto;
}

:deep(.dark .prose pre) {
  background-color: var(--surface-900);
}

:deep(.prose blockquote) {
  border-left: 4px solid var(--primary-color);
  padding-left: 1em;
  margin-left: 0;
  font-style: italic;
  color: var(--surface-600);
}

:deep(.dark .prose blockquote) {
  color: var(--surface-400);
}

:deep(.prose a) {
  color: var(--primary-color);
  text-decoration: none;
}

:deep(.prose a:hover) {
  text-decoration: underline;
}

:deep(.prose strong) {
  font-weight: 600;
}

:deep(.prose hr) {
  border: none;
  border-top: 1px solid var(--surface-200);
  margin: 1.5em 0;
}

:deep(.dark .prose hr) {
  border-top-color: var(--surface-700);
}
</style>
