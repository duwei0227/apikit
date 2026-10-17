<script setup lang="ts">
import { cloneJson } from '@/utils/clone';
import { ref, computed } from 'vue';
import { useCollectionsStore } from '@/stores/collections';
import type { CollectionTreeNode } from '@/utils/collectionTree';
import type { Collection, Folder } from '@/types/models';

interface LocationNode {
  key: string;
  label: string;
  data: (Collection | Folder) & { type: 'collection' | 'folder' };
  icon: string;
  children: LocationNode[];
}

const collectionsStore = useCollectionsStore();
const collections = computed(() => collectionsStore.collections);

const showMoveDialog = ref(false);
const movingRequest = ref<CollectionTreeNode | null>(null);
const moveSelectedKeys = ref<Record<string, boolean>>({});
const moveTargetCollection = ref<Collection | null>(null);
const moveTargetFolder = ref<Folder | null>(null);

/** node 为请求的树节点，key 形如 collection/<cid>/.../request/<rid> */
const openMoveDialog = (node: CollectionTreeNode) => {
  movingRequest.value = cloneJson(node);
  moveSelectedKeys.value = {};
  moveTargetCollection.value = null;
  moveTargetFolder.value = null;
  showMoveDialog.value = true;
};

const moveTreeData = computed(() => {
  const buildNode = (item: Collection | Folder, type: 'collection' | 'folder' = 'collection', parentKey = ''): LocationNode => {
    const key = parentKey ? `${parentKey}/${item.id}` : `${type}/${item.id}`;
    return {
      key, label: item.name, data: { ...item, type },
      icon: type === 'collection' ? 'pi pi-folder' : 'pi pi-folder-open',
      children: (item.folders || []).map(folder => buildNode(folder, 'folder', key))
    };
  };
  return collections.value.map(c => buildNode(c));
});

const onMoveNodeSelect = (node: LocationNode) => {
  if (node.data.type === 'collection') {
    moveTargetCollection.value = node.data as Collection;
    moveTargetFolder.value = null;
  } else if (node.data.type === 'folder') {
    const parts = node.key.split('/');
    const pc = collections.value.find(c => String(c.id) === parts[1]);
    if (pc) { moveTargetCollection.value = pc; moveTargetFolder.value = node.data as Folder; }
  }
  moveSelectedKeys.value = { [node.key]: true };
};

const confirmMoveRequest = async () => {
  const moving = movingRequest.value;
  const target = moveTargetCollection.value;
  if (!moving || !target) return;
  const src = collections.value.find(c => c.id === moving.key.split('/')[1]);
  if (!src) return;
  try {
    await collectionsStore.moveRequest(src.id, moving.data.id, target.id, moveTargetFolder.value?.id);
    showMoveDialog.value = false;
    movingRequest.value = null;
    if (window.$toast) window.$toast.add({ severity: 'success', summary: 'Moved', detail: 'Request moved successfully', life: 2000 });
  } catch (e) { console.error('Failed to move request:', e); }
};

defineExpose({ open: openMoveDialog });
</script>

<template>
  <Dialog 
    v-model:visible="showMoveDialog"
    header="Move Request"
    :modal="true"
    :style="{ width: '25rem' }"
  >
    <div class="flex flex-col gap-3">
      <p class="text-sm text-surface-600 dark:text-surface-400">
        Select target location for "{{ movingRequest?.data?.name }}"
      </p>
      <div class="border border-surface-300 dark:border-surface-600 rounded p-3 max-h-64 overflow-y-auto">
        <Tree
          :value="moveTreeData"
          v-model:selectionKeys="moveSelectedKeys"
          selectionMode="single"
          @node-select="onMoveNodeSelect"
        />
      </div>
      <div v-if="moveTargetCollection" class="text-sm p-2 bg-surface-100 dark:bg-surface-800 rounded">
        <span class="font-medium">Target: </span>
        <span>{{ moveTargetCollection.name }}</span>
        <span v-if="moveTargetFolder"> / {{ moveTargetFolder.name }}</span>
      </div>
    </div>
    <template #footer>
      <Button label="Cancel" severity="secondary" @click="showMoveDialog = false" />
      <Button label="Move" @click="confirmMoveRequest" :disabled="!moveTargetCollection" />
    </template>
  </Dialog>
</template>
