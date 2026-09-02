<script setup>
import { computed, defineAsyncComponent, ref, watch, nextTick } from 'vue';
import AsyncPanelLoader from './AsyncPanelLoader.vue';
import VariableInput from './VariableInput.vue';
import { useKeyValueRows } from '@/composables/useKeyValueRows';
import { beautifyJsonText } from '@/utils/beautifyJson';
import { beautifyXmlText } from '@/utils/beautifyXml';

const JsonEditor = defineAsyncComponent({
  loader: () => import('./JsonEditor.vue'),
  loadingComponent: AsyncPanelLoader,
  delay: 0,
});

// The request body object (localRequest.body) is two-way bound; this component
// edits type / raw / formData / urlencoded in place.
const body = defineModel('body', { type: Object, required: true });

defineProps({
  availableVariables: { type: Object, default: () => ({}) },
});

const bodyTypes = [
  { label: 'none', value: 'none' },
  { label: 'form-data', value: 'form-data' },
  { label: 'x-www-form-urlencoded', value: 'x-www-form-urlencoded' },
  { label: 'json', value: 'json' },
  { label: 'xml', value: 'xml' },
  { label: 'text', value: 'text' },
  { label: 'binary', value: 'binary' }
];

const isRawBody = computed(() => ['json', 'xml', 'text'].includes(body.value.type));
const canBeautifyRawBody = computed(() => ['json', 'xml'].includes(body.value.type));
const rawBodyLabel = computed(() => body.value.type.toUpperCase());

// Raw Body 编辑器引用：用于失焦后（焦点落在工具栏按钮上）转发撤回/恢复
const bodyEditorRef = ref(null);

// 在 JSON/XML 体面板捕获 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y。CM5 仅在其隐藏 textarea
// 持有焦点时才处理这些快捷键，一旦点了 Beautify/搜索/复制等工具栏按钮，焦点离开
// 编辑器，撤回就失效。这里在捕获阶段先于 CM5 接管并转发到编辑器，使其在焦点位于
// Raw Body 面板任意位置时都生效，避免影响
// form-data / urlencoded 普通输入框的原生撤回。
const onBodyKeydown = (event) => {
  if (!isRawBody.value) return;
  if (!(event.ctrlKey || event.metaKey)) return;
  // 不劫持普通 <input>（如 Body 搜索框）的原生撤回；CM5 编辑器用的是 <textarea>，
  // 工具栏按钮是 <button>，两者都不是 <input>，所以仍会被下面正常处理。
  if (event.target instanceof HTMLInputElement) return;
  const key = event.key.toLowerCase();
  if (key === 'z' && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    bodyEditorRef.value?.undo();
  } else if ((key === 'z' && event.shiftKey) || key === 'y') {
    event.preventDefault();
    event.stopPropagation();
    bodyEditorRef.value?.redo();
  }
};

const getFilePath = (file) => file?.path || '';

const getFileNameFromPath = (filePath) => {
  if (!filePath) return '';
  const normalizedPath = String(filePath).replace(/\\/g, '/');
  return normalizedPath.split('/').pop() || normalizedPath;
};

const { add: addFormDataRow, remove: removeFormDataRow, onChange: onFormDataChange } = useKeyValueRows({
  getRows: () => body.value.formData,
  createRow: () => ({ key: '', value: '', type: 'text', enabled: true }),
});

const { add: addUrlencodedRow, remove: removeUrlencodedRow, onChange: onUrlencodedChange } = useKeyValueRows({
  getRows: () => body.value.urlencoded,
  createRow: () => ({ key: '', value: '', enabled: true }),
});

const handleFileSelect = (event, row) => {
  const file = event.target.files[0];
  if (file) {
    row.value = file.name;
    row.file = file;
    row.filePath = getFilePath(file);
  }
};

const chooseFormDataFile = async (row) => {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: false,
    directory: false,
  });

  if (!selected || Array.isArray(selected)) return;

  row.value = getFileNameFromPath(selected);
  row.filePath = selected;
  row.file = null;
  onFormDataChange();
};

const chooseBinaryFile = async () => {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({ multiple: false, directory: false });
  if (!selected || Array.isArray(selected)) return;
  body.value.filePath = selected;
};

const beautifyRawBody = () => {
  try {
    body.value.raw = body.value.type === 'xml'
      ? beautifyXmlText(body.value.raw || '')
      : beautifyJsonText(body.value.raw || '');
    // 点击 Beautify 后焦点在按钮上；把焦点带回编辑器，使随后的 Ctrl+Z 能直接撤回。
    nextTick(() => bodyEditorRef.value?.focus());
  } catch (error) {
    console.error(`Invalid ${rawBodyLabel.value}:`, error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'warn',
        summary: `Invalid ${rawBodyLabel.value}`,
        detail: `No valid ${rawBodyLabel.value} content found to beautify`,
        life: 3000
      });
    }
  }
};

const copyRequestBody = async () => {
  try {
    await navigator.clipboard.writeText(body.value.raw);
    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Copied',
        detail: 'Request body copied to clipboard',
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

// 搜索相关（Request Body JSON/XML）
const showBodySearchBox = ref(false);
const bodySearchQuery = ref('');
const bodySearchCaseSensitive = ref(false);
const bodySearchRegex = ref(false);
const bodySearchMatches = ref([]);
const bodyCurrentMatchIndex = ref(-1);

const toggleBodySearchBox = () => {
  showBodySearchBox.value = !showBodySearchBox.value;
  if (showBodySearchBox.value) {
    setTimeout(() => {
      const searchInput = document.querySelector('.body-search-input');
      if (searchInput) searchInput.focus();
    }, 100);
  } else {
    clearBodySearch();
  }
};

const openBodySearchBox = (selectedText = '') => {
  if (!showBodySearchBox.value) {
    showBodySearchBox.value = true;
  }
  if (selectedText) {
    bodySearchQuery.value = selectedText;
  }
  setTimeout(() => {
    const searchInput = document.querySelector('.body-search-input');
    if (searchInput) {
      searchInput.focus();
      if (selectedText) searchInput.select?.();
    }
  }, 100);
};

const performBodySearch = () => {
  const content = body.value.raw;
  if (!content || !bodySearchQuery.value) {
    bodySearchMatches.value = [];
    bodyCurrentMatchIndex.value = -1;
    return;
  }

  bodySearchMatches.value = [];
  try {
    if (bodySearchRegex.value) {
      const flags = bodySearchCaseSensitive.value ? 'g' : 'gi';
      const regex = new RegExp(bodySearchQuery.value, flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        bodySearchMatches.value.push({ index: match.index, length: match[0].length, text: match[0] });
      }
    } else {
      const needle = bodySearchCaseSensitive.value ? bodySearchQuery.value : bodySearchQuery.value.toLowerCase();
      const haystack = bodySearchCaseSensitive.value ? content : content.toLowerCase();
      let start = 0;
      while (true) {
        const idx = haystack.indexOf(needle, start);
        if (idx === -1) break;
        bodySearchMatches.value.push({ index: idx, length: bodySearchQuery.value.length, text: content.substr(idx, bodySearchQuery.value.length) });
        start = idx + 1;
      }
    }
    bodyCurrentMatchIndex.value = bodySearchMatches.value.length > 0 ? 0 : -1;
  } catch {
    bodySearchMatches.value = [];
    bodyCurrentMatchIndex.value = -1;
  }
};

const clearBodySearch = () => {
  bodySearchQuery.value = '';
  bodySearchMatches.value = [];
  bodyCurrentMatchIndex.value = -1;
};

const nextBodyMatch = () => {
  if (bodySearchMatches.value.length === 0) return;
  bodyCurrentMatchIndex.value = (bodyCurrentMatchIndex.value + 1) % bodySearchMatches.value.length;
};

const prevBodyMatch = () => {
  if (bodySearchMatches.value.length === 0) return;
  bodyCurrentMatchIndex.value = bodyCurrentMatchIndex.value <= 0
    ? bodySearchMatches.value.length - 1
    : bodyCurrentMatchIndex.value - 1;
};

watch([bodySearchQuery, bodySearchCaseSensitive, bodySearchRegex], () => {
  if (bodySearchQuery.value) {
    performBodySearch();
  } else {
    clearBodySearch();
  }
});
</script>

<template>
  <div class="p-4 flex-1 flex flex-col overflow-hidden" @keydown.capture="onBodyKeydown">
    <div class="mb-4 flex justify-between items-center">
      <div class="flex flex-wrap gap-4">
        <div
          v-for="type in bodyTypes"
          :key="type.value"
          class="flex items-center"
        >
          <RadioButton
            v-model="body.type"
            :inputId="type.value"
            :value="type.value"
          />
          <label :for="type.value" class="ml-2 text-sm cursor-pointer">
            {{ type.label }}
          </label>
        </div>
      </div>
      <div v-if="isRawBody" class="flex gap-2">
        <Button
          icon="pi pi-search"
          size="small"
          text
          :class="{ 'text-primary': showBodySearchBox }"
          :title="`Search in ${rawBodyLabel} body (Ctrl+F)`"
          @click="toggleBodySearchBox"
        />
        <Button
          icon="pi pi-copy"
          size="small"
          text
          :title="`Copy ${rawBodyLabel}`"
          @click="copyRequestBody"
        />
        <Button
          v-if="canBeautifyRawBody"
          label="Beautify"
          size="small"
          text
          class="beautify-btn"
          @click="beautifyRawBody"
        />
      </div>
    </div>

    <!-- None -->
    <div v-if="body.type === 'none'" class="text-sm text-surface-500 dark:text-surface-400">
      This request does not have a body.
    </div>

    <!-- Form Data -->
    <div v-else-if="body.type === 'form-data'">
      <!-- Table Header -->
      <div class="flex gap-2 mb-2 text-sm font-bold text-surface-700 dark:text-surface-300 px-2">
        <div style="width: 40px;"></div>
        <div class="flex-[1.3]">KEY</div>
        <div class="flex-1">VALUE</div>
        <div style="width: 40px;"></div>
      </div>

      <!-- Table Rows -->
      <div class="flex flex-col gap-[4px]">
        <div
          v-for="(row, index) in body.formData"
          :key="index"
          class="form-data-row flex gap-2 items-center"
        >
          <div class="flex justify-center" style="width: 40px;">
            <Checkbox v-model="row.enabled" :binary="true" />
          </div>
          <div class="flex-[1.3] min-w-0 relative">
            <VariableInput
              v-model="row.key"
              placeholder="Key"
              size="small"
              class="w-full pr-28"
              :availableVariables="availableVariables"
              @input="onFormDataChange"
            />
            <div class="absolute inset-y-0 right-0 flex items-center pr-1 z-10">
              <Dropdown
                v-model="row.type"
                :options="[{label: 'Text', value: 'text'}, {label: 'File', value: 'file'}]"
                optionLabel="label"
                optionValue="value"
                class="w-24 form-data-type-dropdown"
                size="small"
              />
            </div>
          </div>
          <div class="flex-1 min-w-0">
            <VariableInput
              v-if="row.type === 'text'"
              v-model="row.value"
              placeholder="Value"
              size="small"
              class="w-full"
              :availableVariables="availableVariables"
              @input="onFormDataChange"
            />
            <button
              v-else
              type="button"
              class="form-data-file-picker"
              :title="row.filePath || row.value || 'Select file'"
              @click="chooseFormDataFile(row)"
            >
              <span class="form-data-file-picker-action">
                <i class="pi pi-folder-open"></i>
                Select File
              </span>
              <span
                class="form-data-file-picker-name"
                :class="{ 'is-placeholder': !row.value }"
              >
                {{ row.value || 'No file selected' }}
              </span>
            </button>
          </div>
          <div class="flex justify-center" style="width: 40px;">
            <Button
              v-if="body.formData.length > 1 || row.key || row.value"
              icon="pi pi-trash"
              text
              rounded
              size="small"
              severity="danger"
              @click="removeFormDataRow(index)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- URL Encoded -->
    <div v-else-if="body.type === 'x-www-form-urlencoded'">
      <!-- Table Header -->
      <div class="flex gap-2 mb-2 text-sm font-bold text-surface-700 dark:text-surface-300 px-2">
        <div style="width: 40px;"></div>
        <div class="flex-1">KEY</div>
        <div class="flex-1">VALUE</div>
        <div style="width: 40px;"></div>
      </div>

      <!-- Table Rows -->
      <div class="space-y-1">
        <div
          v-for="(row, index) in body.urlencoded"
          :key="index"
          class="flex gap-2 items-center"
        >
          <div class="flex justify-center" style="width: 40px;">
            <Checkbox v-model="row.enabled" :binary="true" />
          </div>
          <div class="flex-1">
            <VariableInput
              v-model="row.key"
              placeholder="Key"
              size="small"
              :availableVariables="availableVariables"
              @input="onUrlencodedChange"
            />
          </div>
          <div class="flex-1">
            <VariableInput
              v-model="row.value"
              placeholder="Value"
              size="small"
              :availableVariables="availableVariables"
              @input="onUrlencodedChange"
            />
          </div>
          <div class="flex justify-center" style="width: 40px;">
            <Button
              v-if="body.urlencoded.length > 1 || row.key || row.value"
              icon="pi pi-trash"
              text
              rounded
              size="small"
              severity="danger"
              @click="removeUrlencodedRow(index)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Binary file -->
    <div v-else-if="body.type === 'binary'" class="flex flex-col gap-3">
      <button
        type="button"
        class="form-data-file-picker max-w-xl"
        :title="body.filePath || 'Select file'"
        @click="chooseBinaryFile"
      >
        <span class="form-data-file-picker-action">
          <i class="pi pi-folder-open"></i>
          Select File
        </span>
        <span
          class="form-data-file-picker-name"
          :class="{ 'is-placeholder': !body.filePath }"
        >
          {{ body.filePath ? getFileNameFromPath(body.filePath) : 'No file selected' }}
        </span>
      </button>
      <div class="text-xs text-surface-500 dark:text-surface-400">
        The selected file is sent as the request body without text conversion.
      </div>
    </div>

    <!-- JSON / XML / text Raw Body -->
    <div v-else-if="isRawBody" class="flex-1 flex flex-col min-h-0">
      <!-- Body Search Box -->
      <div v-if="showBodySearchBox" class="p-2 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900">
        <div class="flex items-center gap-2">
          <InputText
            v-model="bodySearchQuery"
            placeholder="Search..."
            size="small"
            class="flex-1 body-search-input"
            @keyup.enter="performBodySearch"
            @keyup.esc="toggleBodySearchBox"
          />
          <Button
            label="Aa"
            size="small"
            :severity="bodySearchCaseSensitive ? 'primary' : 'secondary'"
            :outlined="!bodySearchCaseSensitive"
            title="Match case"
            @click="bodySearchCaseSensitive = !bodySearchCaseSensitive"
          />
          <Button
            label=".*"
            size="small"
            :severity="bodySearchRegex ? 'primary' : 'secondary'"
            :outlined="!bodySearchRegex"
            title="Use regular expression"
            @click="bodySearchRegex = !bodySearchRegex"
          />
          <span v-if="bodySearchMatches.length > 0" class="text-xs text-surface-600 dark:text-surface-400 whitespace-nowrap">
            {{ bodyCurrentMatchIndex + 1 }} / {{ bodySearchMatches.length }}
          </span>
          <span v-else-if="bodySearchQuery" class="text-xs text-surface-600 dark:text-surface-400">
            No matches
          </span>
          <Button
            icon="pi pi-chevron-up"
            size="small"
            text
            :disabled="bodySearchMatches.length === 0"
            title="Previous match"
            @click="prevBodyMatch"
          />
          <Button
            icon="pi pi-chevron-down"
            size="small"
            text
            :disabled="bodySearchMatches.length === 0"
            title="Next match"
            @click="nextBodyMatch"
          />
          <Button
            icon="pi pi-times"
            size="small"
            text
            severity="secondary"
            title="Close search"
            @click="toggleBodySearchBox"
          />
        </div>
      </div>
      <JsonEditor
        ref="bodyEditorRef"
        v-model="body.raw"
        :language="body.type"
        :availableVariables="availableVariables"
        :searchMatches="bodySearchMatches"
        :currentMatchIndex="bodyCurrentMatchIndex"
        @ctrl-f="openBodySearchBox"
      />
    </div>
  </div>
</template>

<style scoped>
.form-data-row {
  height: 42px;
}

.form-data-row :deep(.variable-input-wrapper),
.form-data-row :deep(.p-inputtext) {
  min-height: 42px;
  height: 42px;
}

.form-data-file-picker {
  width: 100%;
  min-width: 0;
  height: 42px;
  display: flex;
  align-items: center;
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--p-inputtext-border-color, #cbd5e1);
  border-radius: 6px;
  background: var(--p-inputtext-background, #ffffff);
  color: var(--p-inputtext-color, #334155);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.2s, box-shadow 0.2s, background-color 0.2s;
}

.form-data-file-picker:hover {
  border-color: var(--p-primary-400, #60a5fa);
}

.form-data-file-picker:focus-visible {
  outline: none;
  border-color: var(--p-primary-500, #3b82f6);
  box-shadow: 0 0 0 1px var(--p-primary-500, #3b82f6);
}

.form-data-file-picker-action {
  height: 100%;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex: 0 0 auto;
  padding: 0 0.75rem;
  border-right: 1px solid var(--p-inputtext-border-color, #cbd5e1);
  background: var(--p-surface-100, #f1f5f9);
  color: var(--p-surface-800, #1e293b);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.form-data-file-picker-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 0.75rem;
  color: var(--p-surface-600, #475569);
  font-size: 13px;
}

.form-data-file-picker-name.is-placeholder {
  color: var(--p-surface-400, #94a3b8);
}

/* `.p-dark` is an ancestor on <html>, so :deep(.p-dark) compiled to
   `[data-v] .p-dark …` and never matched (dark styles silently ignored).
   Plain `.p-dark <scoped>` compiles to `.p-dark <scoped>[data-v]` and works. */
.p-dark .form-data-file-picker {
  border-color: var(--p-surface-600, #475569);
  background: var(--p-surface-900, #0f172a);
  color: var(--p-surface-100, #f1f5f9);
}

.p-dark .form-data-file-picker-action {
  border-right-color: var(--p-surface-600, #475569);
  background: var(--p-surface-800, #1e293b);
  color: var(--p-surface-100, #f1f5f9);
}

.p-dark .form-data-file-picker-name {
  color: var(--p-surface-300, #cbd5e1);
}

.p-dark .form-data-file-picker-name.is-placeholder {
  color: var(--p-surface-500, #64748b);
}
</style>
