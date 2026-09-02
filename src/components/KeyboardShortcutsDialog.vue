<script setup>
const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:visible']);

const shortcuts = [
  {
    category: 'General',
    items: [
      { keys: ['Ctrl', 'N'], description: 'Create new (Request/Collection/Environment)', scope: 'Global', icon: 'pi pi-plus' },
      { keys: ['Ctrl', 'D'], description: 'Duplicate selected item in Collections (Folder/Request)', scope: 'Collections Panel', icon: 'pi pi-copy' },
      { keys: ['Ctrl', 'S'], description: 'Save current request or workflow', scope: 'Editor', icon: 'pi pi-save' },
      { keys: ['Ctrl', 'Z'], description: 'Undo', scope: 'Input Fields / JSON Editor', icon: 'pi pi-undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], description: 'Redo', scope: 'Input Fields / JSON Editor', icon: 'pi pi-refresh' }
    ]
  },
  {
    category: 'Collections',
    items: [
      { keys: ['Delete'], description: 'Delete selected item', scope: 'Collections Panel', icon: 'pi pi-trash' }
    ]
  },
  {
    category: 'View',
    items: [
      { keys: ['Ctrl', 'Shift', 'D'], description: 'Toggle dark/light mode', scope: 'Global', icon: 'pi pi-moon' }
    ]
  },
  {
    category: 'Help',
    items: [
      { keys: ['Ctrl', '/'], description: 'Show keyboard shortcuts', scope: 'Global', icon: 'pi pi-sliders-h' }
    ]
  }
];

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
        v-for="section in shortcuts"
        :key="section.category"
        class="shortcut-section mb-6"
      >
        <h3 class="text-lg font-semibold mb-3 text-surface-900 dark:text-surface-50">
          {{ section.category }}
        </h3>
        <div class="space-y-2">
          <div
            v-for="(item, index) in section.items"
            :key="index"
            class="flex items-center justify-between py-2 px-3 rounded hover:bg-surface-50 dark:hover:bg-surface-800 transition"
          >
            <div class="flex items-center gap-2">
              <i :class="item.icon" class="text-surface-500 dark:text-surface-400"></i>
              <span class="text-sm text-surface-700 dark:text-surface-300">
                {{ item.description }}
              </span>
              <span class="text-xs px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">
                {{ item.scope }}
              </span>
            </div>
            <div class="flex gap-1">
              <kbd
                v-for="(key, keyIndex) in item.keys"
                :key="keyIndex"
                class="px-2 py-1 text-xs font-mono bg-surface-100 dark:bg-surface-700 border border-surface-300 dark:border-surface-600 rounded shadow-sm"
              >
                {{ key }}
              </kbd>
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
  max-height: 500px;
  overflow-y: auto;
}

kbd {
  min-width: 2rem;
  text-align: center;
}
</style>
