<script setup>
import { computed, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { useWorkflowsStore } from '@/stores/workflows';

const props = defineProps({
  searchQuery: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['open-workflow', 'workflow-deleted']);

const confirm = useConfirm();
const workflowsStore = useWorkflowsStore();

const showCreateDialog = ref(false);
const newWorkflowName = ref('');
const showRenameDialog = ref(false);
const renamingWorkflow = ref(null);
const renameWorkflowName = ref('');

const filteredWorkflows = computed(() => {
  const query = props.searchQuery.trim().toLowerCase();
  if (!query) return workflowsStore.workflows;
  return workflowsStore.workflows.filter(workflow => workflow.name.toLowerCase().includes(query));
});

const isActiveWorkflow = (workflowId) => workflowsStore.activeWorkflowId === workflowId;

const isCreateNameDuplicate = computed(() => {
  const name = newWorkflowName.value.trim().toLowerCase();
  if (!name) return false;
  return workflowsStore.workflows.some(workflow => workflow.name.toLowerCase() === name);
});

const isRenameNameDuplicate = computed(() => {
  if (!renamingWorkflow.value) return false;
  const name = renameWorkflowName.value.trim().toLowerCase();
  if (!name || name === renamingWorkflow.value.name.toLowerCase()) return false;
  return workflowsStore.workflows.some(workflow => workflow.name.toLowerCase() === name && workflow.id !== renamingWorkflow.value.id);
});

const openCreateDialog = () => {
  newWorkflowName.value = '';
  showCreateDialog.value = true;
};

const createWorkflow = async () => {
  if (!newWorkflowName.value.trim() || isCreateNameDuplicate.value) return;
  const workflow = await workflowsStore.createWorkflow(newWorkflowName.value.trim());
  showCreateDialog.value = false;
  emit('open-workflow', { workflowId: workflow.id });
};

const openWorkflow = (workflow) => {
  workflowsStore.activeWorkflowId = workflow.id;
  emit('open-workflow', { workflowId: workflow.id });
};

const openRenameDialog = (workflow) => {
  renamingWorkflow.value = workflow;
  renameWorkflowName.value = workflow.name;
  showRenameDialog.value = true;
};

const renameWorkflow = async () => {
  if (!renamingWorkflow.value || !renameWorkflowName.value.trim() || isRenameNameDuplicate.value) return;
  await workflowsStore.saveWorkflow({
    ...renamingWorkflow.value,
    name: renameWorkflowName.value.trim()
  });
  showRenameDialog.value = false;
  renamingWorkflow.value = null;
  renameWorkflowName.value = '';
};

const deleteWorkflow = (workflow) => {
  confirm.require({
    message: `Are you sure you want to delete "${workflow.name}"?`,
    header: 'Confirm Deletion',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await workflowsStore.deleteWorkflow(workflow.id);
      emit('workflow-deleted', workflow.id);
    }
  });
};
</script>

<template>
  <div class="p-2 bg-surface-0 dark:bg-surface-950">
    <div class="mb-2">
      <Button
        label="New Workflow"
        icon="pi pi-plus"
        size="small"
        class="w-full"
        @click="openCreateDialog"
      />
    </div>

    <div v-if="filteredWorkflows.length === 0" class="text-surface-500 dark:text-surface-400 text-xs text-center py-4">
      {{ searchQuery ? 'No matching workflows found' : 'No workflows yet' }}
    </div>

    <div v-else class="space-y-1">
      <button
        v-for="workflow in filteredWorkflows"
        :key="workflow.id"
        type="button"
        class="workflow-row w-full flex items-center gap-2 border-l-4 px-2 py-2 rounded text-left transition-colors"
        :class="isActiveWorkflow(workflow.id)
          ? 'border-primary-500 bg-primary-100 text-primary-950 shadow-sm hover:bg-primary-100 dark:border-primary-400 dark:bg-primary-900/55 dark:text-primary-50 dark:hover:bg-primary-900/55'
          : 'border-transparent text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-800'"
        @click="openWorkflow(workflow)"
      >
        <i
          class="pi pi-sitemap text-sm"
          :class="isActiveWorkflow(workflow.id) ? 'text-primary-700 dark:text-primary-200' : 'text-surface-500 dark:text-surface-400'"
        ></i>
        <span
          class="flex-1 min-w-0 truncate text-sm"
          :class="{ 'font-semibold': isActiveWorkflow(workflow.id) }"
        >{{ workflow.name }}</span>
        <Button icon="pi pi-pencil" text rounded size="small" severity="secondary" @click.stop="openRenameDialog(workflow)" />
        <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click.stop="deleteWorkflow(workflow)" />
      </button>
    </div>

    <Dialog v-model:visible="showCreateDialog" header="New Workflow" :modal="true" :style="{ width: '25rem' }">
      <div>
        <label class="block text-sm font-medium mb-2">Name</label>
        <InputText v-model="newWorkflowName" class="w-full" placeholder="Enter a name" :invalid="isCreateNameDuplicate" autofocus />
        <small v-if="isCreateNameDuplicate" class="text-red-500">This name already exists</small>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="showCreateDialog = false" />
        <Button label="Create" :disabled="!newWorkflowName.trim() || isCreateNameDuplicate" @click="createWorkflow" />
      </template>
    </Dialog>

    <Dialog v-model:visible="showRenameDialog" header="Rename Workflow" :modal="true" :style="{ width: '25rem' }">
      <div>
        <label class="block text-sm font-medium mb-2">Name</label>
        <InputText v-model="renameWorkflowName" class="w-full" placeholder="Enter a new name" :invalid="isRenameNameDuplicate" autofocus />
        <small v-if="isRenameNameDuplicate" class="text-red-500">This name already exists</small>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="showRenameDialog = false" />
        <Button
          label="Rename"
          :disabled="!renameWorkflowName.trim() || isRenameNameDuplicate || renameWorkflowName.trim() === renamingWorkflow?.name"
          @click="renameWorkflow"
        />
      </template>
    </Dialog>
  </div>
</template>
