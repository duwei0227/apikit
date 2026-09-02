<script setup>
import { ref, onMounted } from 'vue';
import { apiService } from '@/services/api/apiService';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:visible']);

const version = ref('Loading...');
const appName = ref('ApiKit');
const buildDate = new Date().toLocaleDateString('en-US');
const githubUrl = 'https://github.com/duwei0227/apikit';

onMounted(async () => {
  try {
    const appInfo = await apiService.getAppInfo();
    version.value = appInfo.version || '0.1.0';
    appName.value = appInfo.name || 'ApiKit';
  } catch (error) {
    console.error('Failed to get app info:', error);
    version.value = '0.1.0';
  }
});

const closeDialog = () => {
  emit('update:visible', false);
};

const openGithub = () => {
  // Copy GitHub link to clipboard
  if (navigator.clipboard) {
    navigator.clipboard.writeText(githubUrl);
    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: 'GitHub link copied to clipboard',
        life: 2000
      });
    }
  }
};
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="closeDialog"
    header="About ApiKit"
    :modal="true"
    :style="{ width: '500px' }"
    :dismissableMask="true"
  >
    <div class="about-content text-center py-4">
      <div class="mb-6">
        <img src="../assets/logo.svg" class="w-16 h-16 rounded-xl mx-auto mb-4" alt="ApiKit" />
        <h2 class="text-2xl font-bold text-surface-900 dark:text-surface-50 mb-2">
          {{ appName }}
        </h2>
        <p class="text-sm text-surface-600 dark:text-surface-400">
          Modern API Testing Tool
        </p>
      </div>

      <div class="space-y-3 text-left">
        <div class="flex justify-between py-2 px-4 bg-surface-50 dark:bg-surface-800 rounded">
          <span class="text-sm font-medium text-surface-700 dark:text-surface-300">Version</span>
          <span class="text-sm text-surface-900 dark:text-surface-50">{{ version }}</span>
        </div>

        <div class="flex justify-between py-2 px-4 bg-surface-50 dark:bg-surface-800 rounded">
          <span class="text-sm font-medium text-surface-700 dark:text-surface-300">Build Date</span>
          <span class="text-sm text-surface-900 dark:text-surface-50">{{ buildDate }}</span>
        </div>

        <div class="flex justify-between py-2 px-4 bg-surface-50 dark:bg-surface-800 rounded">
          <span class="text-sm font-medium text-surface-700 dark:text-surface-300">Platform</span>
          <span class="text-sm text-surface-900 dark:text-surface-50">Tauri + Vue 3</span>
        </div>
      </div>

      <div class="mt-6 pt-6 border-t border-surface-200 dark:border-surface-700">
        <p class="text-xs text-surface-500 dark:text-surface-400 mb-3">
          Built with Tauri, Vue 3 and PrimeVue ❤️
        </p>
        <div class="flex flex-col gap-2 items-center">
          <div class="text-xs text-surface-600 dark:text-surface-400 font-mono">
            {{ githubUrl }}
          </div>
          <Button
            label="Copy GitHub Link"
            icon="pi pi-copy"
            text
            size="small"
            @click="openGithub"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end">
        <Button label="Close" @click="closeDialog" />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.about-content {
  padding: 1rem;
}
</style>
