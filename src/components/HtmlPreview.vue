<script setup lang="ts">
import { computed, ref, watch } from 'vue';

// 在隔离的框里预览一段 HTML / SVG。默认不运行脚本；allowScripts 为 true 时提供手动开启的按钮。
const props = withDefaults(defineProps<{
  html?: string;
  /** 内容还在变化（流式接收中）：降低刷新频率，避免预览不停重载 */
  live?: boolean;
  allowScripts?: boolean;
  height?: number;
}>(), {
  html: '',
  live: false,
  allowScripts: false,
  height: 320,
});

const LIVE_REFRESH_MS = 800;

const shown = ref(props.html);
const scriptsOn = ref(false);
const expanded = ref(false);
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

watch(() => [props.html, props.live], () => {
  if (!props.live) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    shown.value = props.html;
    return;
  }
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    shown.value = props.html;
  }, LIVE_REFRESH_MS);
});

// 不给 allow-same-origin：框里的页面拿不到 ApiKit 的页面、存储和本地接口
const sandbox = computed(() => (scriptsOn.value ? 'allow-scripts' : ''));

// 页面里的链接在新窗口打开会被 sandbox 拦住，这里让它们不在预览框里跳走
// 开启脚本时先去掉宿主可能注入的本地接口入口，作为 sandbox 之外的第二层保护
const GUARD = '<script>for (const key of ["__TAURI_INTERNALS__", "__TAURI__", "ipc"]) { try { delete window[key]; Object.defineProperty(window, key, { value: undefined }); } catch (error) {} }</' + 'script>';
const document = computed(() => (
  `<!doctype html><meta charset="utf-8"><base target="_blank">${scriptsOn.value ? GUARD : ''}${shown.value}`
));
</script>

<template>
  <div class="rounded border border-surface-200 dark:border-surface-700 overflow-hidden">
    <div class="flex items-center justify-between gap-2 px-3 py-1 text-xs bg-surface-50 dark:bg-surface-900 text-surface-600 dark:text-surface-400">
      <span class="flex items-center gap-1.5">
        <i class="pi pi-shield text-xs"></i>
        Preview · {{ scriptsOn ? 'scripts on' : 'scripts off' }}
      </span>
      <span class="flex items-center gap-1">
        <Button
          v-if="allowScripts"
          :label="scriptsOn ? 'Stop scripts' : 'Run scripts'"
          size="small"
          text
          :severity="scriptsOn ? 'danger' : 'secondary'"
          :title="scriptsOn ? 'Reload the preview without scripts' : 'Run the scripts in this page inside the isolated preview'"
          @click="scriptsOn = !scriptsOn"
        />
        <Button icon="pi pi-window-maximize" size="small" text severity="secondary" title="Open larger preview" @click="expanded = true" />
      </span>
    </div>
    <iframe
      :key="sandbox"
      class="html-preview-frame"
      :style="{ height: `${height}px` }"
      :sandbox="sandbox"
      :srcdoc="document"
      referrerpolicy="no-referrer"
      title="HTML preview"
    ></iframe>

    <Dialog v-model:visible="expanded" header="Preview" modal maximizable :style="{ width: '80vw' }">
      <iframe
        :key="`expanded-${sandbox}`"
        class="html-preview-frame"
        style="height: 70vh"
        :sandbox="sandbox"
        :srcdoc="document"
        referrerpolicy="no-referrer"
        title="HTML preview"
      ></iframe>
    </Dialog>
  </div>
</template>

<style scoped>
.html-preview-frame {
  display: block;
  width: 100%;
  border: 0;
  background: #ffffff;
}
</style>
