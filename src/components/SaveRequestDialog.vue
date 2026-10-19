<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useCollectionsStore } from '@/stores/collections';
import type { Collection, Folder } from '@/types/models';

// Save-request modal: pick a name and a target collection/folder, or create a
// collection inline. The parent owns the actual save (duplicate check, building
// the request payload, persistence) and controls when the dialog closes.
const props = withDefaults(defineProps<{
  visible?: boolean;
  collections?: Collection[];
  initialName?: string;
  initialCollection?: Collection | null;
  initialFolder?: Folder | null;
}>(), {
  visible: false,
  collections: () => [],
  initialName: '',
  initialCollection: null,
  initialFolder: null,
});

const emit = defineEmits<{
  'update:visible': [visible: boolean];
  save: [payload: { name: string; collection: Collection; folder: Folder | null }];
}>();

interface LocationNode {
  key: string;
  label: string;
  data: (Collection | Folder) & { type: 'collection' | 'folder' };
  icon: string;
  children: LocationNode[];
}

const name = ref('');
const selectedCollection = ref<Collection | null>(null);
const selectedFolder = ref<Folder | null>(null);
const selectedKeys = ref<Record<string, boolean>>({});
const expandedKeys = ref<Record<string, boolean>>({});

// 新建集合（对话框内，新建后选中它）
const collectionsStore = useCollectionsStore();
const isCreatingCollection = ref(false);
const newCollectionName = ref('');
const newCollectionInput = ref<{ $el: HTMLElement } | null>(null);

/** 展开节点的全部上级（key 按层级拼接：collection/<cid>/<fid>...） */
const expandAncestors = (key: string) => {
  const parts = key.split('/');
  const next: Record<string, boolean> = {};
  for (let i = 2; i < parts.length; i++) {
    next[parts.slice(0, i).join('/')] = true;
  }
  expandedKeys.value = next;
};

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
      expandAncestors(key);
    } else {
      selectedKeys.value = {};
      expandedKeys.value = {};
    }
    isCreatingCollection.value = false;
    newCollectionName.value = '';
  },
  { immediate: true }
);

// Build the tree of collections/folders for the location picker.
const treeData = computed(() => {
  const buildTreeNode = (item: Collection | Folder, type: 'collection' | 'folder' = 'collection', parentKey = ''): LocationNode => {
    // Use '/' as the separator because IDs may contain '-'.
    const key = parentKey ? `${parentKey}/${item.id}` : `${type}/${item.id}`;
    const node: LocationNode = {
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

const onNodeSelect = (node: LocationNode) => {
  const nodeData = node.data;
  if (nodeData.type === 'collection') {
    selectedCollection.value = nodeData as Collection;
    selectedFolder.value = null;
  } else if (nodeData.type === 'folder') {
    const parts = node.key.split('/');
    // parts[0]='collection', parts[1]=collectionId, parts[2+]=folder IDs (possibly nested)
    const collectionId = parts[1];
    const parentCollection = props.collections.find(c => String(c.id) === collectionId);
    if (!parentCollection) return;

    const findFolderByPath = (folders: Folder[], pathParts: string[], startIndex: number): Folder | null => {
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
    const findPath = (folders: Folder[], targetId: string, currentPath: string[] = []): string[] | null => {
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

const isCollectionNameDuplicate = computed(() => {
  const name = newCollectionName.value.trim().toLowerCase();
  return !!name && props.collections.some(collection => collection.name.toLowerCase() === name);
});

const startCreatingCollection = async () => {
  newCollectionName.value = '';
  isCreatingCollection.value = true;
  // 对话框已打开，autofocus 不会生效，手动聚焦
  await nextTick();
  newCollectionInput.value?.$el.focus();
};

const createCollection = async () => {
  const collectionName = newCollectionName.value.trim();
  if (!collectionName || isCollectionNameDuplicate.value) return;
  const collection = await collectionsStore.createCollection(collectionName);
  selectedCollection.value = collection;
  selectedFolder.value = null;
  selectedKeys.value = { [`collection/${collection.id}`]: true };
  isCreatingCollection.value = false;
};

// Esc 只关闭新建集合的输入框，不关闭对话框
const onNewCollectionKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    createCollection();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    isCreatingCollection.value = false;
  }
};

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
        <div class="flex items-center justify-between mb-2">
          <label class="block text-sm font-medium">
            Save to Collection
          </label>
          <Button
            v-if="!isCreatingCollection"
            label="New Collection"
            icon="pi pi-plus"
            text
            size="small"
            @click="startCreatingCollection"
          />
        </div>

        <div v-if="isCreatingCollection" class="mb-2">
          <div class="flex items-center gap-2">
            <InputText
              ref="newCollectionInput"
              v-model="newCollectionName"
              placeholder="Collection name"
              class="flex-1"
              size="small"
              :invalid="isCollectionNameDuplicate"
              @keydown="onNewCollectionKeydown"
            />
            <Button
              label="Create"
              size="small"
              :disabled="!newCollectionName.trim() || isCollectionNameDuplicate"
              @click="createCollection"
            />
            <Button label="Cancel" size="small" severity="secondary" text @click="isCreatingCollection = false" />
          </div>
          <small v-if="isCollectionNameDuplicate" class="text-red-500">This name already exists</small>
        </div>

        <div class="border border-surface-300 dark:border-surface-600 rounded p-3 max-h-64 overflow-y-auto">
          <div v-if="treeData.length === 0" class="text-sm text-surface-500 dark:text-surface-400 text-center py-4">
            No collections yet. Click New Collection to create one.
          </div>
          <Tree
            v-else
            v-model:expandedKeys="expandedKeys"
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
          <span v-if="!selectedFolder" class="text-surface-500 dark:text-surface-400"> (collection root)</span>
        </div>
      </div>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" @click="onCancel" />
      <Button label="Save" @click="onSave" :disabled="!name.trim() || !selectedCollection" />
    </template>
  </Dialog>
</template>
