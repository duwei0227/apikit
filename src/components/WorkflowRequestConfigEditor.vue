<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useEnvironmentsStore } from '@/stores/environments';
import { useKeyValueRows } from '@/composables/useKeyValueRows';
import type { Request, TestConfig } from '@/types/models';
import { parseRequestUrl, serializeRequestUrl } from '@/utils/urlQuery';
import { normalizeTestConfig } from '@/utils/requestTests';
import VariableInput from './VariableInput.vue';
import RequestBodyEditor from './RequestBodyEditor.vue';
import RequestTestsEditor from './RequestTestsEditor.vue';

const props = defineProps<{
  request: Request;
  environmentManager?: any;
}>();

const environmentsStore = useEnvironmentsStore();
const activeTab = ref(0);
const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
const authTypes = [
  { label: 'No Auth', value: 'none' },
  { label: 'Bearer Token', value: 'bearer' },
  { label: 'Basic Auth', value: 'basic' },
];

const manager = () => {
  let value = props.environmentManager;
  if (value && typeof value === 'object' && 'value' in value) value = value.value;
  return value;
};

const availableVariables = computed(() => {
  const environmentManager = manager();
  const variables = environmentManager && typeof environmentManager.getAllAvailableVariables === 'function'
    ? { ...environmentManager.getAllAvailableVariables() }
    : { ...environmentsStore.getAllAvailableVariables };

  [
    '$timestamp', '$isoTimestamp', '$randomInt', '$guid', '$date', '$time',
    '$datetime', '$randomAlpha', '$randomNumeric', '$randomUppercase',
    '$randomLowercase', '$randomAlphanumeric', '$randomChinese', '$sequence',
  ].forEach(key => {
    if (!(key in variables)) variables[key] = '';
  });
  return variables;
});

const ensureTests = (): TestConfig => {
  const normalized = normalizeTestConfig(props.request.testsConfig ?? props.request.tests);
  if (!props.request.testsConfig || JSON.stringify(props.request.testsConfig) !== JSON.stringify(normalized)) {
    props.request.testsConfig = normalized;
  }
  return props.request.testsConfig;
};

const tests = computed(ensureTests);

const ensureSettings = () => {
  props.request.settings = {
    followRedirects: props.request.settings?.followRedirects ?? true,
    maxRedirectCount: props.request.settings?.maxRedirectCount ?? 10,
    verifySsl: props.request.settings?.verifySsl ?? true,
    autoEncodeUrl: props.request.settings?.autoEncodeUrl ?? true,
    acceptEncoding: props.request.settings?.acceptEncoding ?? true,
  };
};

watch(() => props.request, () => {
  ensureTests();
  ensureSettings();
}, { immediate: true });

const syncUrlFromParams = () => {
  const parsedUrl = parseRequestUrl(props.request.url);
  const nextUrl = serializeRequestUrl(parsedUrl.baseUrl, props.request.params, {
    autoEncode: false,
    fragment: parsedUrl.fragment,
  });
  if (nextUrl !== props.request.url) props.request.url = nextUrl;
};

const syncParamsFromUrl = () => {
  const parsedUrl = parseRequestUrl(props.request.url);
  if (!parsedUrl.hasQuery) {
    props.request.params = [{ key: '', value: '', enabled: true }];
    return;
  }
  props.request.params = [...parsedUrl.params, { key: '', value: '', enabled: true }];
  syncUrlFromParams();
};

const { remove: removeParam, onChange: onParamChange } = useKeyValueRows({
  getRows: () => props.request.params,
  createRow: () => ({ key: '', value: '', enabled: true }),
  removeStrategy: 'replaceLast',
  onAfterChange: syncUrlFromParams,
});

const { remove: removeHeader, onChange: onHeaderChange } = useKeyValueRows({
  getRows: () => props.request.headers,
  createRow: () => ({ key: '', value: '', enabled: true }),
});

watch(() => props.request.body.type, bodyType => {
  const index = props.request.headers.findIndex(
    header => header.key.toLowerCase() === 'content-type',
  );
  const contentType = {
    json: 'application/json',
    xml: 'application/xml',
    text: 'text/plain',
    binary: 'application/octet-stream',
    'form-data': 'multipart/form-data',
    'x-www-form-urlencoded': 'application/x-www-form-urlencoded',
  }[bodyType];

  if (!contentType) {
    if (index >= 0) props.request.headers.splice(index, 1);
    if (props.request.headers.length === 0) {
      props.request.headers.push({ key: '', value: '', enabled: true });
    }
    return;
  }
  if (index >= 0) {
    props.request.headers[index].value = contentType;
  } else {
    const emptyIndex = props.request.headers.findIndex(header => !header.key && !header.value);
    const header = { key: 'Content-Type', value: contentType, enabled: true };
    if (emptyIndex >= 0) props.request.headers.splice(emptyIndex, 0, header);
    else props.request.headers.push(header);
  }
});
</script>

<template>
  <div class="h-full min-h-0 flex flex-col">
    <div class="flex gap-2 p-4 py-3 border-b border-surface-200 dark:border-surface-700">
      <Dropdown v-model="request.method" :options="methods" class="w-32" />
      <VariableInput
        v-model="request.url"
        placeholder="Enter request URL"
        class="flex-1"
        :availableVariables="availableVariables"
        @blur="syncParamsFromUrl"
      />
    </div>

    <TabView v-model:activeIndex="activeTab" class="config-tabs" lazy>
      <TabPanel header="Params">
        <div class="p-4 overflow-y-auto">
          <div class="grid-row grid-header">
            <div></div><div>KEY</div><div>VALUE</div><div></div>
          </div>
          <div
            v-for="(param, index) in request.params"
            :key="index"
            class="grid-row"
          >
            <Checkbox v-model="param.enabled" binary />
            <VariableInput v-model="param.key" placeholder="Key" size="small" :availableVariables="availableVariables" @input="onParamChange" />
            <VariableInput v-model="param.value" placeholder="Value" size="small" :availableVariables="availableVariables" @input="onParamChange" />
            <Button
              v-if="request.params.length > 1 || param.key || param.value"
              icon="pi pi-trash"
              text
              rounded
              size="small"
              severity="danger"
              @click="removeParam(index)"
            />
          </div>
        </div>
      </TabPanel>

      <TabPanel header="Authorization">
        <div class="p-4 overflow-y-auto space-y-4">
          <div>
            <label class="block text-sm font-medium mb-2">Type</label>
            <Dropdown v-model="request.auth.type" :options="authTypes" optionLabel="label" optionValue="value" class="w-full" />
          </div>
          <div v-if="request.auth.type === 'bearer'">
            <label class="block text-sm font-medium mb-2">Token</label>
            <VariableInput v-model="request.auth.token" placeholder="Enter bearer token" :availableVariables="availableVariables" />
          </div>
          <template v-if="request.auth.type === 'basic'">
            <div>
              <label class="block text-sm font-medium mb-2">Username</label>
              <VariableInput v-model="request.auth.username" placeholder="Username" :availableVariables="availableVariables" />
            </div>
            <div>
              <label class="block text-sm font-medium mb-2">Password</label>
              <Password v-model="request.auth.password" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
            </div>
          </template>
        </div>
      </TabPanel>

      <TabPanel header="Headers">
        <div class="p-4 overflow-y-auto">
          <div class="grid-row grid-header">
            <div></div><div>KEY</div><div>VALUE</div><div></div>
          </div>
          <div
            v-for="(header, index) in request.headers"
            :key="index"
            class="grid-row"
          >
            <Checkbox v-model="header.enabled" binary />
            <VariableInput v-model="header.key" placeholder="Key" size="small" :availableVariables="availableVariables" @input="onHeaderChange" />
            <VariableInput v-model="header.value" placeholder="Value" size="small" :availableVariables="availableVariables" @input="onHeaderChange" />
            <Button
              v-if="request.headers.length > 1 || header.key || header.value"
              icon="pi pi-trash"
              text
              rounded
              size="small"
              severity="danger"
              @click="removeHeader(index)"
            />
          </div>
        </div>
      </TabPanel>

      <TabPanel header="Body">
        <RequestBodyEditor v-model:body="request.body" :availableVariables="availableVariables" />
      </TabPanel>

      <TabPanel header="Tests">
        <RequestTestsEditor
          v-model:statusCodeTests="tests.statusCodeTests"
          v-model:jsonFieldTests="tests.jsonFieldTests"
          v-model:globalVariables="tests.globalVariables"
        />
      </TabPanel>

      <TabPanel header="Settings">
        <div class="settings-panel">
          <div class="setting-row">
            <div class="setting-copy"><div class="setting-title">Automatically follow redirects</div><div class="setting-help">Follow HTTP 3xx redirects.</div></div>
            <div class="setting-control"><ToggleSwitch v-model="request.settings.followRedirects" /></div>
          </div>
          <div class="setting-row">
            <div class="setting-copy"><div class="setting-title">Max redirects</div><div class="setting-help">Maximum redirect count from 1 to 50.</div></div>
            <div class="setting-control">
              <InputNumber
                v-model="request.settings.maxRedirectCount"
                :min="1"
                :max="50"
                showButtons
                fluid
                size="small"
                class="redirect-limit-input"
              />
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-copy"><div class="setting-title">Enable SSL certificate verification</div><div class="setting-help">Reject invalid or self-signed certificates.</div></div>
            <div class="setting-control"><ToggleSwitch v-model="request.settings.verifySsl" /></div>
          </div>
          <div class="setting-row">
            <div class="setting-copy"><div class="setting-title">Encode URL automatically</div><div class="setting-help">Encode special URL characters before sending.</div></div>
            <div class="setting-control"><ToggleSwitch v-model="request.settings.autoEncodeUrl" /></div>
          </div>
          <div class="setting-row">
            <div class="setting-copy"><div class="setting-title">Accept compressed responses</div><div class="setting-help">Send gzip, deflate and br in Accept-Encoding.</div></div>
            <div class="setting-control"><ToggleSwitch v-model="request.settings.acceptEncoding" /></div>
          </div>
        </div>
      </TabPanel>
    </TabView>
  </div>
</template>

<style scoped>
:deep(.config-tabs) {
  display: flex;
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

:deep(.config-tabs .p-tabview-panels) {
  display: flex;
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

:deep(.config-tabs .p-tabview-panel) {
  display: flex;
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

.grid-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) minmax(0, 1fr) 40px;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.grid-header {
  padding: 0 0.5rem;
  color: var(--p-text-muted-color);
  font-size: 13px;
  font-weight: 600;
}

.setting-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 9rem;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--p-content-border-color);
}

.settings-panel {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 1rem;
  overflow-x: hidden;
  overflow-y: auto;
}

.setting-copy {
  min-width: 0;
}

.setting-control {
  display: flex;
  width: 9rem;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
}

:deep(.redirect-limit-input) {
  width: 8rem;
  max-width: 100%;
  min-width: 0;
}

:deep(.redirect-limit-input .p-inputnumber-input) {
  width: 100%;
  min-width: 0;
}

.setting-title {
  color: var(--p-text-color);
  font-size: 13px;
  font-weight: 500;
}

.setting-help {
  margin-top: 0.25rem;
  color: var(--p-text-muted-color);
  font-size: 12px;
}

@media (max-width: 640px) {
  .setting-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .setting-control {
    width: 7rem;
  }
}
</style>
