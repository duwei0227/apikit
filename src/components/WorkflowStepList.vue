<script setup lang="ts">
import { computed, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import type { Request, WorkflowStep } from '@/types/models';
import { createWorkflowControlStep, createWorkflowRequestStep } from '@/stores/workflows';
import {
  prepareRequestForEditing,
  prepareRequestForPersistence,
  requestDraftFingerprint,
} from '@/utils/requestDraft';
import { getWorkflowRequestOverrideSections } from '@/utils/workflowRequestOverrides';
import { createDefaultTestConfig, normalizeTestConfig } from '@/utils/requestTests';
import HttpRequest from './HttpRequest.vue';

defineOptions({ name: 'WorkflowStepList' });

const props = withDefaults(defineProps<{
  steps: WorkflowStep[];
  requestOptions: { label: string; value: string }[];
  responseStepOptions?: { label: string; value: string }[];
  globalVariableOptions?: { label: string; value: string }[];
  environmentManager?: any;
  collections?: any[];
  insideLoop?: boolean;
  showAddButtons?: boolean;
  depth?: number;
}>(), {
  collections: () => [],
  insideLoop: false,
  showAddButtons: true,
  depth: 0,
});

const emit = defineEmits(['changed', 'open-request', 'customize-request', 'add-console-log']);

const confirm = useConfirm();
const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
const editingInlineStep = ref<WorkflowStep | null>(null);
const inlineEditorDraft = ref<Request | null>(null);
const inlineEditorBaselineFingerprint = ref('');
const inlineRequestEditorRef = ref<any>(null);
const operators = [
  { label: 'Equals', value: 'equals' },
  { label: 'Not equals', value: 'notEquals' },
  { label: 'Contains', value: 'contains' },
  { label: 'Not contains', value: 'notContains' },
  { label: 'Exists', value: 'exists' },
  { label: 'Not exists', value: 'notExists' },
  { label: 'Greater than', value: 'greaterThan' },
  { label: 'Less than', value: 'lessThan' },
  { label: 'Greater/equal', value: 'greaterThanOrEquals' },
  { label: 'Less/equal', value: 'lessThanOrEquals' },
];
const numericOperators = operators.filter(option => [
  'equals',
  'notEquals',
  'greaterThan',
  'lessThan',
  'greaterThanOrEquals',
  'lessThanOrEquals'
].includes(option.value));
const textOperators = operators.filter(option => [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'exists',
  'notExists'
].includes(option.value));
const existsOperators = operators.filter(option => ['exists', 'notExists'].includes(option.value));
const baseConditionSources = [
  { label: 'Last response', value: 'lastResponse' },
  { label: 'Step response', value: 'stepResponse' },
  { label: 'Global variable', value: 'globalVariable' },
];
const conditionSources = () => props.insideLoop
  ? [...baseConditionSources, { label: 'Loop iteration', value: 'loopIndex' }]
  : baseConditionSources;
const conditionFields = [
  { label: 'Status', value: 'status' },
  { label: 'JSON path', value: 'jsonPath' },
  { label: 'Header', value: 'header' },
  { label: 'Body', value: 'body' },
  { label: 'Value', value: 'value' },
];
const responseConditionFields = conditionFields.filter(option => ['status', 'jsonPath', 'header', 'body'].includes(option.value));

const notify = () => emit('changed');

const conditionFieldOptions = (step: WorkflowStep) => {
  if (!step.condition) return responseConditionFields;
  if (step.condition.source === 'globalVariable' || step.condition.source === 'loopIndex') {
    return conditionFields.filter(option => option.value === 'value');
  }
  return responseConditionFields;
};

const conditionOperatorOptions = (step: WorkflowStep) => {
  if (!step.condition) return operators;
  if (step.condition.source === 'loopIndex' || step.condition.field === 'status') return numericOperators;
  if (step.condition.source === 'globalVariable') return operators;
  if (step.condition.operator === 'exists' || step.condition.operator === 'notExists') return existsOperators;
  return textOperators;
};

const showStepResponseSelector = (step: WorkflowStep) => {
  return step.condition?.source === 'stepResponse';
};

const showGlobalVariableSelector = (step: WorkflowStep) => {
  return step.condition?.source === 'globalVariable';
};

const showConditionField = (step: WorkflowStep) => {
  return step.condition?.source === 'lastResponse' || step.condition?.source === 'stepResponse';
};

const showConditionPath = (step: WorkflowStep) => {
  if (!step.condition) return false;
  return step.condition.field === 'jsonPath' || step.condition.field === 'header';
};

const conditionPathPlaceholder = (step: WorkflowStep) => {
  if (!step.condition) return '';
  if (step.condition.source === 'globalVariable') return 'variable name';
  if (step.condition.field === 'jsonPath') return '$.data.id';
  if (step.condition.field === 'header') return 'content-type';
  return '';
};

const normalizeConditionOperator = (step: WorkflowStep) => {
  if (!step.condition) return;
  const validOperators = conditionOperatorOptions(step).map(option => option.value);
  if (!validOperators.includes(step.condition.operator)) {
    step.condition.operator = validOperators[0] || 'equals';
  }
};

const onConditionSourceChange = (step: WorkflowStep) => {
  if (!step.condition) return;
  const validSources = conditionSources().map(option => option.value);
  if (!validSources.includes(step.condition.source)) {
    step.condition.source = 'lastResponse';
  }
  if (step.condition.source === 'loopIndex') {
    step.condition.field = 'value';
    step.condition.path = '';
    step.condition.stepId = '';
    step.condition.operator = 'equals';
    step.condition.expectedValue = step.condition.expectedValue || '0';
  } else if (step.condition.source === 'globalVariable') {
    step.condition.field = 'value';
    step.condition.stepId = '';
    step.condition.path = step.condition.path || props.globalVariableOptions?.[0]?.value || '';
    step.condition.operator = 'equals';
  } else {
    step.condition.field = 'status';
    step.condition.path = '';
    step.condition.stepId = step.condition.source === 'stepResponse'
      ? step.condition.stepId || props.responseStepOptions?.[0]?.value || ''
      : '';
    step.condition.operator = 'equals';
    step.condition.expectedValue = step.condition.expectedValue || '200';
  }
  normalizeConditionOperator(step);
  notify();
};

const onConditionFieldChange = (step: WorkflowStep) => {
  if (!step.condition) return;
  if (step.condition.field === 'status') {
    step.condition.path = '';
    step.condition.expectedValue = step.condition.expectedValue || '200';
  } else if (step.condition.field === 'body') {
    step.condition.path = '';
  }
  normalizeConditionOperator(step);
  notify();
};

const requestExists = (requestId?: string) => {
  if (!requestId) return true;
  return props.requestOptions.some(option => option.value === requestId);
};

const openReferencedRequest = (requestId?: string) => {
  if (!requestId || !requestExists(requestId)) return;
  emit('open-request', requestId);
};

const referenceOverrideCount = (step: WorkflowStep) => {
  return getWorkflowRequestOverrideSections(step.requestOverrides).length;
};

const setReferencedRequest = (step: WorkflowStep, requestId: string) => {
  step.requestId = requestId;
  delete step.requestOverrides;
  notify();
};

const changeReferencedRequest = (step: WorkflowStep, requestId: string) => {
  if (requestId === step.requestId) return;
  if (referenceOverrideCount(step) === 0) {
    setReferencedRequest(step, requestId);
    return;
  }

  confirm.require({
    header: 'Change referenced request?',
    message: 'Changing the request will remove this step’s customizations.',
    icon: 'pi pi-exclamation-triangle',
    rejectProps: {
      label: 'Cancel',
      severity: 'secondary',
      text: true,
    },
    acceptProps: {
      label: 'Change Request',
      severity: 'danger',
    },
    accept: () => setReferencedRequest(step, requestId),
  });
};

const openInlineEditor = (step: WorkflowStep) => {
  const source = step.inlineRequest
    || createWorkflowRequestStep(undefined, step.name).inlineRequest;
  if (!source) return;

  inlineEditorBaselineFingerprint.value = requestDraftFingerprint(source);
  inlineEditorDraft.value = prepareRequestForEditing(source);
  editingInlineStep.value = step;
};

const updateInlineRequest = (request: Request) => {
  if (!editingInlineStep.value) return;
  inlineEditorDraft.value = JSON.parse(JSON.stringify(request));
};

const currentInlineRequest = () => {
  return inlineRequestEditorRef.value?.getCurrentRequest?.() || inlineEditorDraft.value;
};

const hasInlineEditorChanges = computed(() => {
  if (!editingInlineStep.value || !inlineEditorDraft.value) return false;
  return requestDraftFingerprint(inlineEditorDraft.value)
    !== inlineEditorBaselineFingerprint.value;
});

const closeInlineEditor = () => {
  editingInlineStep.value = null;
  inlineEditorDraft.value = null;
  inlineEditorBaselineFingerprint.value = '';
  inlineRequestEditorRef.value = null;
};

const requestCloseInlineEditor = () => {
  if (!editingInlineStep.value) return;
  const current = currentInlineRequest();
  const hasChanges = current
    ? requestDraftFingerprint(current) !== inlineEditorBaselineFingerprint.value
    : false;

  if (!hasChanges) {
    closeInlineEditor();
    return;
  }

  confirm.require({
    header: 'Discard inline request changes?',
    message: 'Your unapplied inline request changes will be lost.',
    icon: 'pi pi-exclamation-triangle',
    rejectProps: {
      label: 'Keep Editing',
      severity: 'secondary',
      text: true,
    },
    acceptProps: {
      label: 'Discard Changes',
      severity: 'danger',
    },
    accept: closeInlineEditor,
  });
};

const applyInlineRequestChanges = () => {
  const step = editingInlineStep.value;
  const current = currentInlineRequest();
  if (!step || !current) return;

  const normalized = prepareRequestForPersistence(current);
  if (requestDraftFingerprint(normalized) !== inlineEditorBaselineFingerprint.value) {
    step.inlineRequest = normalized;
    notify();
    window.$toast?.add({
      severity: 'success',
      summary: 'Changes Applied',
      detail: 'Inline request updated. Save the workflow to commit the changes.',
      life: 2500,
    });
  }
  closeInlineEditor();
};

const addReferenceRequest = () => {
  props.steps.push(createWorkflowRequestStep(undefined, 'Existing Request'));
  props.steps[props.steps.length - 1].requestSource = 'reference';
  notify();
};

const addInlineRequest = () => {
  props.steps.push(createWorkflowRequestStep(undefined, 'Inline Request'));
  const step = props.steps[props.steps.length - 1];
  step.requestSource = 'inline';
  notify();
};

const addControl = (type: 'if' | 'for' | 'while' | 'doWhile' | 'until') => {
  props.steps.push(createWorkflowControlStep(type));
  notify();
};

const stepTypeLabel = (type: WorkflowStep['type']) => {
  const labels: Record<WorkflowStep['type'], string> = {
    request: 'Request',
    if: 'If',
    for: 'For',
    while: 'While',
    doWhile: 'Do While',
    until: 'Until',
  };
  return labels[type];
};

const isConditionStep = (step: WorkflowStep) => {
  return step.type === 'if' || step.type === 'while' || step.type === 'doWhile' || step.type === 'until';
};

const nestedSteps = (step: WorkflowStep, branch: 'then' | 'else' | 'child') => {
  if (branch === 'then') {
    if (!Array.isArray(step.thenSteps)) step.thenSteps = [];
    return step.thenSteps;
  }
  if (branch === 'else') {
    if (!Array.isArray(step.elseSteps)) step.elseSteps = [];
    return step.elseSteps;
  }
  if (!Array.isArray(step.childSteps)) step.childSteps = [];
  return step.childSteps;
};

const removeStep = (index: number) => {
  props.steps.splice(index, 1);
  notify();
};

const moveStep = (index: number, offset: number) => {
  const target = index + offset;
  if (target < 0 || target >= props.steps.length) return;
  const [step] = props.steps.splice(index, 1);
  props.steps.splice(target, 0, step);
  notify();
};

const toggleCollapsed = (step: WorkflowStep) => {
  step.collapsed = !step.collapsed;
  notify();
};

const ensureInlineRequest = (step: WorkflowStep) => {
  if (!step.inlineRequest) {
    const next = createWorkflowRequestStep(undefined, step.name);
    step.inlineRequest = next.inlineRequest;
  }
  notify();
};

const requestTests = (request: Request) => {
  const source = request.testsConfig || request.tests || createDefaultTestConfig();
  const normalized = normalizeTestConfig(source);
  if (!request.testsConfig || JSON.stringify(request.testsConfig) !== JSON.stringify(normalized)) {
    request.testsConfig = normalized;
  }
  return request.testsConfig;
};
</script>

<template>
  <div class="space-y-3">
    <div v-if="showAddButtons !== false" class="flex flex-wrap gap-2">
      <Button label="Existing Request" icon="pi pi-link" size="small" outlined @click="addReferenceRequest" />
      <Button label="Inline Request" icon="pi pi-plus" size="small" outlined @click="addInlineRequest" />
      <Button label="If" icon="pi pi-code" size="small" outlined @click="addControl('if')" />
      <Button label="For" icon="pi pi-refresh" size="small" outlined @click="addControl('for')" />
      <Button label="While" icon="pi pi-sync" size="small" outlined @click="addControl('while')" />
      <Button label="Do While" icon="pi pi-replay" size="small" outlined @click="addControl('doWhile')" />
      <Button label="Until" icon="pi pi-stop-circle" size="small" outlined @click="addControl('until')" />
    </div>

    <div v-if="steps.length === 0" class="border border-dashed border-surface-300 dark:border-surface-700 rounded p-6 text-center text-sm text-surface-500">
      No steps yet
    </div>

    <div
      v-for="(step, index) in steps"
      :key="step.id"
      class="border border-surface-200 dark:border-surface-700 rounded bg-surface-0 dark:bg-surface-900"
    >
      <div class="flex items-center gap-2 p-3 border-b border-surface-100 dark:border-surface-800">
        <Button
          :icon="step.collapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
          text
          rounded
          size="small"
          severity="secondary"
          :title="step.collapsed ? 'Expand' : 'Collapse'"
          @click="toggleCollapsed(step)"
        />
        <Checkbox v-model="step.enabled" :binary="true" @update:modelValue="notify" />
        <Badge :value="stepTypeLabel(step.type)" severity="info" />
        <InputText v-model="step.name" size="small" class="flex-1 min-w-0" @update:modelValue="notify" />
        <Button icon="pi pi-arrow-up" text rounded size="small" :disabled="index === 0" @click="moveStep(index, -1)" />
        <Button icon="pi pi-arrow-down" text rounded size="small" :disabled="index === steps.length - 1" @click="moveStep(index, 1)" />
        <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="removeStep(index)" />
      </div>

      <div v-if="!step.collapsed" class="p-3 space-y-3">
        <template v-if="step.type === 'request'">
          <div class="flex flex-wrap items-center gap-2">
            <Dropdown
              v-model="step.requestSource"
              :options="[
                { label: 'Existing request', value: 'reference' },
                { label: 'Inline request', value: 'inline' }
              ]"
              optionLabel="label"
              optionValue="value"
              size="small"
              @update:modelValue="value => { step.requestSource = value; step.requestSource === 'inline' ? ensureInlineRequest(step) : notify() }"
            />
            <Dropdown
              v-if="step.requestSource === 'reference'"
              :modelValue="step.requestId"
              :options="requestOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="Select request"
              filter
              size="small"
              class="min-w-72"
              @update:modelValue="value => changeReferencedRequest(step, value)"
            />
            <Button
              v-if="step.requestSource === 'reference'"
              icon="pi pi-external-link"
              text
              rounded
              size="small"
              severity="secondary"
              title="Open request"
              :disabled="!step.requestId || !requestExists(step.requestId)"
              @click="openReferencedRequest(step.requestId)"
            />
            <Message
              v-if="step.requestSource === 'reference' && step.requestId && !requestExists(step.requestId)"
              severity="warn"
              size="small"
              class="m-0"
            >
              Referenced request was removed from Collections.
            </Message>
          </div>

          <div
            v-if="step.requestSource === 'reference' && step.requestId && requestExists(step.requestId)"
            class="flex flex-wrap items-center gap-2 rounded border border-surface-200 dark:border-surface-700 p-3"
          >
            <Badge
              v-if="referenceOverrideCount(step)"
              :value="`Customized (${referenceOverrideCount(step)})`"
              severity="warn"
            />
            <span v-else class="text-sm text-surface-500 flex-1">
              All request settings are inherited.
            </span>
            <div v-if="referenceOverrideCount(step)" class="flex-1 text-sm text-surface-500">
              Unchanged settings continue to inherit from the referenced request.
            </div>
            <Button
              label="Customize Request"
              icon="pi pi-sliders-h"
              size="small"
              outlined
              @click="$emit('customize-request', step)"
            />
          </div>

          <div v-if="step.requestSource === 'inline' && step.inlineRequest" class="flex flex-wrap items-center gap-2 rounded border border-surface-200 dark:border-surface-700 p-3">
            <Badge :value="step.inlineRequest.method || 'GET'" severity="success" />
            <span class="min-w-0 flex-1 truncate text-sm text-surface-700 dark:text-surface-200">
              {{ step.inlineRequest.url || 'No URL configured' }}
            </span>
            <Button
              label="Edit Inline Request"
              icon="pi pi-pencil"
              size="small"
              outlined
              @click="openInlineEditor(step)"
            />
          </div>
        </template>

        <template v-else-if="isConditionStep(step) && step.condition">
          <div class="grid grid-cols-1 xl:grid-cols-6 gap-2">
            <Dropdown
              v-model="step.condition.source"
              :options="conditionSources()"
              optionLabel="label"
              optionValue="value"
              size="small"
              @update:modelValue="value => { step.condition.source = value; onConditionSourceChange(step) }"
            />
            <Dropdown
              v-if="showStepResponseSelector(step)"
              v-model="step.condition.stepId"
              :options="responseStepOptions || []"
              optionLabel="label"
              optionValue="value"
              placeholder="Select request step"
              filter
              size="small"
              @update:modelValue="notify"
            />
            <Dropdown
              v-if="showGlobalVariableSelector(step)"
              v-model="step.condition.path"
              :options="globalVariableOptions || []"
              optionLabel="label"
              optionValue="value"
              placeholder="Select global variable"
              filter
              size="small"
              @update:modelValue="notify"
            />
            <Dropdown
              v-if="showConditionField(step)"
              v-model="step.condition.field"
              :options="conditionFieldOptions(step)"
              optionLabel="label"
              optionValue="value"
              size="small"
              @update:modelValue="value => { step.condition.field = value; onConditionFieldChange(step) }"
            />
            <InputText
              v-if="showConditionPath(step)"
              v-model="step.condition.path"
              :placeholder="conditionPathPlaceholder(step)"
              size="small"
              @update:modelValue="notify"
            />
            <Dropdown
              v-model="step.condition.operator"
              :options="conditionOperatorOptions(step)"
              optionLabel="label"
              optionValue="value"
              size="small"
              @update:modelValue="notify"
            />
            <InputText
              v-if="step.condition.operator !== 'exists' && step.condition.operator !== 'notExists'"
              v-model="step.condition.expectedValue"
              placeholder="expected"
              size="small"
              @update:modelValue="notify"
            />
          </div>
          <div v-if="step.type === 'while' || step.type === 'doWhile' || step.type === 'until'" class="flex items-center gap-2">
            <span class="text-sm text-surface-500">Max iterations</span>
            <InputNumber v-model="step.maxIterations" :min="1" :max="100" size="small" showButtons @update:modelValue="notify" />
          </div>

          <template v-if="step.type === 'if'">
            <div class="grid grid-cols-1 2xl:grid-cols-2 gap-3">
              <div class="border border-surface-200 dark:border-surface-700 rounded p-3">
                <div class="text-sm font-medium mb-2">Then</div>
                <WorkflowStepList :steps="nestedSteps(step, 'then')" :requestOptions="requestOptions" :responseStepOptions="responseStepOptions || []" :globalVariableOptions="globalVariableOptions || []" :environmentManager="environmentManager" :collections="collections" :insideLoop="insideLoop" :depth="(depth || 0) + 1" @changed="notify" @open-request="$emit('open-request', $event)" @customize-request="$emit('customize-request', $event)" @add-console-log="$emit('add-console-log', $event)" />
              </div>
              <div class="border border-surface-200 dark:border-surface-700 rounded p-3">
                <div class="text-sm font-medium mb-2">Else</div>
                <WorkflowStepList :steps="nestedSteps(step, 'else')" :requestOptions="requestOptions" :responseStepOptions="responseStepOptions || []" :globalVariableOptions="globalVariableOptions || []" :environmentManager="environmentManager" :collections="collections" :insideLoop="insideLoop" :depth="(depth || 0) + 1" @changed="notify" @open-request="$emit('open-request', $event)" @customize-request="$emit('customize-request', $event)" @add-console-log="$emit('add-console-log', $event)" />
              </div>
            </div>
          </template>
          <template v-else>
            <WorkflowStepList :steps="nestedSteps(step, 'child')" :requestOptions="requestOptions" :responseStepOptions="responseStepOptions || []" :globalVariableOptions="globalVariableOptions || []" :environmentManager="environmentManager" :collections="collections" :insideLoop="true" :depth="(depth || 0) + 1" @changed="notify" @open-request="$emit('open-request', $event)" @customize-request="$emit('customize-request', $event)" @add-console-log="$emit('add-console-log', $event)" />
          </template>
        </template>

        <template v-else-if="step.type === 'for'">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm text-surface-500">Iterations</span>
            <InputNumber v-model="step.iterations" :min="0" :max="100" size="small" showButtons @update:modelValue="notify" />
            <span class="text-sm text-surface-500">Max</span>
            <InputNumber v-model="step.maxIterations" :min="1" :max="100" size="small" showButtons @update:modelValue="notify" />
          </div>
          <WorkflowStepList :steps="nestedSteps(step, 'child')" :requestOptions="requestOptions" :responseStepOptions="responseStepOptions || []" :globalVariableOptions="globalVariableOptions || []" :environmentManager="environmentManager" :collections="collections" :insideLoop="true" :depth="(depth || 0) + 1" @changed="notify" @open-request="$emit('open-request', $event)" @customize-request="$emit('customize-request', $event)" @add-console-log="$emit('add-console-log', $event)" />
        </template>
      </div>
    </div>

    <Dialog
      :visible="Boolean(editingInlineStep)"
      header="Inline Request"
      modal
      maximizable
      :style="{ width: '78.2vw', height: '86vh' }"
      contentClass="flex-1 min-h-0 p-0"
      @update:visible="value => { if (!value) requestCloseInlineEditor() }"
    >
      <HttpRequest
        v-if="editingInlineStep && inlineEditorDraft"
        :key="editingInlineStep.id"
        ref="inlineRequestEditorRef"
        :request="inlineEditorDraft"
        :isActive="false"
        :environmentManager="environmentManager"
        :collections="collections"
        embedded
        @update:request="updateInlineRequest"
        @add-console-log="$emit('add-console-log', $event)"
      />

      <template #footer>
        <div class="flex items-center w-full gap-3">
          <span
            class="mr-auto text-sm"
            :class="hasInlineEditorChanges
              ? 'text-orange-600 dark:text-orange-400'
              : 'text-surface-500'"
          >
            <i
              :class="hasInlineEditorChanges
                ? 'pi pi-circle-fill text-xs mr-2'
                : 'pi pi-check-circle mr-2'"
            ></i>
            {{ hasInlineEditorChanges ? 'Unapplied changes' : 'No changes' }}
          </span>
          <Button label="Cancel" severity="secondary" text @click="requestCloseInlineEditor" />
          <Button
            label="Apply Changes"
            icon="pi pi-check"
            @click="applyInlineRequestChanges"
          />
        </div>
      </template>
    </Dialog>

  </div>
</template>
