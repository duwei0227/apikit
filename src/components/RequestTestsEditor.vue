<script setup>
import { ref } from 'vue';
import { operatorOptions } from '@/constants/testOperators';

// Request assertion editor: status-code, JSON-field, and global-variable tables.
// The three arrays are two-way bound; the parent owns them (persistence, save,
// execution) and this component edits them in place.
const statusCodeTests = defineModel('statusCodeTests', { type: Array, default: () => [] });
const jsonFieldTests = defineModel('jsonFieldTests', { type: Array, default: () => [] });
const globalVariables = defineModel('globalVariables', { type: Array, default: () => [] });

const testsAccordion = ref(['0', '1', '2']); // 默认展开所有面板

// 添加测试行
const addStatusCodeTest = () => {
  statusCodeTests.value.push({ enabled: true, operator: 'equals', expectedValue: '', description: '' });
};

const addJsonFieldTest = () => {
  jsonFieldTests.value.push({ enabled: true, jsonPath: '', operator: 'equals', expectedValue: '', description: '' });
};

const addGlobalVariable = () => {
  globalVariables.value.push({ enabled: true, variableName: '', valueType: 'jsonPath', jsonPath: '', customValue: '', description: '' });
};

// 删除测试行
const removeStatusCodeTest = (index) => {
  if (statusCodeTests.value.length > 1) {
    statusCodeTests.value.splice(index, 1);
  } else {
    statusCodeTests.value[0] = { enabled: true, operator: 'equals', expectedValue: '', description: '' };
  }
};

const removeJsonFieldTest = (index) => {
  if (jsonFieldTests.value.length > 1) {
    jsonFieldTests.value.splice(index, 1);
  } else {
    jsonFieldTests.value[0] = { enabled: false, jsonPath: '', operator: 'equals', expectedValue: '', description: '' };
  }
};

const removeGlobalVariable = (index) => {
  if (globalVariables.value.length > 1) {
    globalVariables.value.splice(index, 1);
  } else {
    globalVariables.value[0] = { enabled: false, variableName: '', valueType: 'jsonPath', jsonPath: '', customValue: '', description: '' };
  }
};
</script>

<template>
  <div class="p-4 overflow-y-auto">
    <Accordion v-model:value="testsAccordion" multiple>
      <!-- 1. 响应码期望值判断 -->
      <AccordionPanel value="0">
        <AccordionHeader>
          <span class="flex items-center gap-2">
            <i class="pi pi-check-circle"></i>
            <span class="font-semibold">Status Code Assertions</span>
            <Badge :value="statusCodeTests.filter(t => t.enabled).length" severity="info" class="ml-2" />
          </span>
        </AccordionHeader>
        <AccordionContent>
          <div class="space-y-3">
            <p class="text-sm text-surface-600 dark:text-surface-400 mb-3">
              Verify that the HTTP response status code matches the expected value
            </p>

            <!-- Table Header -->
            <div class="grid grid-cols-12 gap-2 mb-2 text-sm font-bold text-surface-700 dark:text-surface-300 px-2">
              <div class="col-span-1"></div>
              <div class="col-span-3">Operator</div>
              <div class="col-span-2">Expected Value</div>
              <div class="col-span-5">Description</div>
              <div class="col-span-1"></div>
            </div>

            <!-- Table Rows -->
            <div class="space-y-2">
              <div
                v-for="(test, index) in statusCodeTests"
                :key="index"
                class="grid grid-cols-12 gap-2 items-center"
              >
                <div class="col-span-1 flex justify-center">
                  <Checkbox v-model="test.enabled" :binary="true" />
                </div>
                <div class="col-span-3">
                  <Dropdown
                    v-model="test.operator"
                    :options="operatorOptions"
                    optionLabel="label"
                    optionValue="value"
                    class="w-full"
                    size="small"
                  />
                </div>
                <div class="col-span-2">
                  <InputText
                    v-model="test.expectedValue"
                    placeholder="200"
                    class="w-full"
                    size="small"
                  />
                </div>
                <div class="col-span-5">
                  <InputText
                    v-model="test.description"
                    placeholder="Description (optional)"
                    class="w-full"
                    size="small"
                  />
                </div>
                <div class="col-span-1 flex justify-center">
                  <Button
                    v-if="statusCodeTests.length > 1 || test.expectedValue || test.description"
                    icon="pi pi-trash"
                    text
                    rounded
                    size="small"
                    severity="danger"
                    @click="removeStatusCodeTest(index)"
                  />
                </div>
              </div>
            </div>

            <Button
              label="Add Assertion"
              icon="pi pi-plus"
              size="small"
              text
              @click="addStatusCodeTest"
              class="mt-2"
            />
          </div>
        </AccordionContent>
      </AccordionPanel>

      <!-- 2. JSON字段断言 -->
      <AccordionPanel value="1">
        <AccordionHeader>
          <span class="flex items-center gap-2">
            <i class="pi pi-code"></i>
            <span class="font-semibold">JSON Field Assertions</span>
            <Badge :value="jsonFieldTests.filter(t => t.enabled).length" severity="success" class="ml-2" />
          </span>
        </AccordionHeader>
        <AccordionContent>
          <div class="space-y-3">
            <p class="text-sm text-surface-600 dark:text-surface-400 mb-3">
              Use JSONPath to extract and verify response field values. Use <code class="px-1 py-0.5 bg-surface-100 dark:bg-surface-800 rounded">$</code> for the root node,
              <code class="px-1 py-0.5 bg-surface-100 dark:bg-surface-800 rounded">[index]</code> to access array elements, and
              <code class="px-1 py-0.5 bg-surface-100 dark:bg-surface-800 rounded">.</code> to access object properties
            </p>

            <!-- Table Header -->
            <div class="grid grid-cols-12 gap-2 mb-2 text-sm font-bold text-surface-700 dark:text-surface-300 px-2">
              <div class="col-span-1"></div>
              <div class="col-span-3">JSON Path</div>
              <div class="col-span-2">Operator</div>
              <div class="col-span-2">Expected Value</div>
              <div class="col-span-3">Description</div>
              <div class="col-span-1"></div>
            </div>

            <!-- Table Rows -->
            <div class="space-y-2">
              <div
                v-for="(test, index) in jsonFieldTests"
                :key="index"
                class="grid grid-cols-12 gap-2 items-center"
              >
                <div class="col-span-1 flex justify-center">
                  <Checkbox v-model="test.enabled" :binary="true" />
                </div>
                <div class="col-span-3">
                  <InputText
                    v-model="test.jsonPath"
                    placeholder="$.data.id"
                    class="w-full font-mono text-xs"
                    size="small"
                  />
                </div>
                <div class="col-span-2">
                  <Dropdown
                    v-model="test.operator"
                    :options="operatorOptions"
                    optionLabel="label"
                    optionValue="value"
                    class="w-full"
                    size="small"
                  />
                </div>
                <div class="col-span-2">
                  <InputText
                    v-model="test.expectedValue"
                    placeholder="Expected value"
                    class="w-full"
                    size="small"
                    :disabled="test.operator === 'exists' || test.operator === 'notExists'"
                  />
                </div>
                <div class="col-span-3">
                  <InputText
                    v-model="test.description"
                    placeholder="Description (optional)"
                    class="w-full"
                    size="small"
                  />
                </div>
                <div class="col-span-1 flex justify-center">
                  <Button
                    v-if="jsonFieldTests.length > 1 || test.jsonPath || test.expectedValue || test.description"
                    icon="pi pi-trash"
                    text
                    rounded
                    size="small"
                    severity="danger"
                    @click="removeJsonFieldTest(index)"
                  />
                </div>
              </div>
            </div>

            <Button
              label="Add Assertion"
              icon="pi pi-plus"
              size="small"
              text
              @click="addJsonFieldTest"
              class="mt-2"
            />
          </div>
        </AccordionContent>
      </AccordionPanel>

      <!-- 3. 全局变量设置 -->
      <AccordionPanel value="2">
        <AccordionHeader>
          <span class="flex items-center gap-2">
            <i class="pi pi-globe"></i>
            <span class="font-semibold">Global Variable Settings</span>
            <Badge :value="globalVariables.filter(v => v.enabled).length" severity="warning" class="ml-2" />
          </span>
        </AccordionHeader>
        <AccordionContent>
          <div class="space-y-3">
            <p class="text-sm text-surface-600 dark:text-surface-400 mb-3">
              Extract field values from the response and save them as global variables for use in subsequent requests
            </p>

            <!-- Table Header -->
            <div class="grid grid-cols-12 gap-2 mb-2 text-sm font-bold text-surface-700 dark:text-surface-300 px-2">
              <div class="col-span-1"></div>
              <div class="col-span-2">Variable Name</div>
              <div class="col-span-2">Type</div>
              <div class="col-span-3">Value</div>
              <div class="col-span-3">Description</div>
              <div class="col-span-1"></div>
            </div>

            <!-- Table Rows -->
            <div class="space-y-2">
              <div
                v-for="(variable, index) in globalVariables"
                :key="index"
                class="grid grid-cols-12 gap-2 items-center"
              >
                <div class="col-span-1 flex justify-center">
                  <Checkbox v-model="variable.enabled" :binary="true" />
                </div>
                <div class="col-span-2">
                  <InputText
                    v-model="variable.variableName"
                    placeholder="token"
                    class="w-full font-mono text-xs"
                    size="small"
                  />
                </div>
                <div class="col-span-2">
                  <Select
                    v-model="variable.valueType"
                    :options="[
                      { label: 'JSON Path', value: 'jsonPath' },
                      { label: 'Custom Value', value: 'customValue' }
                    ]"
                    optionLabel="label"
                    optionValue="value"
                    class="w-full"
                    size="small"
                  />
                </div>
                <div class="col-span-3">
                  <InputText
                    v-if="variable.valueType === 'jsonPath'"
                    v-model="variable.jsonPath"
                    placeholder="$.data.token"
                    class="w-full font-mono text-xs"
                    size="small"
                  />
                  <InputText
                    v-else
                    v-model="variable.customValue"
                    placeholder="Custom value"
                    class="w-full text-xs"
                    size="small"
                  />
                </div>
                <div class="col-span-3">
                  <InputText
                    v-model="variable.description"
                    placeholder="Description (optional)"
                    class="w-full"
                    size="small"
                  />
                </div>
                <div class="col-span-1 flex justify-center">
                  <Button
                    v-if="globalVariables.length > 1 || variable.variableName || variable.jsonPath || variable.customValue || variable.description"
                    icon="pi pi-trash"
                    text
                    rounded
                    size="small"
                    severity="danger"
                    @click="removeGlobalVariable(index)"
                  />
                </div>
              </div>
            </div>

            <Button
              label="Add Variable"
              icon="pi pi-plus"
              size="small"
              text
              @click="addGlobalVariable"
              class="mt-2"
            />
          </div>
        </AccordionContent>
      </AccordionPanel>
    </Accordion>
  </div>
</template>
