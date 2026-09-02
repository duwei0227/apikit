<script setup>
import { ref, computed, watch } from 'vue';

// Save-request modal: pick a name and a target collection/folder.
// Pure picker UI — the parent owns the actual save (duplicate check, building
// the request payload, persistence) and controls when the dialog closes.
const props = defineProps({
  visible: { type: Boolean, default: false },
  collections: { type: Array, default: () => [] },
  initialName: { type: String, default: '' },
  initialCollection: { type: Object, default: null },
  initialFolder: { type: Object, default: null },
});

const emit = defineEmits(['update:visible', 'save']);

const name = ref('');
const selectedCollection = ref(null);
const selectedFolder = ref(null);
const selectedKeys = ref({});

// (Re)initialize fields each time the dialog opens, from the parent's prefill props.
watch(
  () => props.visible,
  (visible) => {
    if (!visible) return;
    name.value = props.initialName || '';
    selectedCollection.value = props.initialCollection || null;
    selectedFolder.value = props.initialFolder || null;
    if (selectedCollection.value) {
      const key = selectedFolder.value
        ? `collection/${selectedCollection.value.id}/${selectedFolder.value.id}`
        : `collection/${selectedCollection.value.id}`;
      selectedKeys.value = { [key]: true };
    } else {
      selectedKeys.value = {};
    }
  },
  { immediate: true }
);

// Build the tree of collections/folders for the location picker.
const treeData = computed(() => {
  const buildTreeNode = (item, type = 'collection', parentKey = '') => {
    // Use '/' as the separator because IDs may contain '-'.
    const key = parentKey ? `${parentKey}/${item.id}` : `${type}/${item.id}`;
    const node = {
      key,
      label: item.name,
      data: { ...item, type },
      icon: type === 'collection' ? 'pi pi-folder' : 'pi pi-folder-open',
      children: [],
    };
    if (item.folders && item.folders.length > 0) {
      node.children = item.folders.map(folder => buildTreeNode(folder, 'folder', key));
    }
    return node;
  };
  return props.collections.map(collection => buildTreeNode(collection));
});

const onNodeSelect = (node) => {
  const nodeData = node.data;
  if (nodeData.type === 'collection') {
    selectedCollection.value = nodeData;
    selectedFolder.value = null;
  } else if (nodeData.type === 'folder') {
    const parts = node.key.split('/');
    // parts[0]='collection', parts[1]=collectionId, parts[2+]=folder IDs (possibly nested)
    const collectionId = parts[1];
    const parentCollection = props.collections.find(c => String(c.id) === collectionId);
    if (!parentCollection) return;

    const findFolderByPath = (folders, pathParts, startIndex) => {
      if (startIndex >= pathParts.length) return null;
      const currentFolderId = pathParts[startIndex];
      const folder = folders.find(f => String(f.id) === currentFolderId);
      if (!folder) return null;
      if (startIndex === pathParts.length - 1) return folder;
      if (folder.folders && folder.folders.length > 0) {
        return findFolderByPath(folder.folders, pathParts, startIndex + 1);
      }
      return null;
    };

    const folder = findFolderByPath(parentCollection.folders || [], parts.slice(2), 0);
    if (folder) {
      selectedCollection.value = parentCollection;
      selectedFolder.value = folder;
    }
  }
  selectedKeys.value = { [node.key]: true };
};

// Full "Collection / Folder / Subfolder" path of the current selection.
const selectedPath = computed(() => {
  if (!selectedCollection.value) return '';
  const parts = [selectedCollection.value.name];
  if (selectedFolder.value) {
    const findPath = (folders, targetId, currentPath = []) => {
      for (const folder of folders) {
        const newPath = [...currentPath, folder.name];
        if (String(folder.id) === String(targetId)) return newPath;
        if (folder.folders && folder.folders.length > 0) {
          const found = findPath(folder.folders, targetId, newPath);
          if (found) return found;
        }
      }
      return null;
    };
    const folderPath = findPath(selectedCollection.value.folders || [], selectedFolder.value.id);
    if (folderPath) parts.push(...folderPath);
  }
  return parts.join(' / ');
});

const onSave = () => {
  if (!name.value.trim() || !selectedCollection.value) return;
  emit('save', {
    name: name.value.trim(),
    collection: selectedCollection.value,
    folder: selectedFolder.value,
  });
};

const onCancel = () => {
  emit('update:visible', false);
};
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
    header="Save Request"
    :modal="true"
    :style="{ width: '500px' }"
  >
    <div class="flex flex-col gap-4">
      <!-- Request Name -->
      <div>
        <label for="requestName" class="block text-sm font-medium mb-2">
          Request Name
        </label>
        <InputText
          id="requestName"
          v-model="name"
          placeholder="Enter request name"
          class="w-full"
          autofocus
        />
      </div>

      <!-- Collection Selection -->
      <div>
        <label class="block text-sm font-medium mb-2">
          Save to Collection
        </label>

        <div class="border border-surface-300 dark:border-surface-600 rounded p-3 max-h-64 overflow-y-auto">
          <Tree
            :value="treeData"
            v-model:selectionKeys="selectedKeys"
            selectionMode="single"
            @node-select="onNodeSelect"
            :filter="true"
            :filterBy="'label'"
            :filterMode="'lenient'"
            :filterPlaceholder="'Search collections...'"
            class="w-full"
          >
            <template #default="{ node }">
              <span>{{ node.label }}</span>
            </template>
          </Tree>
        </div>

        <!-- Selected Location Display -->
        <div v-if="selectedCollection" class="mt-2 p-2 bg-surface-100 dark:bg-surface-800 rounded text-sm">
          <span class="font-medium">Selected: </span>
          <span>{{ selectedPath }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" @click="onCancel" />
      <Button label="Save" @click="onSave" :disabled="!name.trim() || !selectedCollection" />
    </template>
  </Dialog>
</template>
