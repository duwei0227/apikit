<script setup lang="ts">
import { ref, nextTick, type Ref } from 'vue';
import VariableInput from './VariableInput.vue';
import { useKeyValueRows } from '@/composables/useKeyValueRows';
import { getRowKey, reconcileRows } from '@/utils/stableRows';
import { parseKeyValueBulkEdit, serializeKeyValueBulkEdit } from '@/utils/keyValueBulkEdit';
import { COMMON_HEADERS as commonHeaders, HEADER_VALUE_OPTIONS as headerValueOptions } from '@/constants/httpHeaders';
import type { KeyValue } from '@/types/models';

// The request headers array (localRequest.headers) is two-way bound; this
// component edits the rows in place and offers suggestions for common headers.
const headers = defineModel<KeyValue[]>('headers', { required: true });

withDefaults(defineProps<{ availableVariables?: Record<string, string> }>(), {
  availableVariables: () => ({}),
});

const { remove: removeHeader, onChange: onHeaderChange } = useKeyValueRows({
  getRows: () => headers.value,
  createRow: () => ({ key: '', value: '', enabled: true }),
});

const isBulkEdit = ref(false);
const bulkText = ref('');

const enterBulkEdit = () => {
  bulkText.value = serializeKeyValueBulkEdit(headers.value);
  isBulkEdit.value = true;
};

const updateHeadersFromBulkEdit = () => {
  const parsed = parseKeyValueBulkEdit(bulkText.value, headers.value);
  reconcileRows(headers.value, parsed);
  onHeaderChange();
};

const leaveBulkEdit = () => {
  isBulkEdit.value = false;
  onHeaderChange();
};

const filteredHeaderKeys = ref<string[]>([]);
const filteredHeaderValues = ref<string[]>([]);
const activeHeaderKeyIndex = ref(-1);
const activeHeaderValueIndex = ref(-1);
const headerSuggestionsStyle = ref<Record<string, string>>({});
// Index of the highlighted suggestion within the open key/value dropdown (for
// up/down keyboard navigation). Distinct from active*Index above, which is the
// header ROW whose dropdown is open.
const highlightedHeaderKeyIndex = ref(0);
const highlightedHeaderValueIndex = ref(0);
const headerKeyDropdownRef = ref<HTMLElement | null>(null);
const headerValueDropdownRef = ref<HTMLElement | null>(null);

const updateHeaderSuggestionsPosition = (event: Event) => {
  const input = event.target as HTMLElement | null;
  if (!input || typeof input.getBoundingClientRect !== 'function') return;

  const rect = input.getBoundingClientRect();
  headerSuggestionsStyle.value = {
    width: `${rect.width}px`,
    left: `${rect.left}px`,
    top: `${rect.bottom + 4}px`
  };
};

const filterHeaderKeys = (event: Event, index: number) => {
  updateHeaderSuggestionsPosition(event);
  const query = (event.target as HTMLInputElement).value.toLowerCase();
  if (query) {
    filteredHeaderKeys.value = commonHeaders.filter(h =>
      h.toLowerCase().includes(query)
    );
    activeHeaderKeyIndex.value = index;
    highlightedHeaderKeyIndex.value = 0;
  } else {
    filteredHeaderKeys.value = [];
    activeHeaderKeyIndex.value = -1;
  }
};

const selectHeaderKey = (header: string, index: number) => {
  headers.value[index].key = header;
  filteredHeaderKeys.value = [];
  activeHeaderKeyIndex.value = -1;
  onHeaderChange();
};

const filterHeaderValues = (event: Event, index: number) => {
  updateHeaderSuggestionsPosition(event);
  const headerKey = headers.value[index].key;
  const query = (event.target as HTMLInputElement).value.toLowerCase();

  if (headerKey && headerValueOptions[headerKey]) {
    if (query) {
      filteredHeaderValues.value = headerValueOptions[headerKey].filter(v =>
        v.toLowerCase().includes(query)
      );
    } else {
      filteredHeaderValues.value = headerValueOptions[headerKey];
    }
    activeHeaderValueIndex.value = index;
    highlightedHeaderValueIndex.value = 0;
  } else {
    filteredHeaderValues.value = [];
    activeHeaderValueIndex.value = -1;
  }
};

const selectHeaderValue = (value: string, index: number) => {
  headers.value[index].value = value;
  filteredHeaderValues.value = [];
  activeHeaderValueIndex.value = -1;
  onHeaderChange();
};

// Keep the highlighted suggestion scrolled into view during keyboard nav.
const scrollHeaderSuggestionIntoView = (dropdownRef: Ref<HTMLElement | null>, idx: number) => {
  nextTick(() => {
    dropdownRef.value?.children[idx]?.scrollIntoView({ block: 'nearest' });
  });
};

// Up/Down/Enter/Escape navigation for the built-in header dropdowns. Bound via
// @keydown on the VariableInput (falls through to its root, so native keydown
// bubbles here). VariableInput's own handler ignores arrows unless ITS {{ }}
// suggestions are open, so the two never fight for the same keypress.
const onHeaderKeyKeydown = (event: KeyboardEvent, index: number) => {
  if (filteredHeaderKeys.value.length === 0 || activeHeaderKeyIndex.value < 0) return;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      highlightedHeaderKeyIndex.value = Math.min(highlightedHeaderKeyIndex.value + 1, filteredHeaderKeys.value.length - 1);
      scrollHeaderSuggestionIntoView(headerKeyDropdownRef, highlightedHeaderKeyIndex.value);
      break;
    case 'ArrowUp':
      event.preventDefault();
      highlightedHeaderKeyIndex.value = Math.max(highlightedHeaderKeyIndex.value - 1, 0);
      scrollHeaderSuggestionIntoView(headerKeyDropdownRef, highlightedHeaderKeyIndex.value);
      break;
    case 'Enter':
      if (filteredHeaderKeys.value[highlightedHeaderKeyIndex.value]) {
        event.preventDefault();
        selectHeaderKey(filteredHeaderKeys.value[highlightedHeaderKeyIndex.value], index);
      }
      break;
    case 'Escape':
      event.preventDefault();
      filteredHeaderKeys.value = [];
      activeHeaderKeyIndex.value = -1;
      break;
  }
};

const onHeaderValueKeydown = (event: KeyboardEvent, index: number) => {
  if (filteredHeaderValues.value.length === 0 || activeHeaderValueIndex.value < 0) return;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      highlightedHeaderValueIndex.value = Math.min(highlightedHeaderValueIndex.value + 1, filteredHeaderValues.value.length - 1);
      scrollHeaderSuggestionIntoView(headerValueDropdownRef, highlightedHeaderValueIndex.value);
      break;
    case 'ArrowUp':
      event.preventDefault();
      highlightedHeaderValueIndex.value = Math.max(highlightedHeaderValueIndex.value - 1, 0);
      scrollHeaderSuggestionIntoView(headerValueDropdownRef, highlightedHeaderValueIndex.value);
      break;
    case 'Enter':
      if (filteredHeaderValues.value[highlightedHeaderValueIndex.value]) {
        event.preventDefault();
        selectHeaderValue(filteredHeaderValues.value[highlightedHeaderValueIndex.value], index);
      }
      break;
    case 'Escape':
      event.preventDefault();
      filteredHeaderValues.value = [];
      activeHeaderValueIndex.value = -1;
      break;
  }
};

// 失焦时只关闭该输入框自己的下拉（延迟以便 mousedown 选中建议）；
// 不能同时关掉另一个，否则从 Key 直接点到 Value 时，Value 刚打开的选项会被一起清掉
const hideHeaderKeySuggestions = () => {
  setTimeout(() => {
    filteredHeaderKeys.value = [];
    activeHeaderKeyIndex.value = -1;
  }, 200);
};

const hideHeaderValueSuggestions = () => {
  setTimeout(() => {
    filteredHeaderValues.value = [];
    activeHeaderValueIndex.value = -1;
  }, 200);
};
</script>

<template>
  <div class="p-4 overflow-y-auto">
    <div class="mb-3">
      <h4 class="text-sm font-medium text-surface-700 dark:text-surface-300">Headers</h4>
    </div>
    <div v-show="isBulkEdit" class="mb-2 flex justify-end">
      <Button
        label="Key-Value Edit"
        text
        size="small"
        class="ak-mode-toggle-button ak-mode-toggle-key-value"
        @click="leaveBulkEdit"
      />
    </div>

    <div v-show="isBulkEdit">
      <textarea
        v-model="bulkText"
        class="ak-bulk-edit-textarea w-full"
        aria-label="Headers bulk edit"
        placeholder="key: value"
        spellcheck="false"
        @input="updateHeadersFromBulkEdit"
      />
    </div>

    <div v-show="!isBulkEdit">
      <div class="ak-key-value-table-header relative flex gap-2 mb-2 text-sm font-bold text-surface-700 dark:text-surface-300 px-2">
        <div style="width: 40px;"></div>
        <div class="flex-1">KEY</div>
        <div class="flex-1">VALUE</div>
        <Button
          label="Bulk Edit"
          text
          size="small"
          class="ak-key-value-bulk-edit-button ak-mode-toggle-button ak-mode-toggle-bulk"
          @click="enterBulkEdit"
        />
        <div style="width: 40px; flex: 0 0 40px;"></div>
      </div>

      <div class="space-y-1">
        <div
          v-for="(header, index) in headers"
          :key="getRowKey(header)"
          class="flex gap-2 items-center"
        >
          <div class="flex justify-center" style="width: 40px;">
            <Checkbox v-model="header.enabled" :binary="true" />
          </div>
          <div class="flex-1 relative">
            <VariableInput
              v-model="header.key"
              placeholder="Key"
              size="small"
              :availableVariables="availableVariables"
              @input="(e) => { onHeaderChange(); filterHeaderKeys(e, index); }"
              @focus="(e) => filterHeaderKeys(e, index)"
              @keydown="(e: KeyboardEvent) => onHeaderKeyKeydown(e, index)"
              @blur="hideHeaderKeySuggestions"
            />
          </div>
          <div class="flex-1 relative">
            <VariableInput
              v-model="header.value"
              placeholder="Value"
              size="small"
              :availableVariables="availableVariables"
              @input="(e) => { onHeaderChange(); filterHeaderValues(e, index); }"
              @focus="(e) => filterHeaderValues(e, index)"
              @keydown="(e: KeyboardEvent) => onHeaderValueKeydown(e, index)"
              @blur="hideHeaderValueSuggestions"
            />
          </div>
          <div class="flex justify-center" style="width: 40px;">
            <Button
              v-if="headers.length > 1 || header.key || header.value"
              icon="pi pi-trash"
              text
              rounded
              size="small"
              severity="danger"
              @click="removeHeader(index)"
            />
          </div>
        </div>
      </div>
    </div>
    <Teleport to="body">
      <div
        v-if="filteredHeaderKeys.length > 0 && activeHeaderKeyIndex >= 0"
        ref="headerKeyDropdownRef"
        class="header-suggestions-dropdown"
        :style="headerSuggestionsStyle"
      >
        <div
          v-for="(suggestion, suggestionIndex) in filteredHeaderKeys"
          :key="suggestion"
          @mousedown="selectHeaderKey(suggestion, activeHeaderKeyIndex)"
          @mouseenter="highlightedHeaderKeyIndex = suggestionIndex"
          :class="[
            'header-suggestion-item',
            suggestionIndex === highlightedHeaderKeyIndex ? 'header-suggestion-item-active' : ''
          ]"
        >
          {{ suggestion }}
        </div>
      </div>
      <div
        v-if="filteredHeaderValues.length > 0 && activeHeaderValueIndex >= 0"
        ref="headerValueDropdownRef"
        class="header-suggestions-dropdown"
        :style="headerSuggestionsStyle"
      >
        <div
          v-for="(suggestion, suggestionIndex) in filteredHeaderValues"
          :key="suggestion"
          @mousedown="selectHeaderValue(suggestion, activeHeaderValueIndex)"
          @mouseenter="highlightedHeaderValueIndex = suggestionIndex"
          :class="[
            'header-suggestion-item',
            suggestionIndex === highlightedHeaderValueIndex ? 'header-suggestion-item-active' : ''
          ]"
        >
          {{ suggestion }}
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.header-suggestions-dropdown {
  position: fixed;
  z-index: var(--ak-floating-z, 2000);
  max-height: 16rem;
  overflow-y: auto;
  background: var(--p-surface-0, #ffffff);
  border: 1px solid var(--p-surface-300, #cbd5e1);
  border-radius: 0.375rem;
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
}

.header-suggestion-item {
  min-height: 40px;
  padding: 0.5rem 0.75rem;
  display: flex;
  align-items: center;
  font-size: 13px;
  line-height: 1.5rem;
  color: var(--p-text-color, #0f172a);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.header-suggestion-item:hover {
  background: var(--p-surface-200, #e2e8f0);
}

/* Keyboard-selected item — shares the bright blue --ac-selected-* accent with
   the {{ }} pickers. The variables switch per theme (style.css), so this single
   rule covers both light and dark; !important keeps it above the dark text rule. */
.header-suggestion-item-active {
  background: var(--ac-selected-bg, #2563eb) !important;
  color: var(--ac-selected-label-color, #ffffff) !important;
}

/* NOTE: `.p-dark` (on <html>) is an ANCESTOR, not a descendant, so :deep(.p-dark)
   compiled to `[data-v] .p-dark …` and never matched — the dropdown stayed white
   in dark mode. Plain `.p-dark <scoped> ` compiles to `.p-dark <scoped>[data-v]`,
   which correctly targets the scoped element under html.p-dark. */
.p-dark .header-suggestions-dropdown {
  background: var(--p-surface-800, #202122);
  border-color: var(--p-surface-700, #334155);
}

.p-dark .header-suggestion-item {
  color: var(--p-surface-50, #f8fafc);
}

.p-dark .header-suggestion-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

</style>
