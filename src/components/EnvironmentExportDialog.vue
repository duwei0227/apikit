<script setup lang="ts">
import { cloneJson } from '@/utils/clone';
import { ref, computed } from 'vue';
import { useEnvironmentsStore } from '@/stores/environments';
import { importExportService, type EnvironmentExportTarget } from '@/services/import-export';

const environmentsStore = useEnvironmentsStore();

const environments = computed(() =>
  [...environmentsStore.environments].sort((a, b) => a.name.localeCompare(b.name))
);

const showEnvExportDialog = ref(false);
const envExportFormat = ref<EnvironmentExportTarget>('apikit');
const envExportSelection = ref<Record<string, boolean>>({});
const isExportingEnvs = ref(false);

const selectedExportEnvs = computed(() => (
  environments.value.filter(env => envExportSelection.value[env.id])
));

const isAllEnvsSelected = computed(() => (
  environments.value.length > 0 && selectedExportEnvs.value.length === environments.value.length
));

const selectedExportVariableCount = computed(() => (
  selectedExportEnvs.value.reduce((total, env) => total + env.variables.filter(variable => variable.key).length, 0)
));

const exportsToFolder = computed(() => envExportFormat.value === 'postman' && selectedExportEnvs.value.length > 1);

const pluralizeCount = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const openEnvExportDialog = () => {
  envExportFormat.value = 'apikit';
  envExportSelection.value = Object.fromEntries(environments.value.map(env => [env.id, true]));
  showEnvExportDialog.value = true;
};

const toggleAllExportEnvs = () => {
  envExportSelection.value = isAllEnvsSelected.value
    ? {}
    : Object.fromEntries(environments.value.map(env => [env.id, true]));
};

const toggleExportEnv = (id: string) => {
  envExportSelection.value = { ...envExportSelection.value, [id]: !envExportSelection.value[id] };
};

const exportSelectedEnvironments = async () => {
  const selected = selectedExportEnvs.value;
  if (selected.length === 0) return;

  isExportingEnvs.value = true;
  try {
    const exported = await importExportService.exportEnvironments(
      cloneJson(selected),
      envExportFormat.value
    );
    if (!exported) return;

    window.$toast?.add({
      severity: 'success',
      summary: 'Success',
      detail: exportsToFolder.value
        ? `Exported ${pluralizeCount(selected.length, 'environment')} as separate Postman files`
        : `Exported ${pluralizeCount(selected.length, 'environment')}`,
      life: 3000
    });
    showEnvExportDialog.value = false;
  } catch (error) {
    console.error('Failed to export environments:', error);
    window.$toast?.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to export environments',
      life: 3000
    });
  } finally {
    isExportingEnvs.value = false;
  }
};

defineExpose({ open: openEnvExportDialog });
</script>

<template>
  <Dialog
    v-model:visible="showEnvExportDialog"
    header="Export Environments"
    :modal="true"
    :style="{ width: '34rem' }"
  >
    <div class="flex flex-col gap-3">
      <div>
        <label class="block text-sm font-medium mb-2">Export Format</label>
        <div class="flex flex-wrap gap-4">
          <label class="flex items-center cursor-pointer">
            <RadioButton v-model="envExportFormat" inputId="env-format-apikit" value="apikit" />
            <span class="ml-2">ApiKit JSON</span>
          </label>
          <label class="flex items-center cursor-pointer">
            <RadioButton v-model="envExportFormat" inputId="env-format-postman" value="postman" />
            <span class="ml-2">Postman</span>
          </label>
        </div>
      </div>

      <div class="flex items-center justify-between gap-3">
        <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            class="h-4 w-4 accent-primary"
            :checked="isAllEnvsSelected"
            :indeterminate="selectedExportEnvs.length > 0 && !isAllEnvsSelected"
            @change="toggleAllExportEnvs"
          />
          <span>Select all</span>
        </label>
        <span class="text-xs text-surface-500 dark:text-surface-400">
          {{ pluralizeCount(selectedExportEnvs.length, 'environment') }} selected
        </span>
      </div>

      <div class="env-export-list">
        <label v-for="env in environments" :key="env.id" class="env-export-row">
          <input
            type="checkbox"
            class="h-4 w-4 accent-primary shrink-0"
            :checked="!!envExportSelection[env.id]"
            @change="toggleExportEnv(env.id)"
          />
          <span class="flex-1 min-w-0 truncate">{{ env.name }}</span>
          <span v-if="env.isActive" class="env-export-active">Active</span>
          <span class="text-xs text-surface-500 dark:text-surface-400 whitespace-nowrap tabular-nums">
            {{ pluralizeCount(env.variables.filter(variable => variable.key).length, 'variable') }}
          </span>
        </label>
      </div>

      <div v-if="exportsToFolder" class="env-export-note warn">
        A Postman environment file holds one environment. You'll choose a folder, and each environment is saved
        as its own file, such as <code>{{ selectedExportEnvs[0].name }}.postman_environment.json</code>.
      </div>
      <div v-else-if="selectedExportEnvs.length > 1" class="env-export-note info">
        The {{ selectedExportEnvs.length }} environments are saved to one file that you can import in one go.
      </div>
    </div>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <span class="text-xs text-surface-500 dark:text-surface-400 tabular-nums">
          {{ pluralizeCount(selectedExportEnvs.length, 'environment') }} · {{ pluralizeCount(selectedExportVariableCount, 'variable') }}
        </span>
        <div class="flex gap-2">
          <Button label="Cancel" severity="secondary" @click="showEnvExportDialog = false" />
          <Button
            :label="exportsToFolder ? 'Choose Folder...' : 'Export'"
            :loading="isExportingEnvs"
            :disabled="isExportingEnvs || selectedExportEnvs.length === 0"
            @click="exportSelectedEnvironments"
          />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.env-export-list {
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.25rem;
  max-height: 20rem;
  overflow: auto;
}

.env-export-row {
  align-items: center;
  cursor: pointer;
  display: flex;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.5rem 0.75rem;
}

.env-export-row + .env-export-row {
  border-top: 1px solid var(--p-content-border-color);
}

.env-export-row:hover {
  background: var(--p-content-hover-background);
}

.env-export-active {
  background: #e0e7ff;
  border-radius: 0.25rem;
  color: #3730a3;
  font-size: 11px;
  padding: 0 0.375rem;
}

.env-export-note {
  border-radius: 0.375rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  padding: 0.5rem 0.75rem;
}

.env-export-note.info {
  background: #eef2f7;
  color: #3c4b5f;
}

.env-export-note.warn {
  background: #fff6e0;
  color: #8a5a00;
}

.p-dark .env-export-active {
  background: #1e1b4b;
  color: #c7d2fe;
}

.p-dark .env-export-note.info {
  background: #1f2733;
  color: #b9c7da;
}

.p-dark .env-export-note.warn {
  background: #3a2c08;
  color: #f5cf73;
}
</style>
