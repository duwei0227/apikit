<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useEnvironmentsStore } from '@/stores/environments';
import { useSequencesStore } from '@/stores/sequences';
import EnvironmentDialog from '@/components/EnvironmentDialog.vue';
import SequenceDialogs from '@/components/SequenceDialogs.vue';
import VariablesViewDialog from '@/components/VariablesViewDialog.vue';
import type { Request } from '@/types/models';

withDefaults(defineProps<{ currentRequest?: Request | null }>(), { currentRequest: null });

const environmentsStore = useEnvironmentsStore();
const sequencesStore = useSequencesStore();

const environmentDialog = ref<InstanceType<typeof EnvironmentDialog> | null>(null);
const sequenceDialogs = ref<InstanceType<typeof SequenceDialogs> | null>(null);
const variablesViewDialog = ref<InstanceType<typeof VariablesViewDialog> | null>(null);

// 使用 store 中的数据
const currentEnvironment = computed({
  get: () => environmentsStore.activeEnvironmentId,
  set: (value) => environmentsStore.setActiveEnvironment(value)
});

const environments = computed(() =>
  [...environmentsStore.environments].sort((a, b) => a.name.localeCompare(b.name))
);

const environmentOptions = computed(() => {
  return [
    { label: 'No Environment', value: null },
    ...environments.value.map(env => ({ label: env.name, value: env.id }))
  ];
});

// 加载环境数据
onMounted(async () => {
  await environmentsStore.loadEnvironments();
  await sequencesStore.loadSequences();
});

// Method to open create dialog directly (for global shortcut)
const openCreateDialog = () => {
  environmentDialog.value?.openCreate();
};

// 变量解析在 services/variables/resolver.ts；这里只保留界面需要对外提供的操作
defineExpose({
  openCreateDialog,
});
</script>

<template>
  <div class="environment-manager flex items-center gap-2">
    <Dropdown 
      v-model="currentEnvironment"
      :options="environmentOptions"
      optionLabel="label"
      optionValue="value"
      placeholder="No Environment"
      class="w-48"
      size="small"
    />
    <Button 
      icon="pi pi-cog"
      text
      rounded
      size="small"
      severity="secondary"
      title="Manage Environments"
      @click="environmentDialog?.open()"
    />
    <Button 
      icon="pi pi-eye"
      text
      rounded
      size="small"
      severity="secondary"
      title="View Variables"
      @click="variablesViewDialog?.open()"
    />
    <Button 
      icon="pi pi-sort-numeric-up"
      text
      rounded
      size="small"
      severity="secondary"
      title="Manage Sequences"
      @click="sequenceDialogs?.open()"
    />
    
    <EnvironmentDialog ref="environmentDialog" />
    <SequenceDialogs ref="sequenceDialogs" />
    <VariablesViewDialog
      ref="variablesViewDialog"
      :current-request="currentRequest"
      @edit-sequence="name => sequenceDialogs?.editSequence(name)"
    />
  </div>
</template>

<style scoped>
.environment-manager {
  display: flex;
  align-items: center;
}
</style>
