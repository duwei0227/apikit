<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMocksStore, MAX_MOCK_LOGS } from '@/stores/mocks';
import type { MockService } from '@/types/models';

const service = defineModel<MockService>('service', { required: true });
defineProps<{ isRunning: boolean }>();

const mocksStore = useMocksStore();
const portInput = ref(String(service.value.port));
watch(() => service.value.port, port => { portInput.value = String(port); });

const portError = computed(() => {
  const port = Number(portInput.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Enter a port between 1 and 65535';
  const other = mocksStore.services.find(item => item.id !== service.value.id && item.port === port);
  return other ? `"${other.name}" already uses this port` : '';
});

const applyPort = () => {
  if (portError.value) return;
  service.value.port = Number(portInput.value);
};

const delayText = computed({
  get: () => String(service.value.defaultDelayMs),
  set: (value: string) => {
    const delay = parseInt(value, 10);
    service.value.defaultDelayMs = Number.isFinite(delay) ? Math.max(0, Math.min(60000, delay)) : 0;
  },
});

const logCount = computed(() => mocksStore.logs[service.value.id]?.length || 0);

const duplicate = () => void mocksStore.duplicateService(service.value.id);

const remove = () => {
  window.$confirm?.require({
    message: `Are you sure you want to delete "${service.value.name}"? Its routes and logs are deleted too.`,
    header: 'Confirm Deletion',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: () => void mocksStore.deleteService(service.value.id),
  });
};
</script>

<template>
  <div class="mock-settings h-full overflow-y-auto p-4">
    <div class="max-w-2xl flex flex-col gap-5">
      <div class="settings-grid grid gap-x-4 gap-y-3 items-center">
        <label for="mock-name" class="text-surface-600 dark:text-surface-300">Name</label>
        <InputText id="mock-name" v-model="service.name" size="small" class="max-w-80" />

        <label for="mock-port" class="text-surface-600 dark:text-surface-300">Port</label>
        <div class="flex items-center gap-2 flex-wrap">
          <InputText id="mock-port" v-model="portInput" size="small" class="w-24 font-mono" inputmode="numeric" :invalid="Boolean(portError)" @keydown.enter="applyPort" @blur="applyPort" />
          <span v-if="portError" class="text-xs text-red-600 dark:text-red-400">{{ portError }}</span>
          <span v-else class="text-xs text-surface-500">
            Listens on 127.0.0.1 only.{{ isRunning ? ' A running service restarts on the new port.' : '' }}
          </span>
        </div>

        <label for="mock-delay" class="text-surface-600 dark:text-surface-300">Default delay</label>
        <div class="flex items-center gap-2">
          <InputText id="mock-delay" v-model="delayText" size="small" class="w-24 font-mono" inputmode="numeric" />
          <span class="text-xs text-surface-500">ms · a response's own delay wins</span>
        </div>
      </div>

      <label class="flex items-center gap-2"><Checkbox v-model="service.autoStart" binary /> Start when ApiKit opens</label>
      <label class="flex items-start gap-2">
        <Checkbox v-model="service.cors" binary class="mt-0.5" />
        <span>
          Allow calls from browser pages (CORS)
          <span class="block text-xs text-surface-500">Answers preflight requests and adds Access-Control-Allow-* headers, so a dev server such as localhost:5173 can call the mock.</span>
        </span>
      </label>

      <div class="flex flex-col gap-1.5">
        <span class="font-semibold">When no route matches</span>
        <span>Returns 404 with the reason as JSON, for example <code>{"error": "No route matches GET /refunds"}</code>.</span>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="font-semibold">Logs</span>
        <span>
          Keeps the latest {{ MAX_MOCK_LOGS }} calls of this service. They are saved on this computer as they arrive, so they are
          still there after ApiKit restarts; only a summary of each call stays in memory.
        </span>
        <div class="flex items-center gap-2 text-xs text-surface-500">
          {{ logCount }} of {{ MAX_MOCK_LOGS }} calls
          <Button label="Clear Logs" size="small" severity="secondary" :disabled="logCount === 0" @click="mocksStore.clearLogs(service.id)" />
        </div>
      </div>

      <div class="flex gap-2 flex-wrap">
        <Button label="Duplicate Service" icon="pi pi-copy" size="small" severity="secondary" @click="duplicate" />
        <Button label="Delete Service" icon="pi pi-trash" size="small" severity="danger" outlined @click="remove" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-grid { grid-template-columns: 8.5rem minmax(0, 1fr); }
code { font-size: 12px; }
</style>
