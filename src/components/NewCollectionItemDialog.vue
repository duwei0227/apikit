<script setup lang="ts">
import { dialogStyle } from '@/utils/dialogSize';
import { ref, computed } from 'vue';
import { useCollectionsStore } from '@/stores/collections';
import type { Collection, Folder } from '@/types/models';

interface FolderLocation {
  collection: Collection;
  folder?: Folder | null;
}

const collectionsStore = useCollectionsStore();
const collections = computed(() => collectionsStore.collections);

const showCreateDialog = ref(false);
const dialogMode = ref<'collection' | 'folder'>('collection');
const newItemName = ref('');
const newItemDescription = ref('');
// 新建文件夹的位置：{ collection, folder }，folder 为空时建在集合根目录
const target = ref<FolderLocation | null>(null);

/** mode 为 collection 或 folder；新建文件夹时传入所在的集合和上级文件夹 */
const openCreateDialog = (mode: 'collection' | 'folder' = 'collection', location: FolderLocation | null = null) => {
  dialogMode.value = mode;
  target.value = location;
  showCreateDialog.value = true;
  newItemName.value = '';
  newItemDescription.value = '';
};

// 检查新建名称是否重复
const isCreateNameDuplicate = computed(() => {
  if (!newItemName.value.trim()) return false;
  const name = newItemName.value.trim().toLowerCase();
  if (dialogMode.value === 'collection') {
    return collections.value.some(c => c.name.toLowerCase() === name);
  }
  return false;
});

const createItem = async () => {
  if (!newItemName.value.trim() || isCreateNameDuplicate.value) return;
  
  try {
    if (dialogMode.value === 'collection') {
      await collectionsStore.createCollection(
        newItemName.value.trim(),
        newItemDescription.value.trim()
      );
    } else if (dialogMode.value === 'folder' && target.value) {
      const { collection, folder } = target.value;
      await collectionsStore.addFolder(
        collection.id,
        newItemName.value.trim(),
        folder?.id
      );
    }
    
    showCreateDialog.value = false;
    newItemName.value = '';
    newItemDescription.value = '';
  } catch (error) {
    console.error('Failed to create item:', error);
  }
};

defineExpose({ open: openCreateDialog });
</script>

<template>
  <Dialog 
    v-model:visible="showCreateDialog"
    :header="dialogMode === 'collection' ? 'New Collection' : 'New Folder'"
    :modal="true"
    :style="dialogStyle('sm')"
  >
    <div class="flex flex-col gap-4">
      <div>
        <label class="block text-sm font-medium mb-2">Name</label>
        <InputText 
          v-model="newItemName"
          placeholder="Enter a name"
          class="w-full"
          :invalid="isCreateNameDuplicate"
          autofocus
        />
        <small v-if="isCreateNameDuplicate" class="text-red-500">
          This name already exists
        </small>
      </div>
      <div v-if="dialogMode === 'collection'">
        <label class="block text-sm font-medium mb-2">Description (optional)</label>
        <InputText 
          v-model="newItemDescription"
          placeholder="Enter a description"
          class="w-full"
        />
      </div>
    </div>
  
    <template #footer>
      <Button label="Cancel" severity="secondary" @click="showCreateDialog = false" />
      <Button 
        label="Create"
        @click="createItem"
        :disabled="!newItemName.trim() || isCreateNameDuplicate"
      />
    </template>
  </Dialog>
</template>
