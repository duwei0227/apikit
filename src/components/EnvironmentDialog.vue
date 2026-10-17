<script setup lang="ts">
import { cloneJson } from '@/utils/clone';
import { ref, computed } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { useEnvironmentsStore } from '@/stores/environments';
import { getRowKey } from '@/utils/stableRows';
import { importExportService, type EnvironmentExportTarget } from '@/services/import-export';
import type { Environment, EnvironmentVariable } from '@/types/models';
import { useKeyValueRows } from '@/composables/useKeyValueRows';
import EnvironmentExportDialog from '@/components/EnvironmentExportDialog.vue';

const confirm = useConfirm();
const environmentsStore = useEnvironmentsStore();
const exportDialog = ref<InstanceType<typeof EnvironmentExportDialog> | null>(null);

const showEnvDialog = ref(false);
const envDialogMode = ref<'list' | 'add' | 'edit'>('list');
const editingEnv = ref<{ id: string; name: string; variables: EnvironmentVariable[] }>({
  id: '',
  name: '',
  variables: [{ key: '', value: '', enabled: true }]
});
const hoveredVariableIndex = ref(-1);

const environments = computed(() =>
  [...environmentsStore.environments].sort((a, b) => a.name.localeCompare(b.name))
);

// 环境管理函数
const openEnvDialog = () => {
  envDialogMode.value = 'list';
  showEnvDialog.value = true;
};

const openAddEnv = () => {
  envDialogMode.value = 'add';
  editingEnv.value = {
    id: '',
    name: '',
    variables: [{ key: '', value: '', enabled: true }]
  };
};

// Method to open create dialog directly (for global shortcut)
const openCreateDialog = () => {
  showEnvDialog.value = true;
  openAddEnv();
};

const openEditEnv = (env: Environment) => {
  envDialogMode.value = 'edit';
  editingEnv.value = cloneJson(env);
  // 确保至少有一个空行
  if (editingEnv.value.variables.length === 0 || 
      editingEnv.value.variables[editingEnv.value.variables.length - 1].key) {
    editingEnv.value.variables.push({ key: '', value: '', enabled: true });
  }
};

const saveEnvironment = async () => {
  if (!editingEnv.value.name.trim()) {
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Environment name is required',
        life: 3000
      });
    }
    return;
  }

  try {
    // 过滤掉空的变量
    const filteredVariables = editingEnv.value.variables.filter(v => v.key.trim());

    if (envDialogMode.value === 'add') {
      const newEnv = await environmentsStore.createEnvironment(editingEnv.value.name.trim());
      if (filteredVariables.length > 0) {
        await environmentsStore.updateEnvironment(newEnv.id, {
          variables: filteredVariables
        });
      }
      
      if (window.$toast) {
        window.$toast.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Environment created successfully',
          life: 2000
        });
      }
    } else if (envDialogMode.value === 'edit') {
      await environmentsStore.updateEnvironment(editingEnv.value.id, {
        name: editingEnv.value.name.trim(),
        variables: filteredVariables
      });
      
      if (window.$toast) {
        window.$toast.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Environment updated successfully',
          life: 2000
        });
      }
    }

    envDialogMode.value = 'list';
  } catch (error) {
    console.error('Failed to save environment:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to save environment',
        life: 3000
      });
    }
  }
};

const cancelEnvEdit = () => {
  envDialogMode.value = 'list';
};

const deleteEnvironment = (envId: string) => {
  const env = environments.value.find(e => e.id === envId);
  if (!env) return;

  confirm.require({
    message: `Are you sure you want to delete environment "${env.name}"?`,
    header: 'Confirm Deletion',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await environmentsStore.deleteEnvironment(envId);

        if (window.$toast) {
          window.$toast.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Environment deleted successfully',
            life: 2000
          });
        }
      } catch (error) {
        console.error('Failed to delete environment:', error);
        if (window.$toast) {
          window.$toast.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to delete environment',
            life: 3000
          });
        }
      }
    }
  });
};

const copyEnvironment = async (env: Environment) => {
  const newName = `${env.name} (Copy)`;

  try {
    // 创建新环境
    const newEnv = await environmentsStore.createEnvironment(newName);

    // 复制变量（过滤掉空行）
    const filteredVariables = env.variables.filter(v => v.key.trim());
    if (filteredVariables.length > 0) {
      await environmentsStore.updateEnvironment(newEnv.id, {
        variables: filteredVariables
      });
    }

    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: `Environment "${newName}" created`,
        life: 2000
      });
    }
  } catch (error) {
    console.error('Failed to copy environment:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to copy environment',
        life: 3000
      });
    }
  }
};

const importEnvironments = async () => {
  try {
    const importedEnvironments = await importExportService.importEnvironments();

    if (!importedEnvironments) {
      return;
    }

    for (const environment of importedEnvironments) {
      const environmentName = environment.name?.trim() || 'Imported Environment';
      const existingEnv = environmentsStore.environments.find(env => env.name === environmentName);

      if (existingEnv) {
        await environmentsStore.updateEnvironment(existingEnv.id, {
          variables: environment.variables || []
        });
        continue;
      }

      const newEnv = await environmentsStore.createEnvironment(environmentName);
      await environmentsStore.updateEnvironment(newEnv.id, {
        variables: environment.variables || []
      });
    }

    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: importedEnvironments.length === 1
          ? 'Environment imported successfully'
          : `${importedEnvironments.length} environments imported successfully`,
        life: 2000
      });
    }
  } catch (error) {
    console.error('Failed to import environments:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to import environments',
        life: 3000
      });
    }
  }
};

// 单环境导出格式选择（popup Menu）
const exportMenu = ref<{ toggle: (event: Event) => void } | null>(null);
const menuTargetEnv = ref<Environment | null>(null);
const exportMenuItems = computed(() => [
  {
    label: 'Export as ApiKit JSON',
    icon: 'pi pi-download',
    command: () => exportEnvironment(menuTargetEnv.value, 'apikit')
  },
  {
    label: 'Export as Postman',
    icon: 'pi pi-download',
    command: () => exportEnvironment(menuTargetEnv.value, 'postman')
  }
]);

// 打开导出格式选择菜单，记录目标环境
const openExportMenu = (event: MouseEvent, env: Environment) => {
  menuTargetEnv.value = env;
  exportMenu.value?.toggle(event);
};

const exportEnvironment = async (env: Environment | null, format: EnvironmentExportTarget = 'apikit') => {
  if (!env) return;
  try {
    const exported = await importExportService.exportEnvironment(env, format);

    if (exported && window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: 'Environment exported successfully',
        life: 2000
      });
    }
  } catch (error) {
    console.error('Failed to export environment:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to export environment',
        life: 3000
      });
    }
  }
};

const { remove: deleteVariable, onChange: onVariableChange } = useKeyValueRows({
  getRows: () => editingEnv.value.variables,
  createRow: () => ({ key: '', value: '', enabled: true }),
});

const getEnvDialogTitle = () => {
  if (envDialogMode.value === 'list') return 'Manage Environments';
  if (envDialogMode.value === 'add') return 'Add Environment';
  return 'Edit Environment';
};

defineExpose({
  open: openEnvDialog,
  openCreate: openCreateDialog,
});
</script>

<template>
  <!-- Environment Management Dialog -->
  <Dialog 
    v-model:visible="showEnvDialog"
    :header="getEnvDialogTitle()"
    :modal="true"
    :style="{ width: '72vw', maxWidth: '72vw' }"
    :closable="envDialogMode === 'list'"
  >
    <!-- List View -->
    <div v-if="envDialogMode === 'list'" class="flex flex-col gap-4">
      <div class="flex justify-between items-center">
        <span class="text-sm font-medium text-surface-700 dark:text-surface-300">
          Environments
        </span>
        <div class="flex gap-2">
          <Button
            label="Import"
            icon="pi pi-upload"
            size="small"
            severity="secondary"
            @click="importEnvironments"
          />
          <Button
            label="Export..."
            icon="pi pi-download"
            size="small"
            severity="secondary"
            :disabled="environments.length === 0"
            @click="exportDialog?.open()"
          />
          <Button 
            label="Add"
            icon="pi pi-plus"
            size="small"
            @click="openAddEnv"
          />
        </div>
      </div>
      
      <div v-if="environments.length === 0" class="text-center py-8 text-surface-500 dark:text-surface-400 text-sm">
        No environments configured
      </div>
      
      <div v-else class="space-y-2">
        <div 
          v-for="env in environments"
          :key="env.id"
          class="p-3 border border-surface-200 dark:border-surface-700 rounded hover:bg-surface-50 dark:hover:bg-surface-900 cursor-pointer transition flex justify-between items-center"
          @click="openEditEnv(env)"
        >
          <div>
            <div class="text-sm font-medium text-surface-900 dark:text-surface-50">
              {{ env.name }}
            </div>
            <div class="text-xs text-surface-500 dark:text-surface-400 mt-1">
              {{ env.variables.length }} variable(s)
            </div>
          </div>
          <div class="flex gap-1">
            <Button
              icon="pi pi-download"
              text
              rounded
              size="small"
              severity="secondary"
              title="Export"
              @click.stop="openExportMenu($event, env)"
            />
            <Button
              icon="pi pi-copy"
              text
              rounded
              size="small"
              severity="secondary"
              title="Copy"
              @click.stop="copyEnvironment(env)"
            />
            <Button
              icon="pi pi-trash"
              text
              rounded
              size="small"
              severity="danger"
              @click.stop="deleteEnvironment(env.id)"
            />
          </div>
        </div>
      </div>
    </div>
    
    <!-- Add/Edit View -->
    <div v-else class="flex flex-col gap-4">
      <div>
        <label class="block text-sm font-medium mb-2">Environment Name</label>
        <InputText 
          v-model="editingEnv.name"
          placeholder="Enter environment name"
          class="w-full"
        />
      </div>
      
      <div>
        <label class="block text-sm font-medium mb-3">Variables</label>
        
        <!-- Table Header -->
        <div class="flex gap-2 mb-2 text-sm font-bold text-surface-700 dark:text-surface-300 px-2 pr-3">
          <div class="flex-1">VARIABLE</div>
          <div class="flex-1">VALUE</div>
          <div style="width: 40px;"></div>
        </div>
        
        <!-- Table Rows -->
        <div class="space-y-2 max-h-[60vh] overflow-y-auto pr-3">
          <div 
            v-for="(variable, index) in editingEnv.variables"
            :key="getRowKey(variable)"
            class="flex gap-2 items-center"
            @mouseenter="hoveredVariableIndex = index"
            @mouseleave="hoveredVariableIndex = -1"
          >
            <div class="flex-1">
              <InputText
                v-model="variable.key"
                placeholder="Variable"
                class="w-full py-3"
                @input="onVariableChange"
              />
            </div>
            <div class="flex-1">
              <InputText
                v-model="variable.value"
                placeholder="Value"
                class="w-full py-3"
                @input="onVariableChange"
              />
            </div>
            <div class="flex justify-center" style="width: 40px;">
              <Button 
                v-if="(hoveredVariableIndex === index || variable.key || variable.value) && editingEnv.variables.length > 1"
                icon="pi pi-times"
                text
                rounded
                size="small"
                severity="danger"
                @click="deleteVariable(index)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <template #footer>
      <div v-if="envDialogMode === 'list'">
        <Button label="Close" @click="showEnvDialog = false" />
      </div>
      <div v-else class="flex gap-2">
        <Button label="Cancel" severity="secondary" @click="cancelEnvEdit" />
        <Button 
          label="Save"
          @click="saveEnvironment"
          :disabled="!editingEnv.name.trim()"
        />
      </div>
    </template>
  </Dialog>

  <!-- Export format selection menu (single environment) -->
  <Menu ref="exportMenu" :model="exportMenuItems" :popup="true" />

<EnvironmentExportDialog ref="exportDialog" />
</template>
