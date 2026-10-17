<script setup lang="ts">
import { cloneJson } from '@/utils/clone';
import { computed, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import type { Collection, Request, WorkflowCondition, WorkflowStep } from '@/types/models';
import { createWorkflowControlStep, createWorkflowRequestStep, createWorkflowSetVariablesStep } from '@/stores/workflows';
import { getAvailableVariables } from '@/services/variables/resolver';
import VariableInput from './VariableInput.vue';
import DocsLink from './DocsLink.vue';
import { conditionMatchesFor, defaultWorkflowCondition, MAX_LOOP_DELAY_MS, MAX_LOOP_ITERATIONS, referenceStepName } from '@/services/workflow/definition';
import { findRequestReference } from '@/utils/collectionTree';
import { CONDITION_MATCH_LABELS } from '@/utils/workflowLogPresentation';
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
  collections?: Collection[];
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
const inlineRequestEditorRef = ref<{ getCurrentRequest: () => Request } | null>(null);
const draggedStepId = ref<string | null>(null);
const dropTarget = ref<{ stepId: string; position: 'before' | 'after' } | null>(null);
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

const conditionFieldOptions = (condition: WorkflowCondition) => {
  if (condition.source === 'globalVariable' || condition.source === 'loopIndex') {
    return conditionFields.filter(option => option.value === 'value');
  }
  return responseConditionFields;
};

const conditionOperatorOptions = (condition: WorkflowCondition) => {
  if (condition.source === 'loopIndex' || condition.field === 'status') return numericOperators;
  if (condition.source === 'globalVariable') return operators;
  if (condition.operator === 'exists' || condition.operator === 'notExists') return existsOperators;
  return textOperators;
};

const showConditionField = (condition: WorkflowCondition) => (
  condition.source === 'lastResponse' || condition.source === 'stepResponse'
);

const showConditionPath = (condition: WorkflowCondition) => (
  condition.field === 'jsonPath' || condition.field === 'header'
);

const conditionPathPlaceholder = (condition: WorkflowCondition) => {
  if (condition.source === 'globalVariable') return 'variable name';
  if (condition.field === 'jsonPath') return '$.data.id';
  if (condition.field === 'header') return 'content-type';
  return '';
};

const normalizeConditionOperator = (condition: WorkflowCondition) => {
  const validOperators = conditionOperatorOptions(condition).map(option => option.value);
  if (!validOperators.includes(condition.operator)) {
    condition.operator = validOperators[0] || 'equals';
  }
};

const onConditionSourceChange = (condition: WorkflowCondition) => {
  const validSources = conditionSources().map(option => option.value);
  if (!validSources.includes(condition.source)) {
    condition.source = 'lastResponse';
  }
  if (condition.source === 'loopIndex') {
    condition.field = 'value';
    condition.path = '';
    condition.stepId = '';
    condition.operator = 'equals';
    condition.expectedValue = condition.expectedValue || '0';
  } else if (condition.source === 'globalVariable') {
    condition.field = 'value';
    condition.stepId = '';
    condition.path = condition.path || props.globalVariableOptions?.[0]?.value || '';
    condition.operator = 'equals';
  } else {
    condition.field = 'status';
    condition.path = '';
    condition.stepId = condition.source === 'stepResponse'
      ? condition.stepId || props.responseStepOptions?.[0]?.value || ''
      : '';
    condition.operator = 'equals';
    condition.expectedValue = condition.expectedValue || '200';
  }
  normalizeConditionOperator(condition);
  notify();
};

const onConditionFieldChange = (condition: WorkflowCondition) => {
  if (condition.field === 'status') {
    condition.path = '';
    condition.expectedValue = condition.expectedValue || '200';
  } else if (condition.field === 'body') {
    condition.path = '';
  }
  normalizeConditionOperator(condition);
  notify();
};

const conditionMatchOptions = (step: WorkflowStep) => conditionMatchesFor(step.type).map(value => ({
  value,
  label: CONDITION_MATCH_LABELS[value],
}));

const conditionMatchPrefix = (step: WorkflowStep) => ({
  if: 'Then when',
  while: 'Repeat while',
  doWhile: 'Repeat while',
  until: 'Stop when',
}[step.type as 'if' | 'while' | 'doWhile' | 'until'] || 'When');

const addCondition = (step: WorkflowStep) => {
  step.conditions = [...(step.conditions || []), defaultWorkflowCondition()];
  step.conditionMatch = step.conditionMatch || 'all';
  notify();
};

const removeCondition = (step: WorkflowStep, index: number) => {
  if (!step.conditions || step.conditions.length <= 1) return;
  step.conditions.splice(index, 1);
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
  const previousName = step.requestId ? findRequestReference(props.collections, step.requestId)?.name : undefined;
  step.name = referenceStepName(step.name, findRequestReference(props.collections, requestId)?.name, previousName);
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
  inlineEditorDraft.value = cloneJson(request);
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

const addSetVariables = () => {
  props.steps.push(createWorkflowSetVariablesStep());
  notify();
};

// 设置变量时的 {{ 补全：环境变量、全局变量和内置变量
const variableSuggestions = computed(() => getAvailableVariables());

const stepVariables = (step: WorkflowStep) => {
  if (!Array.isArray(step.variables)) step.variables = [];
  return step.variables;
};

const addStepVariable = (step: WorkflowStep) => {
  stepVariables(step).push({ key: '', value: '', enabled: true });
  notify();
};

const removeStepVariable = (step: WorkflowStep, index: number) => {
  stepVariables(step).splice(index, 1);
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
    setVariables: 'Set Variables',
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

const startStepDrag = (event: DragEvent, step: WorkflowStep) => {
  draggedStepId.value = step.id;
  dropTarget.value = null;
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', step.id);
};

const updateStepDropTarget = (event: DragEvent, step: WorkflowStep) => {
  if (!draggedStepId.value) return;
  event.stopPropagation();
  if (draggedStepId.value === step.id) {
    dropTarget.value = null;
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  const target = event.currentTarget as HTMLElement;
  const position = event.clientY < target.getBoundingClientRect().top + target.offsetHeight / 2
    ? 'before'
    : 'after';
  dropTarget.value = { stepId: step.id, position };
};

const finishStepDrag = () => {
  draggedStepId.value = null;
  dropTarget.value = null;
};

const dropStep = (event: DragEvent, targetStep: WorkflowStep) => {
  if (!draggedStepId.value || !dropTarget.value) return;
  event.preventDefault();
  event.stopPropagation();

  const sourceIndex = props.steps.findIndex(step => step.id === draggedStepId.value);
  const targetIndex = props.steps.findIndex(step => step.id === targetStep.id);
  if (sourceIndex < 0 || targetIndex < 0) {
    finishStepDrag();
    return;
  }

  let insertionIndex = targetIndex + (dropTarget.value.position === 'after' ? 1 : 0);
  const [step] = props.steps.splice(sourceIndex, 1);
  if (sourceIndex < insertionIndex) insertionIndex -= 1;
  props.steps.splice(insertionIndex, 0, step);
  finishStepDrag();
  notify();
};

// 折叠过的步骤只隐藏内容、不销毁，保留其中输入框的撤销历史。
// 初始即折叠的步骤在首次展开前不渲染，避免打开大 workflow 时一次渲染全部内容。
const renderedStepIds = ref(new Set<string>());

const toggleCollapsed = (step: WorkflowStep) => {
  if (!step.collapsed) renderedStepIds.value.add(step.id);
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
      <Button label="Set Variables" icon="pi pi-pencil" size="small" outlined @click="addSetVariables" />
    </div>

    <div v-if="steps.length === 0" class="border border-dashed border-surface-300 dark:border-surface-700 rounded p-6 text-center text-sm text-surface-500">
      No steps yet
    </div>

    <div
      v-for="(step, index) in steps"
      :key="step.id"
      class="relative border rounded transition-colors"
      :class="step.enabled
        ? 'border-surface-200 bg-surface-0 dark:border-surface-700 dark:bg-surface-900'
        : 'border-dashed border-surface-300 bg-surface-100 dark:border-surface-700 dark:bg-surface-950'"
      @dragover="updateStepDropTarget($event, step)"
      @drop="dropStep($event, step)"
    >
      <div
        v-if="dropTarget?.stepId === step.id"
        class="pointer-events-none absolute inset-x-1 z-20 h-0.5 bg-primary-500 shadow-[0_0_0_1px_var(--p-primary-200)]"
        :class="dropTarget.position === 'before' ? '-top-0.5' : '-bottom-0.5'"
      ></div>
      <div class="flex items-center gap-2 p-3 border-b border-surface-100 dark:border-surface-800">
        <button
          type="button"
          draggable="true"
          class="inline-flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded text-surface-500 hover:bg-surface-100 hover:text-surface-700 active:cursor-grabbing dark:hover:bg-surface-800 dark:hover:text-surface-200"
          title="Drag to reorder"
          aria-label="Drag to reorder step"
          @dragstart.stop="startStepDrag($event, step)"
          @dragend.stop="finishStepDrag"
        >
          <i class="pi pi-bars"></i>
        </button>
        <Button
          :icon="step.collapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
          text
          rounded
          size="small"
          severity="secondary"
          :title="step.collapsed ? 'Expand' : 'Collapse'"
          @click="toggleCollapsed(step)"
        />
        <Checkbox
          v-model="step.enabled"
          :binary="true"
          :title="step.enabled ? 'Disable step' : 'Enable step'"
          @update:modelValue="notify"
        />
        <Badge :value="stepTypeLabel(step.type)" :severity="step.enabled ? 'info' : 'secondary'" />
        <Badge v-if="!step.enabled" value="Disabled" severity="secondary" />
        <InputText
          v-model="step.name"
          size="small"
          class="flex-1 min-w-0"
          data-testid="step-name"
          :class="{ 'opacity-60': !step.enabled }"
          @update:modelValue="notify"
        />
        <Button icon="pi pi-arrow-up" text rounded size="small" :disabled="index === 0" @click="moveStep(index, -1)" />
        <Button icon="pi pi-arrow-down" text rounded size="small" :disabled="index === steps.length - 1" @click="moveStep(index, 1)" />
        <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="removeStep(index)" />
      </div>

      <div
        v-if="!step.collapsed || renderedStepIds.has(step.id)"
        v-show="!step.collapsed"
        class="p-3 space-y-3 transition-opacity"
        :class="{ 'opacity-60': !step.enabled }"
      >
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
              @update:modelValue="(value: WorkflowStep['requestSource']) => { step.requestSource = value; step.requestSource === 'inline' ? ensureInlineRequest(step) : notify() }"
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
              @update:modelValue="(value: string) => changeReferencedRequest(step, value)"
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

        <template v-else-if="isConditionStep(step) && step.conditions?.length">
          <div v-if="step.conditions.length > 1" class="flex flex-wrap items-center gap-2">
            <span class="text-sm text-surface-500">{{ conditionMatchPrefix(step) }}</span>
            <Dropdown
              v-model="step.conditionMatch"
              :options="conditionMatchOptions(step)"
              optionLabel="label"
              optionValue="value"
              size="small"
              data-testid="condition-match"
              @update:modelValue="notify"
            />
          </div>
          <div
            v-for="(condition, conditionIndex) in step.conditions"
            :key="conditionIndex"
            class="flex items-start gap-2"
            data-testid="workflow-condition-row"
          >
            <span
              v-if="step.conditions.length > 1"
              class="w-5 shrink-0 pt-2 text-right text-xs text-surface-500"
            >{{ conditionIndex + 1 }}</span>
            <div class="grid grid-cols-1 xl:grid-cols-6 gap-2 flex-1 min-w-0">
              <Dropdown
                v-model="condition.source"
                :options="conditionSources()"
                optionLabel="label"
                optionValue="value"
                size="small"
                @update:modelValue="(value: WorkflowCondition['source']) => { condition.source = value; onConditionSourceChange(condition) }"
              />
              <Dropdown
                v-if="condition.source === 'stepResponse'"
                v-model="condition.stepId"
                :options="responseStepOptions || []"
                optionLabel="label"
                optionValue="value"
                placeholder="Select request step"
                filter
                size="small"
                @update:modelValue="notify"
              />
              <Dropdown
                v-if="condition.source === 'globalVariable'"
                v-model="condition.path"
                :options="globalVariableOptions || []"
                optionLabel="label"
                optionValue="value"
                placeholder="Select global variable"
                filter
                size="small"
                @update:modelValue="notify"
              />
              <Dropdown
                v-if="showConditionField(condition)"
                v-model="condition.field"
                :options="conditionFieldOptions(condition)"
                optionLabel="label"
                optionValue="value"
                size="small"
                @update:modelValue="(value: WorkflowCondition['field']) => { condition.field = value; onConditionFieldChange(condition) }"
              />
              <InputText
                v-if="showConditionPath(condition)"
                v-model="condition.path"
                :placeholder="conditionPathPlaceholder(condition)"
                size="small"
                @update:modelValue="notify"
              />
              <Dropdown
                v-model="condition.operator"
                :options="conditionOperatorOptions(condition)"
                optionLabel="label"
                optionValue="value"
                size="small"
                @update:modelValue="notify"
              />
              <InputText
                v-if="condition.operator !== 'exists' && condition.operator !== 'notExists'"
                v-model="condition.expectedValue"
                placeholder="expected"
                size="small"
                @update:modelValue="notify"
              />
            </div>
            <Button
              v-if="step.conditions.length > 1"
              icon="pi pi-trash"
              size="small"
              text
              severity="secondary"
              aria-label="Remove condition"
              title="Remove condition"
              @click="removeCondition(step, conditionIndex)"
            />
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <Button
              label="Add condition"
              icon="pi pi-plus"
              size="small"
              text
              data-testid="add-condition"
              @click="addCondition(step)"
            />
            <span
              v-if="step.conditions.length > 1 && step.conditionMatch === 'cumulative'"
              class="text-xs text-surface-500"
            >
              <i class="pi pi-info-circle mr-1" />A condition stays met once it has been met; the loop stops when all of them have been met.
            </span>
            <DocsLink topic="workflowConditions" />
          </div>
          <div v-if="step.type === 'while' || step.type === 'doWhile' || step.type === 'until'" class="flex flex-wrap items-center gap-2">
            <span class="text-sm text-surface-500">Max iterations</span>
            <InputNumber v-model="step.maxIterations" :min="1" :max="MAX_LOOP_ITERATIONS" size="small" showButtons @update:modelValue="notify" />
            <span class="text-sm text-surface-500 ml-3">Wait between iterations</span>
            <InputNumber
              v-model="step.delayMs"
              :min="0"
              :max="MAX_LOOP_DELAY_MS"
              :step="500"
              suffix=" ms"
              placeholder="0 ms"
              size="small"
              showButtons
              data-testid="loop-delay"
              @update:modelValue="notify"
            />
            <DocsLink topic="workflowLoops" />
          </div>

          <template v-if="step.type === 'if'">
            <div class="grid grid-cols-1 2xl:grid-cols-2 gap-3">
              <div class="border border-surface-200 dark:border-surface-700 rounded p-3">
                <div class="text-sm font-medium mb-2">Then</div>
                <WorkflowStepList :steps="nestedSteps(step, 'then')" :requestOptions="requestOptions" :responseStepOptions="responseStepOptions || []" :globalVariableOptions="globalVariableOptions || []" :collections="collections" :insideLoop="insideLoop" :depth="(depth || 0) + 1" @changed="notify" @open-request="$emit('open-request', $event)" @customize-request="$emit('customize-request', $event)" @add-console-log="$emit('add-console-log', $event)" />
              </div>
              <div class="border border-surface-200 dark:border-surface-700 rounded p-3">
                <div class="text-sm font-medium mb-2">Else</div>
                <WorkflowStepList :steps="nestedSteps(step, 'else')" :requestOptions="requestOptions" :responseStepOptions="responseStepOptions || []" :globalVariableOptions="globalVariableOptions || []" :collections="collections" :insideLoop="insideLoop" :depth="(depth || 0) + 1" @changed="notify" @open-request="$emit('open-request', $event)" @customize-request="$emit('customize-request', $event)" @add-console-log="$emit('add-console-log', $event)" />
              </div>
            </div>
          </template>
          <template v-else>
            <WorkflowStepList :steps="nestedSteps(step, 'child')" :requestOptions="requestOptions" :responseStepOptions="responseStepOptions || []" :globalVariableOptions="globalVariableOptions || []" :collections="collections" :insideLoop="true" :depth="(depth || 0) + 1" @changed="notify" @open-request="$emit('open-request', $event)" @customize-request="$emit('customize-request', $event)" @add-console-log="$emit('add-console-log', $event)" />
          </template>
        </template>

        <template v-else-if="step.type === 'setVariables'">
          <div
            v-for="(variable, variableIndex) in stepVariables(step)"
            :key="variableIndex"
            class="flex items-center gap-2"
            data-testid="set-variable-row"
          >
            <Checkbox v-model="variable.enabled" :binary="true" title="Enable variable" @update:modelValue="notify" />
            <InputText
              v-model="variable.key"
              placeholder="variable name"
              size="small"
              class="w-48 font-mono text-xs"
              @update:modelValue="notify"
            />
            <span class="text-surface-500">=</span>
            <VariableInput
              v-model="variable.value"
              :availableVariables="variableSuggestions"
              placeholder="value, e.g. 1 or {{$guid}}"
              class="flex-1 min-w-0"
              @update:modelValue="notify"
            />
            <Button
              icon="pi pi-trash"
              size="small"
              text
              severity="secondary"
              aria-label="Remove variable"
              title="Remove variable"
              @click="removeStepVariable(step, variableIndex)"
            />
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <Button label="Add variable" icon="pi pi-plus" size="small" text data-testid="add-set-variable" @click="addStepVariable(step)" />
            <span class="text-xs text-surface-500">
              <i class="pi pi-info-circle mr-1" />Sets global variables when the step runs. Values can use <code v-pre>{{variables}}</code> and <code v-pre>{{$loopIndex}}</code>.
            </span>
            <DocsLink topic="setVariables" />
          </div>
        </template>

        <template v-else-if="step.type === 'for'">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm text-surface-500">Iterations</span>
            <InputNumber v-model="step.iterations" :min="0" size="small" showButtons @update:modelValue="notify" />
            <span class="text-sm text-surface-500 ml-3">Wait between iterations</span>
            <InputNumber
              v-model="step.delayMs"
              :min="0"
              :max="MAX_LOOP_DELAY_MS"
              :step="500"
              suffix=" ms"
              placeholder="0 ms"
              size="small"
              showButtons
              data-testid="loop-delay"
              @update:modelValue="notify"
            />
            <DocsLink topic="workflowLoops" />
          </div>
          <WorkflowStepList :steps="nestedSteps(step, 'child')" :requestOptions="requestOptions" :responseStepOptions="responseStepOptions || []" :globalVariableOptions="globalVariableOptions || []" :collections="collections" :insideLoop="true" :depth="(depth || 0) + 1" @changed="notify" @open-request="$emit('open-request', $event)" @customize-request="$emit('customize-request', $event)" @add-console-log="$emit('add-console-log', $event)" />
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
      @update:visible="(value: boolean) => { if (!value) requestCloseInlineEditor() }"
    >
      <HttpRequest
        v-if="editingInlineStep && inlineEditorDraft"
        :key="editingInlineStep.id"
        ref="inlineRequestEditorRef"
        :request="inlineEditorDraft"
        :isActive="false"
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
