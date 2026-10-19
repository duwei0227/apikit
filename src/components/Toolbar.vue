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
    <Button label="New Request" icon="pi pi-plus" size="small" @click="handleNewRequest" />
    <Button label="Import" size="small" severity="secondary" @click="importDialog?.open()" />
    <Button label="Export" size="small" severity="secondary" @click="exportDialog?.open()" />
  </div>

  <ImportDialog ref="importDialog" @import-curl="command => emit('import-curl', command)" />
  <ExportDialog ref="exportDialog" />
</template>
