<script setup lang="ts">
import { ref, computed } from 'vue';
import { parseCurl } from '@/utils/curl-parser';
import { generateCurlCommand } from '@/utils/curl-generator';
import { createVariableResolver } from '@/services/variables/resolver';
import type { ParsedCurl } from '@/utils/curl-parser';
import type { Request, RequestSettings } from '@/types/models';

const props = withDefaults(defineProps<{
  /** 编辑中的请求和当前设置，用来生成 cURL 预览 */
  request: Request;
  settings: Required<RequestSettings>;
  /** 请求编辑器当前的页签；切换页签后重新生成预览，动态变量随之刷新 */
  activeTab?: number;
}>(), {
  activeTab: 0,
});

// 解析成功后发出，由请求编辑器回填
const emit = defineEmits<{ import: [parsed: ParsedCurl] }>();

// cURL 生成和导入相关
const curlInput = ref('');
const activeCodeTab = ref(0); // 0: Export, 1: Import

const generateCurl = (variableResolver = (value: string) => value) => generateCurlCommand(
  props.request,
  props.settings,
  variableResolver,
);

// 预览不推进 $sequence 序列，同一次预览中的动态值保持一致
const createCurlPreviewResolver = () => createVariableResolver({ consumeSequences: false });

// computed 本身就是一次稳定快照；请求、设置、环境或页签变化后才会重新生成。
const curlPreview = computed(() => {
  void props.activeTab;
  void activeCodeTab.value;
  return generateCurl(createCurlPreviewResolver());
});

const copyCurl = async () => {
  try {
    await navigator.clipboard.writeText(curlPreview.value);
    // 显示成功提示
    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Copied',
        detail: 'cURL command copied to clipboard',
        life: 2000
      });
    }
  } catch (error) {
    console.error('Failed to copy:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to copy to clipboard',
        life: 3000
      });
    }
  }
};

const importCurl = () => {
  if (!curlInput.value.trim()) return;

  try {
    const parsed = parseCurl(curlInput.value);

    // 回填解析结果到请求
    emit('import', parsed);

    if (parsed.warnings.length > 0 && window.$toast) {
      window.$toast.add({
        severity: 'warn',
        summary: 'Imported with warnings',
        detail: parsed.warnings.map(warning => warning.message).join(' '),
        life: 5000
      });
    }

    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Imported',
        detail: 'cURL command imported successfully',
        life: 2000
      });
    }
  } catch (error) {
    console.error('Failed to parse cURL:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to parse cURL command. Please check the format.',
        life: 3000
      });
    }
  }
};
</script>

<template>
  <div class="p-4 overflow-y-auto">
    <TabView v-model:activeIndex="activeCodeTab">
      <TabPanel header="Export">
        <div class="space-y-3 pt-3">
          <div class="flex justify-between items-center">
            <h4 class="text-sm font-medium text-surface-700 dark:text-surface-300">cURL Command</h4>
            <Button
              label="Copy"
              icon="pi pi-copy"
              size="small"
              @click="copyCurl"
            />
          </div>
          <pre class="p-4 bg-surface-100 dark:bg-surface-900 rounded text-xs font-mono whitespace-pre-wrap overflow-x-auto border border-surface-200 dark:border-surface-700 max-h-96">{{ curlPreview }}</pre>
        </div>
      </TabPanel>

      <TabPanel header="Import">
        <div class="space-y-3 pt-3">
          <div class="flex justify-between items-center">
            <h4 class="text-sm font-medium text-surface-700 dark:text-surface-300">Paste cURL Command</h4>
            <Button
              label="Import"
              icon="pi pi-download"
              size="small"
              @click="importCurl"
              :disabled="!curlInput.trim()"
            />
          </div>
          <Textarea
            v-model="curlInput"
            rows="10"
            class="w-full font-mono text-xs"
            placeholder="curl -X GET 'https://api.example.com/users' -H 'Authorization: Bearer token'"
          />
        </div>
      </TabPanel>
    </TabView>
  </div>
</template>
