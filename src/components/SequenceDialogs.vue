<script setup lang="ts">
import { dialogStyle } from '@/utils/dialogSize';
import { ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { useSequencesStore, type Sequence } from '@/stores/sequences';

const confirm = useConfirm();
const sequencesStore = useSequencesStore();

const showSequenceDialog = ref(false);
const editingSequence = ref<Pick<Sequence, 'name' | 'currentValue' | 'step' | 'padding'> | null>(null);
const showSequenceEditDialog = ref(false);

// 序列管理函数
const openSequenceDialog = () => {
  showSequenceDialog.value = true;
};

const openEditSequence = (sequence: Sequence) => {
  editingSequence.value = {
    name: sequence.name,
    currentValue: sequence.currentValue,
    step: sequence.step,
    padding: sequence.padding
  };
  showSequenceEditDialog.value = true;
};

const saveSequence = async () => {
  if (!editingSequence.value) return;
  
  try {
    const updates = {
      currentValue: editingSequence.value.currentValue,
      step: editingSequence.value.step,
      padding: editingSequence.value.padding
    };
    
    await sequencesStore.updateSequence(editingSequence.value.name, updates);
    
    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: 'Sequence updated successfully',
        life: 2000
      });
    }
    
    showSequenceEditDialog.value = false;
    editingSequence.value = null;
  } catch (error) {
    console.error('[EnvironmentManager] Failed to update sequence:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to update sequence',
        life: 3000
      });
    }
  }
};

const deleteSequence = (sequenceName: string) => {
  confirm.require({
    message: `Are you sure you want to delete sequence "${sequenceName}"?`,
    header: 'Confirm Deletion',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await sequencesStore.deleteSequence(sequenceName);
        
        if (window.$toast) {
          window.$toast.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Sequence deleted successfully',
            life: 2000
          });
        }
      } catch (error) {
        console.error('Failed to delete sequence:', error);
        if (window.$toast) {
          window.$toast.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to delete sequence',
            life: 3000
          });
        }
      }
    }
  });
};

/** 编辑指定序列；序列还没创建（请求未发送过）时用默认值编辑 */
const editSequenceByName = (sequenceName: string) => {
  let sequence = sequencesStore.getAllSequences().find(s => s.name === sequenceName);
  
  // 如果序列不存在（未初始化），创建一个临时的序列对象用于编辑
  if (!sequence) {
    sequence = {
      name: sequenceName,
      currentValue: 1,
      startValue: 1,
      step: 1,
      padding: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
  
  openEditSequence(sequence);
};

defineExpose({
  open: openSequenceDialog,
  editSequence: editSequenceByName,
});
</script>

<template>
  <!-- Sequence Management Dialog -->
  <Dialog 
    v-model:visible="showSequenceDialog"
    header="Manage Sequences"
    :modal="true"
    :style="dialogStyle('xl')"
  >
    <div class="flex flex-col gap-4">
      <div v-if="sequencesStore.getAllSequences().length === 0" class="text-center py-8 text-surface-500 dark:text-surface-400 text-sm">
        No sequences created yet. Sequences will be created automatically when you use <code v-pre>{{$sequence}}</code> in your requests.
      </div>
      
      <div v-else class="space-y-2">
        <div 
          v-for="sequence in sequencesStore.getAllSequences()"
          :key="sequence.name"
          class="p-4 border border-surface-200 dark:border-surface-700 rounded hover:bg-surface-50 dark:hover:bg-surface-900 transition"
        >
          <div class="flex justify-between items-start">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-sm font-semibold text-surface-900 dark:text-surface-50">
                  {{ sequence.name }}
                </span>
                <span class="text-xs px-2 py-1 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
                  Current: {{ sequence.padding > 0 ? sequence.currentValue.toString().padStart(sequence.padding, '0') : sequence.currentValue }}
                </span>
              </div>
              <div class="grid grid-cols-3 gap-2 text-xs text-surface-600 dark:text-surface-400">
                <div>Start: {{ sequence.startValue }}</div>
                <div>Step: {{ sequence.step }}</div>
                <div>Padding: {{ sequence.padding || 'None' }}</div>
              </div>
            </div>
            <div class="flex gap-1">
              <Button 
                icon="pi pi-pencil"
                text
                rounded
                size="small"
                severity="secondary"
                @click="openEditSequence(sequence)"
              />
              <Button 
                icon="pi pi-trash"
                text
                rounded
                size="small"
                severity="danger"
                @click="deleteSequence(sequence.name)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <template #footer>
      <Button label="Close" @click="showSequenceDialog = false" />
    </template>
  </Dialog>
  
  <!-- Sequence Edit Dialog -->
  <Dialog 
    v-model:visible="showSequenceEditDialog"
    header="Edit Sequence"
    :modal="true"
    :style="dialogStyle('sm')"
  >
    <div v-if="editingSequence" class="flex flex-col gap-4">
      <div>
        <label class="block text-sm font-medium mb-2">Sequence Name</label>
        <InputText 
          :modelValue="editingSequence.name"
          disabled
          class="w-full"
        />
      </div>
      
      <div>
        <label class="block text-sm font-medium mb-2">Current Value</label>
        <InputNumber 
          v-model="editingSequence.currentValue"
          class="w-full"
          :min="0"
        />
      </div>
      
      <div>
        <label class="block text-sm font-medium mb-2">Step (Increment)</label>
        <InputNumber 
          v-model="editingSequence.step"
          class="w-full"
          :min="1"
        />
      </div>
      
      <div>
        <label class="block text-sm font-medium mb-2">Padding (Zero Fill)</label>
        <InputNumber 
          v-model="editingSequence.padding"
          class="w-full"
          :min="0"
          :max="10"
        />
        <small class="text-surface-500 dark:text-surface-400">
          Number of digits (0 = no padding)
        </small>
      </div>
    </div>
    
    <template #footer>
      <div class="flex gap-2">
        <Button label="Cancel" severity="secondary" @click="showSequenceEditDialog = false" />
        <Button label="Save" @click="saveSequence" />
      </div>
    </template>
  </Dialog>
</template>
