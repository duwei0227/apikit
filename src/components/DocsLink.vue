<script setup lang="ts">
// 打开文档站中对应章节的 ? 图标按钮
import { openUrl } from '@tauri-apps/plugin-opener';
import { docsTopicUrl, type DocTopic } from '@/utils/appLinks';

const props = defineProps<{ topic: DocTopic }>();

const open = () => {
  openUrl(docsTopicUrl(props.topic, navigator.language)).catch(error => console.error('Failed to open documentation:', error));
};
</script>

<template>
  <Button
    icon="pi pi-question-circle"
    text
    rounded
    size="small"
    severity="secondary"
    class="docs-link"
    aria-label="Open documentation"
    title="Open documentation"
    :data-docs-topic="topic"
    @click.stop="open"
  />
</template>

<style scoped>
.docs-link {
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  flex-shrink: 0;
}
</style>
