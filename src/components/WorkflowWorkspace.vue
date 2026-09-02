<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useCollectionsStore } from '@/stores/collections';
import { useEnvironmentsStore } from '@/stores/environments';
import { useRequestsStore } from '@/stores/requests';
import { useWorkflowsStore } from '@/stores/workflows';
import type { WorkflowDefinition, WorkflowRequestOverrides, WorkflowStep } from '@/types/models';
import { createWorkflowControlStep, createWorkflowRequestStep } from '@/stores/workflows';
import WorkflowStepList from './WorkflowStepList.vue';
import WorkflowLogDialog from './WorkflowLogDialog.vue';
import WorkflowRequestOverrideDialog from './WorkflowRequestOverrideDialog.vue';

const props = defineProps<{
  environmentManager?: any;
  isActive: boolean;
  workflowId?: string;
}>();

const emit = defineEmits(['add-console-log', 'unsaved-change', 'open-workflow', 'open-request']);

const workflowsStore = useWorkflowsStore();
const collectionsStore = useCollectionsStore();
const environmentsStore = useEnvironmentsStore();
const requestsStore = useRequestsStore();
const localWorkflow = ref<WorkflowDefinition | null>(null);
const showLogDialog = ref(false);
const customizingReferenceStep = ref<WorkflowStep | null>(null);
const elapsedSeconds = ref(0);
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

const workflowOptions = computed(() => workflowsStore.workflows.map(item => ({
  label: workflowsStore.getWorkflowDraft(item.id)?.name || item.name,
  value: item.id,
})));

const isCurrentWorkflowRunning = computed(() => {
  return workflowsStore.isRunning && workflowsStore.runningWorkflowId === props.workflowId;
});

const workflowLogCount = computed(() => {
  return props.workflowId ? workflowsStore.getWorkflowLogs(props.workflowId).length : 0;
});

const selectedWorkflowId = computed({
  get: () => props.workflowId || '',
  set: (value: string) => {
    if (value) emit('open-workflow', { workflowId: value });
  }
});

const requestOptions = computed(() => {
  const options: { label: string; value: string }[] = [];
  const seen = new Set<string>();

  const collectRefs = (requests: any[] = [], prefix: string = '') => {
    requests.forEach(request => {
      if (seen.has(request.id)) return;
      seen.add(request.id);
      options.push({
        label: `${prefix}${request.name} [${request.method}]`,
        value: request.id,
      });
    });
  };

  const collectFolders = (folders: any[] = [], prefix: string = '') => {
    folders.forEach(folder => {
      collectRefs(folder.requests || [], `${prefix}${folder.name}/`);
      collectFolders(folder.folders || [], `${prefix}${folder.name}/`);
    });
  };

  collectionsStore.collections.forEach(collection => {
    collectRefs(collection.requests || [], `${collection.name}/`);
    collectFolders(collection.folders || [], `${collection.name}/`);
  });

  return options;
});

const responseStepOptions = computed(() => {
  const options: { label: string; value: string }[] = [];
  const walk = (steps: any[] = [], prefix: string = '') => {
    steps.forEach((step, index) => {
      const label = `${prefix}${index + 1}. ${step.name || 'Untitled Step'}`;
      if (step.type === 'request') {
        options.push({ label, value: step.id });
      }
      if (step.thenSteps?.length) walk(step.thenSteps, `${label} / Then / `);
      if (step.elseSteps?.length) walk(step.elseSteps, `${label} / Else / `);
      if (step.childSteps?.length) walk(step.childSteps, `${label} / Loop / `);
    });
  };
  walk(localWorkflow.value?.steps || []);
  return options;
});

const globalVariableOptions = computed(() => {
  return environmentsStore.globalVariables
    .filter(variable => variable.enabled !== false && variable.key)
    .map(variable => ({
      label: variable.description ? `${variable.key} - ${variable.description}` : variable.key,
      value: variable.key,
    }));
});

const manager = () => {
  let value = props.environmentManager;
  if (value && typeof value === 'object' && 'value' in value) {
    value = value.value;
  }
  return value;
};

const prefetchReferencedRequests = (workflow: WorkflowDefinition | null) => {
  if (!workflow) return;

  const requestIds = new Set<string>();
  const walk = (steps: any[] = []) => {
    steps.forEach(step => {
      if (step.type === 'request' && step.requestSource === 'reference' && step.requestId) {
        requestIds.add(step.requestId);
      }
      walk(step.thenSteps);
      walk(step.elseSteps);
      walk(step.childSteps);
    });
  };
  walk(workflow.steps);

  requestIds.forEach(requestId => {
    requestsStore.loadRequest(requestId).catch(error => {
      console.error(`Failed to prefetch workflow request ${requestId}:`, error);
    });
  });
};

const openSelectedWorkflow = () => {
  if (selectedWorkflowId.value) {
    emit('open-workflow', { workflowId: selectedWorkflowId.value });
  }
};

const loadLocalWorkflow = () => {
  const id = props.workflowId;
  if (!id) {
    localWorkflow.value = null;
    return;
  }

  const draft = workflowsStore.getWorkflowDraft(id);
  const source = draft || workflowsStore.workflows.find(workflow => workflow.id === id);
  customizingReferenceStep.value = null;
  localWorkflow.value = source ? JSON.parse(JSON.stringify(source)) : null;
  prefetchReferencedRequests(localWorkflow.value);
};

const markWorkflowChanged = () => {
  if (!localWorkflow.value) return;
  workflowsStore.setWorkflowDraft(localWorkflow.value);
  emit('unsaved-change', localWorkflow.value.id, true);
};

const saveReferenceOverrides = (overrides: WorkflowRequestOverrides | undefined) => {
  const step = customizingReferenceStep.value;
  if (!step) return;

  if (overrides) {
    step.requestOverrides = JSON.parse(JSON.stringify(overrides));
  } else {
    delete step.requestOverrides;
  }
  markWorkflowChanged();
};

const addReferenceRequest = () => {
  if (!localWorkflow.value) return;
  const step = createWorkflowRequestStep(undefined, 'Existing Request');
  step.requestSource = 'reference';
  localWorkflow.value.steps.push(step);
  markWorkflowChanged();
};

const addInlineRequest = () => {
  if (!localWorkflow.value) return;
  const step = createWorkflowRequestStep(undefined, 'Inline Request');
  step.requestSource = 'inline';
  localWorkflow.value.steps.push(step);
  markWorkflowChanged();
};

const addControlStep = (type: 'if' | 'for' | 'while' | 'doWhile' | 'until') => {
  if (!localWorkflow.value) return;
  localWorkflow.value.steps.push(createWorkflowControlStep(type));
  markWorkflowChanged();
};

const saveWorkflow = async () => {
  if (!localWorkflow.value) return;
  await workflowsStore.saveWorkflow(localWorkflow.value);
  emit('unsaved-change', localWorkflow.value.id, false);
  window.$toast?.add({
    severity: 'success',
    summary: 'Saved',
    detail: 'Workflow saved',
    life: 1800,
  });
};

const saveCurrentWorkflow = async () => {
  await saveWorkflow();
};

const handleKeyDown = (event: KeyboardEvent) => {
  if (!props.isActive) return;

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveWorkflow();
  }
};

const restoreOriginalWorkflow = async () => {
  if (!props.workflowId) return;
  const restored = await workflowsStore.restoreWorkflowDraft(props.workflowId);
  localWorkflow.value = restored;
  emit('unsaved-change', props.workflowId, false);
};

const runWorkflow = async () => {
  if (!localWorkflow.value) return;
  const environmentManager = manager();
  try {
    await workflowsStore.runWorkflow(localWorkflow.value, {
      replaceVariables: value => environmentManager?.replaceVariables ? environmentManager.replaceVariables(value) : value,
      setGlobalVariable: (key, value, enabled, description) => {
        if (environmentManager?.setGlobalVariable) {
          environmentManager.setGlobalVariable(key, value, enabled, description);
        }
      },
      onConsoleLog: log => emit('add-console-log', log),
    });
  } catch (error: any) {
    console.error('Failed to run workflow:', error);
    window.$toast?.add({
      severity: 'error',
      summary: 'Workflow Error',
      detail: error?.message || 'Failed to run workflow',
      life: 3000,
    });
  }
};

onMounted(async () => {
  loadLocalWorkflow();
  window.addEventListener('keydown', handleKeyDown);
});

onBeforeUnmount(() => {
  if (elapsedTimer) clearInterval(elapsedTimer);
  window.removeEventListener('keydown', handleKeyDown);
});

watch(() => props.workflowId, loadLocalWorkflow);
watch(
  () => workflowsStore.workflows.find(workflow => workflow.id === props.workflowId),
  (workflow, previousWorkflow) => {
    if (workflow && workflow !== previousWorkflow) loadLocalWorkflow();
  },
);
watch(() => workflowsStore.isLoading, (isLoading) => {
  if (!isLoading) loadLocalWorkflow();
}, { immediate: true });
watch(isCurrentWorkflowRunning, (isRunning) => {
  if (isRunning) {
    elapsedSeconds.value = workflowsStore.runningStartedAt
      ? Math.floor((Date.now() - workflowsStore.runningStartedAt) / 1000)
      : 0;
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = setInterval(() => {
      elapsedSeconds.value = workflowsStore.runningStartedAt
        ? Math.floor((Date.now() - workflowsStore.runningStartedAt) / 1000)
        : elapsedSeconds.value + 1;
    }, 1000);
  } else if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}, { immediate: true });

defineExpose({
  saveCurrentWorkflow,
  restoreOriginalWorkflow,
  workflow: localWorkflow,
});
</script>

<template>
  <div class="h-full flex flex-col bg-surface-0 dark:bg-surface-950 overflow-hidden">
    <div class="px-4 py-3 border-b border-surface-200 dark:border-surface-700 flex-shrink-0">
      <InputText
        v-if="localWorkflow"
        v-model="localWorkflow.name"
        class="w-full text-lg font-semibold"
        size="small"
        @update:modelValue="markWorkflowChanged"
      />
      <span v-else class="text-sm text-surface-500">No workflow selected</span>
    </div>

    <div class="flex items-center gap-2 px-4 py-3 border-b border-surface-200 dark:border-surface-700 flex-shrink-0">
      <Button label="Existing Request" icon="pi pi-link" size="small" outlined :disabled="!localWorkflow" @click="addReferenceRequest" />
      <Button label="Inline Request" icon="pi pi-plus" size="small" outlined :disabled="!localWorkflow" @click="addInlineRequest" />
      <Button label="If" icon="pi pi-code" size="small" outlined :disabled="!localWorkflow" @click="addControlStep('if')" />
      <Button label="For" icon="pi pi-refresh" size="small" outlined :disabled="!localWorkflow" @click="addControlStep('for')" />
      <Button label="While" icon="pi pi-sync" size="small" outlined :disabled="!localWorkflow" @click="addControlStep('while')" />
      <Button label="Do While" icon="pi pi-replay" size="small" outlined :disabled="!localWorkflow" @click="addControlStep('doWhile')" />
      <Button label="Until" icon="pi pi-stop-circle" size="small" outlined :disabled="!localWorkflow" @click="addControlStep('until')" />
      <div class="flex-1"></div>
      <Button icon="pi pi-save" label="Save" size="small" :disabled="!localWorkflow" @click="saveWorkflow" />
      <Button
        v-if="!isCurrentWorkflowRunning"
        icon="pi pi-play"
        label="Run"
        size="small"
        severity="success"
        class="min-w-20"
        aria-label="Run workflow"
        :title="workflowsStore.isRunning ? 'Another workflow is currently running' : 'Run workflow'"
        :disabled="!localWorkflow || workflowsStore.isRunning"
        @click="runWorkflow"
      />
      <Button
        v-else
        icon="pi pi-stop"
        label="Stop"
        size="small"
        severity="danger"
        class="min-w-20"
        aria-label="Stop workflow"
        title="Stop workflow"
        @click="workflowsStore.stopWorkflow"
      />
      <Button
        icon="pi pi-list"
        :label="`Log${workflowLogCount ? ` (${workflowLogCount})` : ''}`"
        size="small"
        severity="secondary"
        outlined
        :disabled="!localWorkflow"
        @click="showLogDialog = true"
      />
    </div>

    <div v-if="localWorkflow" class="relative flex-1 min-h-0 overflow-hidden">
      <div
        v-if="isCurrentWorkflowRunning"
        class="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-surface-0/60 dark:bg-surface-900/60 backdrop-blur-sm"
      >
        <i class="pi pi-spin pi-spinner text-6xl text-primary"></i>
        <span class="text-2xl font-semibold text-surface-900 dark:text-surface-50">Running Workflow...</span>
        <span class="text-sm text-surface-500 dark:text-surface-400 tabular-nums">
          {{ elapsedSeconds }}s elapsed
        </span>
        <Button
          label="Stop"
          icon="pi pi-times"
          severity="danger"
          size="large"
          @click="workflowsStore.stopWorkflow"
        />
      </div>
      <section class="h-full overflow-y-auto overflow-x-hidden p-4 pb-[35vh]">
        <WorkflowStepList
          :steps="localWorkflow.steps"
          :requestOptions="requestOptions"
          :responseStepOptions="responseStepOptions"
          :globalVariableOptions="globalVariableOptions"
          :environmentManager="environmentManager"
          :collections="collectionsStore.collections"
          :showAddButtons="false"
          @changed="markWorkflowChanged"
          @open-request="$emit('open-request', $event)"
          @customize-request="customizingReferenceStep = $event"
          @add-console-log="$emit('add-console-log', $event)"
        />
      </section>
    </div>

    <div v-else class="flex-1 flex items-center justify-center">
      <span class="text-sm text-surface-500">Select or create a workflow from the Workflows panel.</span>
    </div>

    <WorkflowLogDialog
      v-if="localWorkflow"
      v-model:visible="showLogDialog"
      :workflowId="localWorkflow.id"
      :workflowName="localWorkflow.name"
    />

    <WorkflowRequestOverrideDialog
      :visible="Boolean(customizingReferenceStep)"
      :step="customizingReferenceStep"
      :environmentManager="environmentManager"
      @update:visible="value => { if (!value) customizingReferenceStep = null }"
      @save="saveReferenceOverrides"
    />
  </div>
</template>
