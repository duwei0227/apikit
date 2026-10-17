<script setup lang="ts">
import { ref, computed } from 'vue';
import { useEnvironmentsStore } from '@/stores/environments';
import { useSequencesStore } from '@/stores/sequences';
import { findSequenceCalls } from '@/services/variables/dynamicVariables';
import type { Request } from '@/types/models';

interface ViewVariable {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

interface ViewSequence {
  name: string;
  currentValue: number;
  padding: number;
  step: number;
  startValue: number;
  displayValue: string;
  /** 已经发送过、在 store 中存在 */
  initialized: boolean;
}

const props = withDefaults(defineProps<{ currentRequest?: Request | null }>(), { currentRequest: null });

const emit = defineEmits<{ 'edit-sequence': [sequenceName: string] }>();

const environmentsStore = useEnvironmentsStore();
const sequencesStore = useSequencesStore();

// 变量查看相关
const showVariablesViewDialog = ref(false);
const currentRequestVariables = ref<{ environment: ViewVariable[]; global: ViewVariable[]; sequences: ViewSequence[] }>({
  environment: [],
  global: [],
  sequences: []
});

// 全局变量编辑相关
const showEditGlobalVarDialog = ref(false);
const editingGlobalVar = ref({ key: '', value: '', description: '', originalKey: '' });

const currentEnvironment = computed(() => environmentsStore.activeEnvironmentId);

const environments = computed(() =>
  [...environmentsStore.environments].sort((a, b) => a.name.localeCompare(b.name))
);

// 变量查看函数
const openVariablesView = () => {
  // 收集当前使用的变量信息
  
  // 1. Environment 变量
  const envVars: ViewVariable[] = [];
  if (currentEnvironment.value) {
    const env = environments.value.find(e => e.id === currentEnvironment.value);
    if (env) {
      env.variables.forEach(v => {
        if (v.key && v.enabled !== false) {
          envVars.push({
            key: v.key,
            value: v.value,
            enabled: true
          });
        }
      });
    }
  }
  
  // 2. 全局变量（从 store 获取）
  const globalVars: ViewVariable[] = [];
  environmentsStore.globalVariables.forEach(v => {
    if (v.key && v.enabled !== false) {
      globalVars.push({
        key: v.key,
        value: v.value,
        enabled: true,
        description: v.description || ''
      });
    }
  });
  
  // 3. Sequence 变量 - 只显示当前请求中使用的
  const sequences: ViewSequence[] = [];
  if (props.currentRequest) {
    // 收集请求中所有可能包含变量的字段
    const requestContent: string[] = [];
    
    // URL
    if (props.currentRequest.url) {
      requestContent.push(props.currentRequest.url);
    }
    
    // Params
    if (props.currentRequest.params && Array.isArray(props.currentRequest.params)) {
      props.currentRequest.params.forEach(param => {
        if (param.enabled && param.key) {
          requestContent.push(param.key);
          requestContent.push(param.value);
        }
      });
    }
    
    // Headers
    if (props.currentRequest.headers && Array.isArray(props.currentRequest.headers)) {
      props.currentRequest.headers.forEach(header => {
        if (header.enabled && header.key) {
          requestContent.push(header.key);
          requestContent.push(header.value);
        }
      });
    }
    
    // Body
    if (props.currentRequest.body) {
      if (['json', 'xml', 'text'].includes(props.currentRequest.body.type) && props.currentRequest.body.raw) {
        requestContent.push(props.currentRequest.body.raw);
      } else if (props.currentRequest.body.type === 'x-www-form-urlencoded' && props.currentRequest.body.urlencoded) {
        props.currentRequest.body.urlencoded.forEach(item => {
          if (item.enabled && item.key) {
            requestContent.push(item.key);
            requestContent.push(item.value);
          }
        });
      } else if (props.currentRequest.body.type === 'form-data' && props.currentRequest.body.formData) {
        props.currentRequest.body.formData.forEach(item => {
          if (item.enabled && item.key && item.type === 'text') {
            requestContent.push(item.key);
            requestContent.push(item.value);
          }
        });
      }
    }
    
    // 合并所有内容，按发送时的规则找出用到的序列
    const fullContent = requestContent.join(' ');
    const allSequences = sequencesStore.getAllSequences();
    findSequenceCalls(fullContent).forEach(call => {
      const existingSeq = allSequences.find(s => s.name === call.name);
      
      if (existingSeq) {
        // 序列已存在于 store 中
        sequences.push({
          name: existingSeq.name,
          currentValue: existingSeq.currentValue,
          padding: existingSeq.padding,
          step: existingSeq.step,
          startValue: existingSeq.startValue,
          displayValue: existingSeq.padding > 0 
            ? existingSeq.currentValue.toString().padStart(existingSeq.padding, '0') 
            : existingSeq.currentValue.toString(),
          initialized: true
        });
      } else {
        // 序列还未初始化（用户还没发送过请求）：第一次发送时按请求中的参数创建
        const padding = call.padding ?? 0;
        sequences.push({
          name: call.name,
          currentValue: call.startValue,
          padding,
          step: call.step,
          startValue: call.startValue,
          displayValue: padding > 0 ? String(call.startValue).padStart(padding, '0') : String(call.startValue),
          initialized: false
        });
      }
    });
  }
  
  // 同时展示 store 中已存在但未在当前请求中引用的 sequences
  const allStoreSequences = sequencesStore.getAllSequences();
  const displayedNames = new Set(sequences.map(s => s.name));
  allStoreSequences.forEach(seq => {
    if (!displayedNames.has(seq.name)) {
      sequences.push({
        name: seq.name,
        currentValue: seq.currentValue,
        padding: seq.padding,
        step: seq.step,
        startValue: seq.startValue,
        displayValue: seq.padding > 0
          ? seq.currentValue.toString().padStart(seq.padding, '0')
          : seq.currentValue.toString(),
        initialized: true
      });
    }
  });

  currentRequestVariables.value = {
    environment: envVars,
    global: globalVars,
    sequences: sequences
  };
  
  showVariablesViewDialog.value = true;
};

const editSequenceFromView = (sequenceName: string) => {
  showVariablesViewDialog.value = false;
  emit('edit-sequence', sequenceName);
};

// 编辑全局变量
const editGlobalVariable = (variable: ViewVariable) => {
  editingGlobalVar.value = {
    key: variable.key,
    value: variable.value,
    description: variable.description || '',
    originalKey: variable.key
  };
  showEditGlobalVarDialog.value = true;
};

const saveEditGlobalVariable = () => {
  const { key, value, description, originalKey } = editingGlobalVar.value;
  if (!key.trim()) return;

  // 如果 key 改了，先删旧的再加新的
  if (originalKey !== key.trim()) {
    environmentsStore.deleteGlobalVariable(originalKey);
  }
  environmentsStore.setGlobalVariable(key.trim(), value, true, description);

  showEditGlobalVarDialog.value = false;
  // 刷新变量视图
  openVariablesView();
};

const deleteGlobalVariable = (key: string) => {
  environmentsStore.deleteGlobalVariable(key);
  // 刷新变量视图
  openVariablesView();

  if (window.$toast) {
    window.$toast.add({
      severity: 'success',
      summary: 'Deleted',
      detail: `Global variable "${key}" deleted`,
      life: 2000
    });
  }
};

defineExpose({ open: openVariablesView });
</script>

<template>
  <!-- Variables View Dialog -->
  <Dialog 
    v-model:visible="showVariablesViewDialog"
    header="Current Request Variables"
    :modal="true"
    :style="{ width: '800px' }"
  >
    <div class="flex flex-col gap-6">
      <!-- Environment Variables -->
      <div>
        <div class="flex items-center gap-2 mb-3 pb-2 border-b border-surface-200 dark:border-surface-700">
          <i class="pi pi-database text-primary"></i>
          <span class="font-semibold text-surface-900 dark:text-surface-50">
            Environment Variables
          </span>
          <span v-if="currentEnvironment" class="text-xs px-2 py-1 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
            {{ environments.find(e => e.id === currentEnvironment)?.name }}
          </span>
        </div>
        
        <div v-if="currentRequestVariables.environment.length === 0" class="text-sm text-surface-500 dark:text-surface-400 italic py-4">
          No environment selected or no variables defined
        </div>
        
        <div v-else class="space-y-2">
          <div class="flex items-center gap-3 px-3 text-xs font-semibold text-surface-500 dark:text-surface-400">
            <div class="flex-1">Variable Name</div>
            <div class="flex-1">Value</div>
          </div>
          <div
            v-for="(variable, index) in currentRequestVariables.environment"
            :key="index"
            class="flex items-center gap-3 p-3 bg-surface-50 dark:bg-surface-800 rounded"
          >
            <div class="flex-1">
              <div class="text-sm font-mono text-primary">{{ variable.key }}</div>
            </div>
            <div class="flex-1">
              <div class="text-sm text-surface-700 dark:text-surface-300 break-all">{{ variable.value }}</div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Global Variables -->
      <div>
        <div class="flex items-center gap-2 mb-3 pb-2 border-b border-surface-200 dark:border-surface-700">
          <i class="pi pi-code text-green-600"></i>
          <span class="font-semibold text-surface-900 dark:text-surface-50">
            Global Variables
          </span>
        </div>
        
        <div v-if="environmentsStore.globalVariables.filter(v => v.enabled !== false).length === 0" class="text-sm text-surface-500 dark:text-surface-400 italic py-4">
          No global variables set
        </div>

        <div v-else class="space-y-2">
          <div class="flex items-center gap-3 px-3 text-xs font-semibold text-surface-500 dark:text-surface-400">
            <div class="flex-1">Variable Name</div>
            <div class="flex-1">Value</div>
            <div class="flex-1">Description</div>
            <div class="w-16"></div>
          </div>
          <div
            v-for="(variable, index) in environmentsStore.globalVariables.filter(v => v.enabled !== false)"
            :key="index"
            class="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded group"
          >
            <div class="flex-1">
              <div class="text-sm font-mono text-green-700 dark:text-green-400">{{ variable.key }}</div>
            </div>
            <div class="flex-1">
              <div class="text-sm text-surface-700 dark:text-surface-300 break-all">{{ variable.value }}</div>
            </div>
            <div class="flex-1">
              <div class="text-sm text-surface-500 dark:text-surface-400 break-all">{{ variable.description || '' }}</div>
            </div>
            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button 
                icon="pi pi-pencil"
                text
                rounded
                size="small"
                severity="secondary"
                title="Edit"
                @click="editGlobalVariable(variable)"
              />
              <Button 
                icon="pi pi-trash"
                text
                rounded
                size="small"
                severity="danger"
                title="Delete"
                @click="deleteGlobalVariable(variable.key)"
              />
            </div>
          </div>
        </div>
      </div>
      
      <!-- Sequence Variables -->
      <div>
        <div class="flex items-center gap-2 mb-3 pb-2 border-b border-surface-200 dark:border-surface-700">
          <i class="pi pi-sort-numeric-up text-orange-600"></i>
          <span class="font-semibold text-surface-900 dark:text-surface-50">
            Sequence Variables
          </span>
        </div>
        
        <div v-if="currentRequestVariables.sequences.length === 0" class="text-sm text-surface-500 dark:text-surface-400 italic py-4">
          No sequences used in current request
        </div>
        
        <div v-else class="space-y-2">
          <div class="flex items-center gap-3 px-3 text-xs font-semibold text-surface-500 dark:text-surface-400">
            <div class="flex-1">Variable Name</div>
            <div class="flex-1">Current Value</div>
            <div class="w-8"></div>
          </div>
          <div
            v-for="(sequence, index) in currentRequestVariables.sequences"
            :key="index"
            class="flex items-center gap-3 p-3 bg-orange-50 dark:bg-orange-900/20 rounded group"
          >
            <div class="flex-1">
              <div class="text-sm font-mono text-orange-700 dark:text-orange-400">
                $sequence(name={{ sequence.name }})
              </div>
            </div>
            <div class="flex-1">
              <div v-if="sequence.initialized" class="text-sm text-surface-700 dark:text-surface-300">
                Current: <span class="font-semibold">{{ sequence.displayValue }}</span>
                <span class="text-xs text-surface-500 dark:text-surface-400 ml-2">
                  (step: {{ sequence.step }})
                </span>
              </div>
              <div v-else class="text-sm text-surface-500 dark:text-surface-400 italic">
                Not initialized yet
                <span class="text-xs ml-2">(will start at {{ sequence.startValue }})</span>
              </div>
            </div>
            <div>
              <Button 
                icon="pi pi-pencil"
                text
                rounded
                size="small"
                severity="secondary"
                class="opacity-0 group-hover:opacity-100 transition-opacity"
                title="Edit Sequence"
                @click="editSequenceFromView(sequence.name)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <template #footer>
      <Button label="Close" @click="showVariablesViewDialog = false" />
    </template>
  </Dialog>
  
  <!-- Edit Global Variable Dialog -->
  <Dialog 
    v-model:visible="showEditGlobalVarDialog"
    header="Edit Global Variable"
    :modal="true"
    :style="{ width: '400px' }"
  >
    <div class="flex flex-col gap-4">
      <div>
        <label class="block text-sm font-medium mb-2">Variable Name</label>
        <InputText 
          v-model="editingGlobalVar.key"
          placeholder="Variable name"
          class="w-full"
        />
      </div>
      <div>
        <label class="block text-sm font-medium mb-2">Value</label>
        <InputText
          v-model="editingGlobalVar.value"
          placeholder="Value"
          class="w-full"
        />
      </div>
      <div>
        <label class="block text-sm font-medium mb-2">Description</label>
        <InputText
          v-model="editingGlobalVar.description"
          placeholder="Description (optional)"
          class="w-full"
        />
      </div>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" @click="showEditGlobalVarDialog = false" />
      <Button
        label="Save"
        @click="saveEditGlobalVariable"
        :disabled="!editingGlobalVar.key.trim()"
      />
    </template>
  </Dialog>
</template>
