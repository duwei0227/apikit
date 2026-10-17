<script setup lang="ts">
import { ref } from 'vue';
import ExportDialog from '@/components/ExportDialog.vue';
import ImportDialog from '@/components/ImportDialog.vue';

const emit = defineEmits<{
  'new-request': [];
  'import-curl': [command: string];
}>();

const importDialog = ref<InstanceType<typeof ImportDialog> | null>(null);
const exportDialog = ref<InstanceType<typeof ExportDialog> | null>(null);

const handleNewRequest = () => {
  emit('new-request');
};
</script>

<template>
  <div class="toolbar bg-surface-0 dark:bg-surface-900 text-surface-900 dark:text-surface-50 px-4 py-2 border-b border-surface-200 dark:border-surface-700 flex items-center gap-2">
    <button 
      @click="handleNewRequest"
      class="px-3 py-1.5 text-sm bg-primary hover:bg-primary-600 text-primary-contrast rounded transition"
    >
      + New Request
    </button>
    
    <button 
      @click="importDialog?.open()"
      class="px-3 py-1.5 text-sm bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 rounded transition"
    >
      Import
    </button>

    <button 
      @click="exportDialog?.open()"
      class="px-3 py-1.5 text-sm bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 rounded transition"
    >
      Export
    </button>
  </div>

  <ImportDialog ref="importDialog" @import-curl="command => emit('import-curl', command)" />
  <ExportDialog ref="exportDialog" />
</template>
