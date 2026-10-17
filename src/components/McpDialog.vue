<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMcpStore } from '@/stores/mcp';
import { MCP_TOOLS } from '@/services/mcp/tools';
import DocsLink from './DocsLink.vue';

withDefaults(defineProps<{ visible?: boolean }>(), { visible: false });

const emit = defineEmits<{ 'update:visible': [visible: boolean] }>();

const mcpStore = useMcpStore();
const portInput = ref(String(mcpStore.settings.port));
const portError = ref('');
// Token、Header 和 JSON 配置共用一个显示/隐藏状态
const showToken = ref(false);
const isBusy = ref(false);

watch(() => mcpStore.settings.port, (port) => {
  portInput.value = String(port);
});

const statusLabel = computed(() => ({ running: 'Running', error: 'Error', stopped: 'Stopped' })[mcpStore.status]);

const maskedToken = computed(() => (
  showToken.value ? mcpStore.settings.token : '•'.repeat(24)
));

// 显示时跟随 token 的显示/隐藏，复制时始终使用真实 token
const authHeader = (token: string) => `Authorization: Bearer ${token}`;

const jsonConfig = (token: string) => JSON.stringify({
  mcpServers: {
    apikit: {
      type: 'http',
      url: mcpStore.endpoint,
      headers: { Authorization: `Bearer ${token}` }
    }
  }
}, null, 2);

const toolGroups = computed(() => [
  { label: 'Read', tools: MCP_TOOLS.filter(tool => tool.kind === 'read') },
  { label: 'Create and edit', tools: MCP_TOOLS.filter(tool => tool.kind === 'write' && !tool.destructive) },
  { label: 'Run (asks you first)', tools: MCP_TOOLS.filter(tool => tool.kind === 'execute') },
  { label: 'Delete (asks you every time)', tools: MCP_TOOLS.filter(tool => tool.destructive) },
]);

const closeDialog = () => {
  emit('update:visible', false);
};

const copy = async (text: string, label: string) => {
  try {
    await navigator.clipboard.writeText(text);
    window.$toast?.add({ severity: 'success', summary: 'Copied', detail: `${label} copied to clipboard`, life: 2000 });
  } catch {
    window.$toast?.add({ severity: 'error', summary: 'Error', detail: 'Failed to copy to clipboard', life: 3000 });
  }
};

const runBusy = async (action: () => Promise<unknown>) => {
  isBusy.value = true;
  try {
    await action();
  } finally {
    isBusy.value = false;
  }
};

const toggleEnabled = (enabled: boolean) => runBusy(() => mcpStore.setEnabled(enabled));

const applyPort = () => runBusy(async () => {
  portError.value = '';
  try {
    await mcpStore.setPort(Number(portInput.value));
  } catch (error) {
    portError.value = error instanceof Error ? error.message : String(error);
  }
});

const regenerateToken = () => {
  window.$confirm?.require({
    header: 'Regenerate Token',
    message: 'Clients that use the current token will stop working until you update them. Continue?',
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' },
    acceptProps: { label: 'Regenerate' },
    accept: () => runBusy(() => mcpStore.regenerateToken())
  });
};

const formatTime = (iso: string) => new Date(iso).toLocaleTimeString();
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="closeDialog"
    header="AI Integration (MCP)"
    :modal="true"
    :style="{ width: '70vw' }"
    :dismissableMask="true"
  >
    <div class="flex flex-col gap-4 text-sm">
      <p class="m-0 text-surface-600 dark:text-surface-400">
        Any AI tool that supports MCP (Model Context Protocol) can connect to ApiKit while it is open, to read and edit
        your collections and workflows, send requests, and run workflows. The server only accepts connections from this computer.
        <DocsLink topic="mcp" class="align-middle" />
      </p>

      <!-- Server -->
      <div class="flex flex-col gap-3 rounded border border-surface-200 dark:border-surface-700 p-3">
        <div class="flex items-center justify-between gap-3">
          <label class="flex items-center gap-3 cursor-pointer select-none">
            <ToggleSwitch
              :modelValue="mcpStore.settings.enabled"
              :disabled="isBusy"
              @update:modelValue="toggleEnabled"
            />
            <span class="font-medium">Enable MCP server</span>
          </label>
          <span class="mcp-status" :class="statusLabel.toLowerCase()">
            <span class="mcp-status-dot"></span>{{ statusLabel }}
          </span>
        </div>

        <div v-if="mcpStore.startError" class="mcp-note warn">
          <i class="pi pi-exclamation-triangle mt-0.5"></i>
          <span>{{ mcpStore.startError }}</span>
        </div>

        <div class="grid grid-cols-[4.5rem_1fr] items-center gap-x-3 gap-y-2">
          <span class="text-surface-500 dark:text-surface-400">Port</span>
          <div class="flex items-center gap-2">
            <InputText v-model="portInput" class="w-28 font-mono" size="small" @keydown.enter="applyPort" />
            <Button
              v-if="portInput !== String(mcpStore.settings.port)"
              label="Apply"
              size="small"
              severity="secondary"
              :disabled="isBusy"
              @click="applyPort"
            />
            <span v-if="portError" class="text-xs text-red-500">{{ portError }}</span>
          </div>

          <span class="text-surface-500 dark:text-surface-400">Token</span>
          <div class="flex items-center gap-2 min-w-0">
            <code class="flex-1 min-w-0 truncate font-mono text-xs">{{ maskedToken }}</code>
            <Button
              :icon="showToken ? 'pi pi-eye-slash' : 'pi pi-eye'"
              size="small"
              text
              severity="secondary"
              :title="showToken ? 'Hide token' : 'Show token'"
              @click="showToken = !showToken"
            />
            <Button label="Copy" size="small" severity="secondary" @click="copy(mcpStore.settings.token, 'Token')" />
            <Button label="Regenerate" size="small" severity="secondary" :disabled="isBusy" @click="regenerateToken" />
          </div>
        </div>
      </div>

      <!-- Connect -->
      <div class="flex flex-col gap-2">
        <span class="font-medium">Connect</span>
        <p class="m-0 text-xs text-surface-500 dark:text-surface-400">
          Add a server to your AI tool's MCP settings with these values.
        </p>
        <div class="grid grid-cols-[4.5rem_1fr_auto] items-center gap-x-3 gap-y-1.5">
          <span class="text-surface-500 dark:text-surface-400">Transport</span>
          <span>Streamable HTTP</span>
          <span></span>

          <span class="text-surface-500 dark:text-surface-400">URL</span>
          <code class="min-w-0 truncate font-mono text-xs">{{ mcpStore.endpoint }}</code>
          <Button label="Copy" size="small" text class="justify-self-end" @click="copy(mcpStore.endpoint, 'URL')" />

          <span class="text-surface-500 dark:text-surface-400">Header</span>
          <code class="min-w-0 font-mono text-xs" :class="showToken ? 'break-all' : 'truncate'">{{ authHeader(maskedToken) }}</code>
          <div class="flex items-center justify-self-end">
            <Button
              :icon="showToken ? 'pi pi-eye-slash' : 'pi pi-eye'"
              size="small"
              text
              severity="secondary"
              :title="showToken ? 'Hide token' : 'Show token'"
              @click="showToken = !showToken"
            />
            <Button label="Copy" size="small" text @click="copy(authHeader(mcpStore.settings.token), 'Header')" />
          </div>
        </div>
        <div class="flex items-center justify-between gap-2 mt-1">
          <span class="text-xs text-surface-500 dark:text-surface-400">
            JSON config (mcpServers format). Some tools use different field names; check their MCP docs.
          </span>
          <div class="flex items-center shrink-0">
            <Button
              :icon="showToken ? 'pi pi-eye-slash' : 'pi pi-eye'"
              size="small"
              text
              severity="secondary"
              :title="showToken ? 'Hide token' : 'Show token'"
              @click="showToken = !showToken"
            />
            <Button label="Copy" size="small" text @click="copy(jsonConfig(mcpStore.settings.token), 'Config')" />
          </div>
        </div>
        <pre class="mcp-code">{{ jsonConfig(maskedToken) }}</pre>
      </div>

      <!-- Privacy -->
      <label class="flex items-start gap-2 cursor-pointer select-none">
        <Checkbox
          :modelValue="mcpStore.settings.revealSecrets"
          :binary="true"
          class="mt-0.5"
          @update:modelValue="mcpStore.setRevealSecrets"
        />
        <span>
          Show variable values and credentials to AI
          <span class="block text-xs text-surface-500 dark:text-surface-400">
            When off, environment variable values, auth tokens, passwords and secret headers are sent as
            <code class="whitespace-nowrap">&lt;hidden&gt;</code>.
            Requests still use the real values when they run.
          </span>
        </span>
      </label>

      <!-- Confirmation -->
      <div class="flex flex-col gap-1.5">
        <span>Confirm requests, workflow runs and environment switches</span>
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <RadioButton
            :modelValue="mcpStore.settings.confirmIn"
            inputId="mcp-confirm-apikit"
            value="apikit"
            @update:modelValue="mcpStore.setConfirmIn"
          />
          <span>In ApiKit</span>
        </label>
        <label class="flex items-start gap-2 cursor-pointer select-none">
          <RadioButton
            :modelValue="mcpStore.settings.confirmIn"
            inputId="mcp-confirm-client"
            value="client"
            class="mt-0.5"
            @update:modelValue="mcpStore.setConfirmIn"
          />
          <span>
            In the AI tool, when it supports it
            <span class="block text-xs text-surface-500 dark:text-surface-400">
              Falls back to ApiKit when the AI tool cannot ask.
              The AI tool decides how it asks; check that it does not accept automatically.
            </span>
          </span>
        </label>
      </div>

      <!-- AI edits -->
      <div class="flex flex-col gap-1.5">
        <span>Changes the AI makes to requests and workflows</span>
        <label class="flex items-start gap-2 cursor-pointer select-none">
          <RadioButton
            :modelValue="mcpStore.settings.stageEdits"
            inputId="mcp-edits-stage"
            :value="true"
            class="mt-0.5"
            @update:modelValue="mcpStore.setStageEdits"
          />
          <span>
            Keep as unsaved edits
            <span class="block text-xs text-surface-500 dark:text-surface-400">
              Shown as unsaved in ApiKit; Save to keep them, Discard to undo.
              New requests and workflows the AI creates are saved directly.
            </span>
          </span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <RadioButton
            :modelValue="mcpStore.settings.stageEdits"
            inputId="mcp-edits-save"
            :value="false"
            @update:modelValue="mcpStore.setStageEdits"
          />
          <span>Save directly</span>
        </label>
      </div>

      <!-- Tools -->
      <details class="mcp-details">
        <summary class="cursor-pointer font-medium">Available tools ({{ MCP_TOOLS.length }})</summary>
        <div class="mt-2 flex flex-col gap-2">
          <div v-for="group in toolGroups" :key="group.label">
            <div class="text-xs text-surface-500 dark:text-surface-400 mb-1">{{ group.label }}</div>
            <div class="flex flex-wrap gap-1.5">
              <code v-for="tool in group.tools" :key="tool.name" class="mcp-tool" :title="tool.description">{{ tool.name }}</code>
            </div>
          </div>
        </div>
      </details>

      <!-- Recent calls -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="font-medium">Recent calls</span>
          <Button
            v-if="mcpStore.recentCalls.length > 0"
            label="Clear"
            size="small"
            text
            severity="secondary"
            @click="mcpStore.clearRecentCalls"
          />
        </div>
        <div v-if="mcpStore.recentCalls.length === 0" class="text-xs text-surface-500 dark:text-surface-400">
          No calls yet.
        </div>
        <div v-else class="mcp-calls">
          <div v-for="call in mcpStore.recentCalls" :key="call.id" class="mcp-call" :title="call.message || ''">
            <span class="text-surface-500 dark:text-surface-400 tabular-nums">{{ formatTime(call.time) }}</span>
            <code class="font-mono text-xs">{{ call.tool }}</code>
            <span class="flex-1 min-w-0 truncate">{{ call.summary }}</span>
            <span v-if="call.waitingInClient" class="text-xs text-surface-500 dark:text-surface-400 whitespace-nowrap">
              Waiting for approval in your AI tool
            </span>
            <i v-if="call.ok === null" class="pi pi-spin pi-spinner text-surface-400"></i>
            <i v-else-if="call.ok" class="pi pi-check text-green-600"></i>
            <i v-else class="pi pi-times text-red-500"></i>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <Button label="Close" severity="secondary" @click="closeDialog" />
    </template>
  </Dialog>
</template>

<style scoped>
.mcp-status {
  align-items: center;
  color: var(--p-text-muted-color);
  display: inline-flex;
  font-size: 0.75rem;
  gap: 0.375rem;
}

.mcp-status-dot {
  background: var(--p-surface-400);
  border-radius: 999px;
  height: 0.5rem;
  width: 0.5rem;
}

.mcp-status.running .mcp-status-dot {
  background: #16a34a;
}

.mcp-status.error .mcp-status-dot {
  background: #dc2626;
}

.mcp-code {
  background: var(--p-content-hover-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.25rem;
  font-family: 'JetBrains Mono Variable', ui-monospace, monospace;
  font-size: 11px;
  margin: 0;
  overflow-x: auto;
  padding: 0.5rem 0.625rem;
  white-space: pre;
}

.mcp-tool {
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.25rem;
  font-size: 11px;
  padding: 0 0.375rem;
}

.mcp-calls {
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.25rem;
  max-height: 12rem;
  overflow: auto;
}

.mcp-call {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  padding: 0.375rem 0.75rem;
}

.mcp-call + .mcp-call {
  border-top: 1px solid var(--p-content-border-color);
}

.mcp-note {
  align-items: flex-start;
  border-radius: 0.25rem;
  display: flex;
  font-size: 0.75rem;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
}

.mcp-note.warn {
  background: #fef3c7;
  color: #92400e;
}

.p-dark .mcp-note.warn {
  background: rgba(245, 158, 11, 0.15);
  color: #fcd34d;
}
</style>
