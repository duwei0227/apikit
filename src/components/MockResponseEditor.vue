<script setup lang="ts">
import { computed, ref } from 'vue';
import type { MockBodyMode, MockResponse, MockRoute, MockRuleOperator, MockRuleSource } from '@/types/models';
import { getAvailableVariables } from '@/services/variables/resolver';
import { createMockVariableResolver } from '@/services/mock/handler';
import { createMockRule, MOCK_RULE_OPERATORS, MOCK_RULE_SOURCES } from '@/utils/mockFactory';
import { buildMockRequestData, matchMockPath, mockExamplePath, splitMockRequestTarget } from '@/utils/mockMatching';
import { renderMockTemplate } from '@/utils/mockTemplate';
import RequestHeadersEditor from './RequestHeadersEditor.vue';
import JsonEditor from './JsonEditor.vue';
import DocsLink from './DocsLink.vue';
import CodeEditor from './CodeEditor.vue';

const response = defineModel<MockResponse>('response', { required: true });
const props = defineProps<{
  route: MockRoute;
  defaultDelayMs: number;
  index: number;
  count: number;
}>();
const emit = defineEmits<{
  'set-default': [isDefault: boolean];
  move: [offset: number];
  duplicate: [];
  delete: [];
}>();

type Section = 'rules' | 'headers' | 'body';
const section = ref<Section>(response.value.rules.length > 0 ? 'rules' : 'body');

const SOURCE_LABELS: Record<MockRuleSource, string> = {
  query: 'Query',
  header: 'Header',
  path: 'Path param',
  body: 'Body (JSONPath)',
  cookie: 'Cookie',
};
const OPERATOR_LABELS: Record<MockRuleOperator, string> = {
  equals: 'equals',
  notEquals: 'not equals',
  contains: 'contains',
  regex: 'matches regex',
  exists: 'exists',
  notExists: 'not exists',
};
const sourceOptions = MOCK_RULE_SOURCES.map(value => ({ value, label: SOURCE_LABELS[value] }));
const operatorOptions = MOCK_RULE_OPERATORS.map(value => ({ value, label: OPERATOR_LABELS[value] }));
const logicOptions = [{ value: 'all', label: 'all' }, { value: 'any', label: 'any' }];
const KEY_PLACEHOLDERS: Record<MockRuleSource, string> = {
  query: 'page',
  header: 'Authorization',
  path: 'id',
  body: '$.items[0].sku',
  cookie: 'session',
};
const needsValue = (operator: MockRuleOperator) => operator !== 'exists' && operator !== 'notExists';

// 响应头编辑器需要末尾有一行空行
if (!response.value.headers.some(header => !header.key && !header.value)) {
  response.value.headers.push({ key: '', value: '', enabled: true });
}

const statusText = computed({
  get: () => String(response.value.status),
  set: (value: string) => {
    const status = parseInt(value, 10);
    if (Number.isInteger(status)) response.value.status = status;
  },
});

const delayText = computed({
  get: () => (response.value.delayMs === null ? '' : String(response.value.delayMs)),
  set: (value: string) => {
    const delay = parseInt(value, 10);
    response.value.delayMs = value.trim() === '' || !Number.isFinite(delay) ? null : Math.max(0, Math.min(60000, delay));
  },
});

const addRule = () => {
  response.value.rules.push(createMockRule({ source: props.route.path.includes(':') || props.route.path.includes('{') ? 'path' : 'query' }));
};
const removeRule = (index: number) => response.value.rules.splice(index, 1);

const bodyModes: Array<{ value: MockBodyMode; label: string }> = [
  { value: 'json', label: 'JSON' },
  { value: 'template', label: 'Template' },
  { value: 'text', label: 'Text' },
];

// 补全：环境变量和内置变量，加上读取请求数据的写法
const REQUEST_VARIABLES: Record<string, string> = {
  '$request.params.': 'path parameter',
  '$request.query.': 'query parameter',
  '$request.headers.': 'request header (lower case)',
  '$request.cookies.': 'cookie',
  '$request.body.': 'value at a JSONPath in the request body',
  '$request.body': 'the whole request body',
  '$request.method': 'request method',
  '$request.path': 'request path',
  '$index': 'position inside {{#repeat}}, from 1',
  '$pick(a, b)': 'one of the values, at random',
};
const availableVariables = computed(() => ({ ...getAvailableVariables(), ...REQUEST_VARIABLES }));

// 模板预览：按填写的请求路径和查询参数生成一次
const examplePath = computed(() => mockExamplePath(props.route.path));
const previewUrl = ref('');
const previewRevision = ref(0);
const previewTarget = computed(() => previewUrl.value.trim() || examplePath.value);
const preview = computed(() => {
  previewRevision.value;
  const { path, query } = splitMockRequestTarget(previewTarget.value);
  const request = buildMockRequestData({ method: props.route.method, path, query, headers: [], body: '' });
  request.params = matchMockPath(props.route.path, path) || {};
  try {
    return renderMockTemplate(response.value.body, { request, resolveVariable: createMockVariableResolver() });
  } catch (error) {
    return `Failed to build the preview: ${error instanceof Error ? error.message : String(error)}`;
  }
});
const previewItemCount = computed(() => {
  if (!preview.value.trim()) return 'empty';
  try {
    const parsed: unknown = JSON.parse(preview.value);
    if (Array.isArray(parsed)) return `${parsed.length} items`;
    if (parsed && typeof parsed === 'object') {
      const arrays = Object.values(parsed).filter(Array.isArray);
      if (arrays.length === 1) return `${(arrays[0] as unknown[]).length} items generated`;
    }
    return 'valid JSON';
  } catch {
    return 'not valid JSON';
  }
});
</script>

<template>
  <div class="mock-response-editor border border-surface-200 dark:border-surface-700 rounded-lg p-3 flex flex-col gap-3">
    <div class="flex gap-2.5 flex-wrap items-end">
      <label class="flex flex-col gap-1 flex-1 min-w-48 text-xs text-surface-500">Response Name
        <InputText v-model="response.name" size="small" aria-label="Response name" />
      </label>
      <label class="flex flex-col gap-1 w-24 text-xs text-surface-500">Status
        <InputText v-model="statusText" size="small" inputmode="numeric" aria-label="Status" />
      </label>
      <label class="flex flex-col gap-1 w-32 text-xs text-surface-500">Delay (ms)
        <InputText v-model="delayText" size="small" inputmode="numeric" :placeholder="`Default (${defaultDelayMs})`" aria-label="Delay" />
      </label>
      <label class="flex items-center gap-1.5 pb-1.5">
        <Checkbox :model-value="response.isDefault" binary @update:model-value="(value: boolean) => emit('set-default', value)" /> Default
      </label>
      <span class="flex-1"></span>
      <Button icon="pi pi-arrow-left" text rounded size="small" severity="secondary" title="Move Earlier" :disabled="index <= 0" @click="emit('move', -1)" />
      <Button icon="pi pi-arrow-right" text rounded size="small" severity="secondary" title="Move Later" :disabled="index >= count - 1" @click="emit('move', 1)" />
      <Button icon="pi pi-clone" text rounded size="small" severity="secondary" title="Duplicate Response" @click="emit('duplicate')" />
      <Button icon="pi pi-trash" text rounded size="small" severity="danger" title="Delete Response" @click="emit('delete')" />
    </div>

    <Tabs v-model:value="section">
      <TabList>
        <Tab value="rules">Rules ({{ response.rules.length }})</Tab>
        <Tab value="headers">Headers ({{ response.headers.filter(header => header.key.trim()).length }})</Tab>
        <Tab value="body">Body</Tab>
      </TabList>
    </Tabs>

    <!-- 匹配规则 -->
    <div v-if="section === 'rules'" class="flex flex-col gap-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span>Return this response when</span>
        <Select v-model="response.ruleLogic" :options="logicOptions" option-label="label" option-value="value" size="small" class="w-24" aria-label="Rule logic" />
        <span>rules match</span>
      </div>
      <div v-for="(rule, ruleIndex) in response.rules" :key="rule.id" class="rule-row grid gap-2 items-center">
        <Select v-model="rule.source" :options="sourceOptions" option-label="label" option-value="value" size="small" aria-label="Source" />
        <InputText v-model="rule.key" size="small" class="font-mono" :placeholder="KEY_PLACEHOLDERS[rule.source]" aria-label="Key" />
        <Select v-model="rule.operator" :options="operatorOptions" option-label="label" option-value="value" size="small" aria-label="Operator" />
        <InputText v-if="needsValue(rule.operator)" v-model="rule.value" size="small" class="font-mono" placeholder="value" aria-label="Value" />
        <span v-else></span>
        <Button icon="pi pi-times" text rounded size="small" severity="secondary" aria-label="Remove rule" @click="removeRule(ruleIndex)" />
      </div>
      <div>
        <Button label="Add rule" icon="pi pi-plus" text size="small" @click="addRule" />
      </div>
      <p class="m-0 text-xs text-surface-500">
        Without rules, a response is returned only as the default or when the caller asks for it with the
        <code>x-mock-response-name</code> or <code>x-mock-response-code</code> header.
      </p>
    </div>

    <!-- 响应头 -->
    <div v-else-if="section === 'headers'">
      <RequestHeadersEditor v-model:headers="response.headers" :available-variables="availableVariables" />
      <p class="m-0 mt-2 text-xs text-surface-500">Content-Type defaults to application/json, or text/plain for Text bodies.</p>
    </div>

    <!-- 响应体 -->
    <div v-else class="flex flex-col gap-2">
      <div class="flex items-center gap-4 flex-wrap">
        <label v-for="mode in bodyModes" :key="mode.value" class="flex items-center gap-1.5">
          <RadioButton v-model="response.bodyMode" :value="mode.value" :input-id="`body-mode-${response.id}-${mode.value}`" /> {{ mode.label }}
        </label>
        <DocsLink topic="mockTemplate" class="-ml-2" />
        <template v-if="response.bodyMode === 'template'">
          <span class="flex-1"></span>
          <label class="flex items-center gap-2 text-xs text-surface-600 dark:text-surface-300">Preview with
            <InputText v-model="previewUrl" size="small" class="font-mono w-56" :placeholder="`${examplePath}?page=1`" aria-label="Preview request" />
          </label>
          <Button label="Regenerate" size="small" severity="secondary" @click="previewRevision++" />
        </template>
      </div>
      <div class="body-editors grid gap-3" :class="{ 'with-preview': response.bodyMode === 'template' }">
        <div class="flex flex-col gap-1 min-w-0">
          <span v-if="response.bodyMode === 'template'" class="text-xs text-surface-500">Template</span>
          <div class="body-editor border border-surface-200 dark:border-surface-700 rounded overflow-hidden">
            <JsonEditor
              v-model="response.body"
              :language="response.bodyMode === 'text' ? 'text' : 'json'"
              :available-variables="availableVariables"
              placeholder='{ "id": {{$request.params.id}} }'
            />
          </div>
        </div>
        <div v-if="response.bodyMode === 'template'" class="flex flex-col gap-1 min-w-0">
          <span class="text-xs text-surface-500">Preview · {{ previewItemCount }}</span>
          <div class="body-editor mock-preview border border-surface-200 dark:border-surface-700 rounded overflow-hidden">
            <CodeEditor :model-value="preview" language="json" read-only />
          </div>
        </div>
      </div>
      <p class="m-0 text-xs text-surface-500 leading-relaxed">
        <code v-pre>{{$request.params.id}}</code>, <code v-pre>{{$request.query.page ?? 1}}</code>, <code v-pre>{{$request.headers.x-trace}}</code>,
        <code v-pre>{{$request.body.$.user.id}}</code> read the request; <code v-pre>?? value</code> is used when it has none.
        <code v-pre>{{#repeat 10}} … {{/repeat}}</code> repeats a block and joins the copies with commas; the count can come from the request,
        such as <code v-pre>{{#repeat $request.query.pageSize ?? 10}}</code>, and <code v-pre>{{$index}}</code> counts from 1 inside it.
        <code v-pre>{{$pick(paid, pending)}}</code> picks one value. Environment variables and dynamic variables such as
        <code v-pre>{{$guid}}</code> and <code v-pre>{{$randomInt(1, 100)}}</code> work too.
      </p>
    </div>
  </div>
</template>

<style scoped>
.rule-row { grid-template-columns: 9.5rem minmax(0, 1fr) 9rem minmax(0, 1fr) 2rem; }
.body-editors.with-preview { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
/* 编辑器按 flex 撑满：JsonEditor 用 flex: 1，容器需要是 flex 布局 */
.body-editor { height: 20rem; display: flex; flex-direction: column; }
code { font-size: 11px; }
</style>
