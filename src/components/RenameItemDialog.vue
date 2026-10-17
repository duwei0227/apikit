<script setup lang="ts">
import { ref, computed } from 'vue';
import { useCollectionsStore } from '@/stores/collections';
import { useRequestsStore } from '@/stores/requests';
import { findFolderInCollection, findSiblingFolders, isRequestNameTaken } from '@/utils/collectionTree';

/** 要重命名的集合、文件夹或请求（树节点的数据） */
export type RenameTarget =
  | { type: 'collection' | 'folder'; id: string; name: string }
  | { type: 'request'; id: string; name: string; collectionId?: string | null; folderId?: string | null };

const collectionsStore = useCollectionsStore();
const requestsStore = useRequestsStore();
const collections = computed(() => collectionsStore.collections);

const showRenameDialog = ref(false);
const renameItemName = ref('');
const renamingItem = ref<RenameTarget | null>(null);

/** item 为集合、文件夹或请求节点的数据（带 type） */
const openRenameDialog = (item: RenameTarget) => {
  renamingItem.value = item;
  renameItemName.value = item.name;
  showRenameDialog.value = true;
};

// 检查重命名名称是否重复
const isRenameNameDuplicate = computed(() => {
  if (!renameItemName.value.trim() || !renamingItem.value) return false;
  const name = renameItemName.value.trim().toLowerCase();
  const item = renamingItem.value;
  if (name === item.name.toLowerCase()) return false;
  if (item.type === 'collection') {
    return collections.value.some(c => c.name.toLowerCase() === name && c.id !== item.id);
  }
  if (item.type === 'folder') {
    const col = collections.value.find(c => findFolderInCollection(c, item.id));
    if (!col) return false;
    const siblings = findSiblingFolders(col, item.id);
    return siblings.some(f => f.name.toLowerCase() === name && f.id !== item.id);
  }
  if (item.type === 'request') {
    if (!item.collectionId) return false;
    return isRequestNameTaken(collections.value, item.collectionId, item.folderId, renameItemName.value.trim(), item.id);
  }
  return false;
});

// Rename
const renameItem = async () => {
  if (!renameItemName.value.trim() || !renamingItem.value || isRenameNameDuplicate.value) return;
  
  const item = renamingItem.value;
  const newName = renameItemName.value.trim();
  
  try {
    if (item.type === 'collection') {
      await collectionsStore.updateCollection(item.id, { name: newName });
    } else if (item.type === 'folder') {
      const collection = collections.value.find(c => 
        findFolderInCollection(c, item.id)
      );
      if (collection) {
        await collectionsStore.updateFolder(collection.id, item.id, { name: newName });
      }
    } else if (item.type === 'request') {
      // 先加载完整的 request 数据
      const fullRequest = await requestsStore.loadRequest(item.id);
      if (!fullRequest) {
        console.error('Request not found:', item.id);
        if (window.$toast) {
          window.$toast.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Request not found',
            life: 3000
          });
        }
        return;
      }
      
      // 检查名称是否重复
      if (fullRequest.collectionId && isRequestNameTaken(collections.value, fullRequest.collectionId, fullRequest.folderId, newName, fullRequest.id)) {
        if (window.$toast) {
          window.$toast.add({
            severity: 'warn',
            summary: 'Duplicate Name',
            detail: 'A request with this name already exists in the same location',
            life: 3000
          });
        }
        return;
      }
      
      // 更新完整的 request 对象
      const updatedRequest = {
        ...fullRequest,
        name: newName,
        updatedAt: new Date().toISOString()
      };
      await requestsStore.saveRequest(updatedRequest);
      
      // 更新 collection 中的引用
      if (fullRequest.collectionId) {
        await collectionsStore.updateRequestReference(
          fullRequest.collectionId,
          fullRequest.id,
          newName,
          fullRequest.method,
          fullRequest.url,
          fullRequest.folderId ?? undefined
        );
      }
    }
    
    showRenameDialog.value = false;
    renamingItem.value = null;
    renameItemName.value = '';
    
    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: 'Renamed successfully',
        life: 3000
      });
    }
  } catch (error) {
    console.error('Failed to rename:', error);
  }
};

defineExpose({ open: openRenameDialog });
</script>

<template>
  <Dialog 
    v-model:visible="showRenameDialog"
    header="Rename"
    :modal="true"
    :style="{ width: '25rem' }"
  >
    <div class="flex flex-col gap-4">
      <div>
        <label class="block text-sm font-medium mb-2">Name</label>
        <InputText 
          v-model="renameItemName"
          placeholder="Enter a new name"
          class="w-full"
          :invalid="isRenameNameDuplicate"
          autofocus
        />
        <small v-if="isRenameNameDuplicate" class="text-red-500">
          This name already exists
        </small>
      </div>
    </div>
  
    <template #footer>
      <Button label="Cancel" severity="secondary" @click="showRenameDialog = false" />
      <Button 
        label="Rename"
        @click="renameItem"
        :disabled="!renameItemName.trim() || renameItemName.trim() === renamingItem?.name || isRenameNameDuplicate"
      />
    </template>
  </Dialog>
</template>
