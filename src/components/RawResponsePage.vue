<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import CodeEditor from './CodeEditor.vue';
import type { TextMatch } from '@/utils/textSearch';
const props = defineProps<{ modelValue: string; wrapLines: boolean; searchMatches: TextMatch[]; currentMatchIndex: number }>();
const emit = defineEmits<{ 'ctrl-f': [selectedText: string] }>();
const PAGE_SIZE = 8192;
const page = ref(0);
const count = computed(() => Math.max(1, Math.ceil(props.modelValue.length / PAGE_SIZE)));
// 不在 UTF-16 代理对中间切开显示段。
const boundary = (offset: number) => {
  const code = props.modelValue.charCodeAt(offset);
  return code >= 0xdc00 && code <= 0xdfff ? offset - 1 : offset;
};
const start = computed(() => boundary(page.value * PAGE_SIZE));
const end = computed(() => boundary(Math.min((page.value + 1) * PAGE_SIZE, props.modelValue.length)));
const text = computed(() => props.modelValue.slice(start.value, end.value));
const matches = computed(() => props.searchMatches.flatMap((match, index) => {
  const from = Math.max(match.index, start.value);
  const to = Math.min(match.index + match.length, end.value);
  return from < to ? [{ ...match, index: from - start.value, length: to - from, sourceIndex: index }] : [];
}));
const current = computed(() => matches.value.findIndex(match => match.sourceIndex === props.currentMatchIndex));
watch(() => props.modelValue, () => { page.value = 0; });
watch(() => [props.searchMatches, props.currentMatchIndex], () => {
  const match = props.searchMatches[props.currentMatchIndex];
  if (match) page.value = Math.floor(match.index / PAGE_SIZE);
});
</script>
<template>
  <div class="flex flex-col min-h-0 min-w-0">
    <div class="flex items-center gap-2 text-xs mb-2 shrink-0">
      <Button label="Previous part" size="small" text :disabled="page === 0" @click="page--" />
      <span>Part {{ page + 1 }} / {{ count }} · Copy Raw Response copies the full body</span>
      <Button label="Next part" size="small" text :disabled="page + 1 >= count" @click="page++" />
    </div>
    <CodeEditor class="flex-1" style="min-height: 0" :modelValue="text" language="text" :readOnly="true" :wrapLines="wrapLines"
      :searchMatches="matches" :currentMatchIndex="current" @ctrl-f="emit('ctrl-f', $event)" />
  </div>
</template>
