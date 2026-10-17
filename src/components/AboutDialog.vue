<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import { apiService } from '@/services/api/apiService';
import { displayUrl, docsUrlFor, GITHUB_URL } from '@/utils/appLinks';

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
const links = [
  { label: 'Documentation', icon: 'pi pi-book', url: docsUrlFor(navigator.language) },
  { label: 'GitHub', icon: 'pi pi-github', url: GITHUB_URL },
];

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

const openLink = (url: string) => {
  openUrl(url).catch(error => console.error('Failed to open link:', error));
};

const copyLink = async (label: string, url: string) => {
  try {
    await navigator.clipboard.writeText(url);
    window.$toast?.add({ severity: 'success', summary: 'Copied', detail: `${label} link copied to clipboard`, life: 2000 });
  } catch (error) {
    console.error('Failed to copy link:', error);
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
        <div class="flex flex-col gap-2 text-left">
          <div
            v-for="link in links"
            :key="link.label"
            class="flex items-center gap-3 py-2 px-4 bg-surface-50 dark:bg-surface-800 rounded"
            data-testid="about-link"
          >
            <i :class="[link.icon, 'text-surface-500 dark:text-surface-400']"></i>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-surface-700 dark:text-surface-300">{{ link.label }}</div>
              <a
                :href="link.url"
                class="block text-xs font-mono text-primary hover:underline truncate"
                :title="link.url"
                @click.prevent="openLink(link.url)"
              >{{ displayUrl(link.url) }}</a>
            </div>
            <Button
              icon="pi pi-copy"
              text
              rounded
              size="small"
              severity="secondary"
              :aria-label="`Copy ${link.label} link`"
              :title="`Copy ${link.label} link`"
              @click="copyLink(link.label, link.url)"
            />
          </div>
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
