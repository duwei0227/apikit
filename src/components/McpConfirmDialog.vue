<script setup lang="ts">
import { dialogStyle } from '@/utils/dialogSize';
import { computed, watch } from 'vue';
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';
import { useMcpStore } from '@/stores/mcp';

const mcpStore = useMcpStore();
const confirmation = computed(() => mcpStore.currentConfirmation);
const queuedCount = computed(() => Math.max(0, mcpStore.pendingConfirmations.length - 1));

// 有新的确认请求时提醒用户（任务栏闪烁），不抢焦点
watch(() => confirmation.value?.id, (id) => {
  if (!id) return;
  getCurrentWindow().requestUserAttention(UserAttentionType.Informational).catch(() => {});
});

const answer = (value: 'deny' | 'allow' | 'allowAll') => {
  if (confirmation.value) mcpStore.answerConfirmation(confirmation.value.id, value);
};
</script>

<template>
  <Dialog
    :visible="!!confirmation"
    :header="confirmation?.title || ''"
    :modal="true"
    :closable="false"
    :style="dialogStyle('sm')"
  >
    <div v-if="confirmation" class="flex flex-col gap-3 text-sm">
      <div class="grid grid-cols-[3.5rem_1fr] gap-x-3 gap-y-1.5">
        <span class="text-surface-500 dark:text-surface-400">Tool</span>
        <code class="font-mono text-xs self-center">{{ confirmation.tool }}</code>
        <span class="text-surface-500 dark:text-surface-400">Target</span>
        <span class="font-mono text-xs break-all self-center">{{ confirmation.detail }}</span>
      </div>
      <p class="m-0 text-xs text-surface-500 dark:text-surface-400">
        {{ confirmation.note || 'This makes real network requests with your active environment.' }}
        <template v-if="queuedCount > 0">{{ queuedCount }} more waiting.</template>
      </p>
    </div>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <Button label="Deny" severity="secondary" @click="answer('deny')" />
        <Button v-if="!confirmation?.destructive" label="Allow All This Session" severity="secondary" @click="answer('allowAll')" />
        <Button
          :label="confirmation?.destructive ? 'Delete' : 'Allow'"
          :severity="confirmation?.destructive ? 'danger' : undefined"
          autofocus
          @click="answer('allow')"
        />
      </div>
    </template>
  </Dialog>
</template>
