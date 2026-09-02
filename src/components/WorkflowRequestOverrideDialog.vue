<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRequestsStore } from '@/stores/requests';
import type { Request, WorkflowRequestOverrides, WorkflowStep } from '@/types/models';
import {
  prepareRequestForEditing,
  prepareRequestForPersistence,
} from '@/utils/requestDraft';
import {
  applyWorkflowRequestOverrides,
  buildWorkflowRequestOverrides,
  getWorkflowRequestOverrideSections,
  resetWorkflowRequestOverrideSection,
  workflowRequestOverrideSectionLabels,
  type WorkflowRequestOverrideSection,
} from '@/utils/workflowRequestOverrides';
import WorkflowRequestConfigEditor from './WorkflowRequestConfigEditor.vue';

const props = defineProps<{
  visible: boolean;
  step: WorkflowStep | null;
  environmentManager?: any;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  save: [overrides: WorkflowRequestOverrides | undefined];
}>();

const requestsStore = useRequestsStore();
const baseRequest = ref<Request | null>(null);
const editorDraft = ref<Request | null>(null);
const loading = ref(false);
const loadError = ref('');
let loadSequence = 0;

const overrideSections = computed(() => {
  if (!baseRequest.value || !editorDraft.value) return [];
  return getWorkflowRequestOverrideSections(
    buildWorkflowRequestOverrides(
      baseRequest.value,
      prepareRequestForPersistence(editorDraft.value),
    ),
  );
});

const close = () => emit('update:visible', false);

const initializeEditor = (request: Request) => {
  baseRequest.value = prepareRequestForPersistence(request);
  const effective = applyWorkflowRequestOverrides(baseRequest.value, props.step?.requestOverrides);
  effective.id = `workflow-override-${props.step?.id || 'request'}`;
  editorDraft.value = prepareRequestForEditing(effective);
};

const loadRequest = async () => {
  const sequence = ++loadSequence;
  baseRequest.value = null;
  editorDraft.value = null;
  loadError.value = '';
  loading.value = false;

  if (!props.step?.requestId) {
    loadError.value = 'Select an existing request before customizing it.';
    return;
  }

  const cached = requestsStore.requests.get(props.step.requestId);
  if (cached) {
    initializeEditor(cached);
    loading.value = false;
    return;
  }

  loading.value = true;
  try {
    const request = await requestsStore.loadRequest(props.step.requestId);
    if (sequence !== loadSequence || !props.visible) return;
    if (!request) {
      loadError.value = 'The referenced request could not be loaded.';
      return;
    }
    initializeEditor(request);
  } finally {
    if (sequence === loadSequence) {
      loading.value = false;
    }
  }
};

watch(
  () => props.visible,
  visible => {
    if (visible) {
      loadRequest();
    } else {
      loadSequence++;
    }
  },
);

const replaceDraft = (request: Request) => {
  request.id = `workflow-override-${props.step?.id || 'request'}`;
  editorDraft.value = prepareRequestForEditing(request);
};

const resetSection = (section: WorkflowRequestOverrideSection) => {
  if (!baseRequest.value) return;
  const current = editorDraft.value;
  if (!current) return;
  replaceDraft(resetWorkflowRequestOverrideSection(current, baseRequest.value, section));
};

const resetAll = () => {
  if (!baseRequest.value) return;
  replaceDraft(applyWorkflowRequestOverrides(baseRequest.value));
};

const save = () => {
  if (!baseRequest.value) return;
  const edited = editorDraft.value;
  if (!edited) return;
  emit(
    'save',
    buildWorkflowRequestOverrides(baseRequest.value, prepareRequestForPersistence(edited)),
  );
  close();
};
</script>

<template>
  <Dialog
    :visible="visible"
    header="Customize Existing Request"
    modal
    maximizable
    :style="{ width: '78.2vw', height: '86vh' }"
    contentClass="flex-1 min-h-0 p-0"
    @update:visible="value => { if (!value) close() }"
  >
    <div v-if="loading" class="h-full flex items-center justify-center gap-3 text-surface-500">
      <i class="pi pi-spin pi-spinner text-2xl"></i>
      <span>Preparing request editor...</span>
    </div>

    <div v-else-if="loadError" class="h-full flex items-center justify-center p-6">
      <Message severity="error">{{ loadError }}</Message>
    </div>

    <div v-else-if="editorDraft" class="h-full min-h-0 flex flex-col">
      <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-surface-200 dark:border-surface-700">
        <span class="text-xs text-surface-500">Overrides:</span>
        <span v-if="overrideSections.length === 0" class="text-xs text-surface-400">
          None — all settings are inherited
        </span>
        <Button
          v-for="section in overrideSections"
          :key="section"
          :label="workflowRequestOverrideSectionLabels[section]"
          icon="pi pi-times"
          iconPos="right"
          size="small"
          severity="secondary"
          outlined
          @click="resetSection(section)"
        />
        <div class="flex-1"></div>
        <Button
          label="Reset All"
          icon="pi pi-refresh"
          size="small"
          severity="secondary"
          text
          :disabled="overrideSections.length === 0"
          @click="resetAll"
        />
      </div>

      <div class="flex-1 min-h-0">
        <WorkflowRequestConfigEditor
          :request="editorDraft"
          :environmentManager="environmentManager"
        />
      </div>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="close" />
      <Button
        label="Save Customization"
        icon="pi pi-check"
        :disabled="loading || !editorDraft"
        @click="save"
      />
    </template>
  </Dialog>
</template>
