<script setup lang="ts">
import { isMacPlatform, shortcutKeys } from '@/utils/shortcuts';

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [visible: boolean] }>();

interface ShortcutItem {
  description: string;
  /** 按键组合，Mod 在 macOS 上为 ⌘，其他系统为 Ctrl；多个组合依次显示 */
  keys: string[];
  /** macOS 上按键不同时填写（与 Ace 的 mac 绑定一致） */
  macKeys?: string[];
}

interface ShortcutSection {
  category: string;
  items: ShortcutItem[];
}

const UNDO_REDO: ShortcutItem = { description: 'Undo / Redo', keys: ['Mod+Z', 'Mod+Shift+Z', 'Mod+Y'] };

// 编辑器部分与 Ace 的默认快捷键一致（ace-builds 的 default_commands）
const sections: ShortcutSection[] = [
  {
    category: 'General',
    items: [
      { description: 'Create new (Request/Collection/Environment)', keys: ['Mod+N'] },
      { description: 'Save current request or workflow', keys: ['Mod+S'] },
      // macOS 的 ⌘⌥D 是系统的隐藏 Dock，所以用 ⌃⌥D
      { description: 'Switch dark/light mode', keys: ['Mod+Alt+D'], macKeys: ['Ctrl+Alt+D'] },
      { description: 'Show keyboard shortcuts', keys: ['F1'] },
      { description: 'Close popup / suggestions', keys: ['Esc'] },
    ],
  },
  {
    category: 'Collections (selected item in the tree)',
    items: [
      { description: 'Duplicate', keys: ['Mod+D'] },
      { description: 'Delete', keys: ['Delete'] },
    ],
  },
  {
    category: 'Editor (request body)',
    items: [
      { description: 'Search', keys: ['Mod+F'] },
      UNDO_REDO,
      { description: 'Toggle line comment', keys: ['Mod+/'] },
      { description: 'Delete line', keys: ['Mod+D'] },
      { description: 'Duplicate line or selection', keys: ['Mod+Shift+D'] },
      { description: 'Move line up / down', keys: ['Alt+Up', 'Alt+Down'] },
      { description: 'Copy line up / down', keys: ['Alt+Shift+Up', 'Alt+Shift+Down'], macKeys: ['Mod+Alt+Up', 'Mod+Alt+Down'] },
      { description: 'Indent / outdent', keys: ['Tab', 'Shift+Tab'] },
      { description: 'Add cursor above / below', keys: ['Ctrl+Alt+Up', 'Ctrl+Alt+Down'] },
      { description: 'Fold / unfold', keys: ['Alt+L', 'Alt+Shift+L'], macKeys: ['Mod+Alt+L', 'Mod+Alt+Shift+L'] },
      { description: 'Upper / lower case', keys: ['Ctrl+U', 'Ctrl+Shift+U'] },
    ],
  },
  {
    category: 'Input fields',
    items: [UNDO_REDO],
  },
  {
    category: 'Response',
    items: [
      { description: 'Search', keys: ['Mod+F'] },
      { description: 'Select all', keys: ['Mod+A'] },
    ],
  },
];

const mac = isMacPlatform();
const combosOf = (item: ShortcutItem) => (mac && item.macKeys ? item.macKeys : item.keys).map(combo => shortcutKeys(combo, mac));

const closeDialog = () => {
  emit('update:visible', false);
};
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="closeDialog"
    header="Keyboard Shortcuts"
    :modal="true"
    :style="{ width: '700px' }"
    :dismissableMask="true"
  >
    <div class="shortcuts-container">
      <div
        v-for="section in sections"
        :key="section.category"
        class="shortcut-section mb-5"
      >
        <h3 class="text-base font-semibold mb-2 text-surface-900 dark:text-surface-50">
          {{ section.category }}
        </h3>
        <div>
          <div
            v-for="item in section.items"
            :key="item.description"
            class="flex items-center justify-between gap-4 py-1.5 px-3 rounded hover:bg-surface-50 dark:hover:bg-surface-800 transition"
          >
            <span class="text-sm text-surface-700 dark:text-surface-300">
              {{ item.description }}
            </span>
            <div class="flex items-center gap-1 flex-shrink-0">
              <template v-for="(combo, comboIndex) in combosOf(item)" :key="comboIndex">
                <span v-if="comboIndex > 0" class="text-xs text-surface-400 px-0.5">/</span>
                <kbd
                  v-for="(key, keyIndex) in combo"
                  :key="keyIndex"
                  class="px-2 py-0.5 text-xs font-mono bg-surface-100 dark:bg-surface-700 border border-surface-300 dark:border-surface-600 rounded shadow-sm"
                >
                  {{ key }}
                </kbd>
              </template>
            </div>
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
.shortcuts-container {
  max-height: 65vh;
  overflow-y: auto;
}

kbd {
  min-width: 2rem;
  text-align: center;
}
</style>
