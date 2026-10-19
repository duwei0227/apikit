<script setup lang="ts">
import { dialogStyle } from '@/utils/dialogSize';
import { computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Update } from '@tauri-apps/plugin-updater';

/** 更新弹窗用到的更新信息（Tauri 更新插件的 Update） */
type UpdateInfo = Pick<Update, 'version' | 'currentVersion' | 'date' | 'body'>;

interface NoteGroup {
  label: string;
  cls: string;
  items: string[];
}

const props = withDefaults(defineProps<{
  visible?: boolean;
  updateInfo?: UpdateInfo | null;
  downloading?: boolean;
  downloadProgress?: number;
}>(), {
  visible: false,
  updateInfo: null,
  downloading: false,
  downloadProgress: 0
});

const emit = defineEmits<{
  'update:visible': [visible: boolean];
  install: [];
  cancel: [];
}>();

// CHANGELOG 中的 ### 分组标题 → 弹窗中的标签
const GROUPS = [
  { label: 'New', cls: 'tag-new', match: /^(added|new|features?|新增)/i },
  { label: 'Changed', cls: 'tag-changed', match: /^(changed|changes|变更)/i },
  { label: 'Fixed', cls: 'tag-fixed', match: /^(fixed|fixes|bug ?fixes|修复)/i }
];

const localVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
});

// 不使用异步扩展时 marked 同步返回字符串
const renderInline = (text: string) => DOMPurify.sanitize(marked.parseInline(text, { async: false }));

// 将 Keep a Changelog 格式的 notes 解析为分组列表；无法识别时返回 null，退回整段 Markdown 渲染
const noteGroups = computed(() => {
  const body = props.updateInfo?.body?.trim();
  if (!body) return null;

  const groups: NoteGroup[] = [];
  let current: NoteGroup | null = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = line.match(/^#{2,4}\s+(.+)$/);
    if (heading) {
      const title = heading[1].trim();
      const known = GROUPS.find(g => g.match.test(title));
      current = { label: known?.label ?? title, cls: known?.cls ?? 'tag-other', items: [] };
      groups.push(current);
      continue;
    }
    const item = line.match(/^\s*[-*]\s+(.+)$/);
    if (item) {
      if (!current) {
        current = { label: 'Changes', cls: 'tag-other', items: [] };
        groups.push(current);
      }
      current.items.push(item[1]);
    } else if (line.trim() && current?.items.length) {
      // 列表项的续行
      current.items[current.items.length - 1] += ' ' + line.trim();
    }
  }

  const filled = groups
    .filter(g => g.items.length)
    .map(g => ({ ...g, items: g.items.map(renderInline) }));
  return filled.length ? filled : null;
});

const fallbackNotes = computed(() => {
  const body = props.updateInfo?.body?.trim();
  if (!body || noteGroups.value) return '';
  try {
    return DOMPurify.sanitize(marked.parse(body, { breaks: true, gfm: true, async: false }));
  } catch (error) {
    console.error('Failed to parse markdown:', error);
    return DOMPurify.sanitize(body);
  }
});

const handleInstall = () => {
  emit('install');
};

const handleCancel = () => {
  emit('cancel');
  localVisible.value = false;
};

const formatDate = (dateString: string | undefined) => {
  if (!dateString) return '';
  const iso = String(dateString).match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const date = new Date(dateString);
  return Number.isNaN(date.getTime()) ? String(dateString) : date.toISOString().slice(0, 10);
};
</script>

<template>
  <Dialog
    v-model:visible="localVisible"
    modal
    :closable="!downloading"
    :closeOnEscape="!downloading"
    :style="dialogStyle('lg')"
    :contentStyle="{ maxHeight: '60vh' }"
  >
    <template #header>
      <div class="flex flex-col gap-1.5">
        <span class="text-lg font-semibold">Update Available</span>
        <div v-if="updateInfo" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-surface-500 dark:text-surface-400">
          <span class="flex items-center gap-1.5 font-mono">
            <span v-if="updateInfo.currentVersion">{{ updateInfo.currentVersion }}</span>
            <i v-if="updateInfo.currentVersion" class="pi pi-arrow-right text-[10px]"></i>
            <span class="px-2 py-0.5 rounded-md bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-0 font-medium">
              {{ updateInfo.version }}
            </span>
          </span>
          <template v-if="formatDate(updateInfo.date)">
            <span class="w-[3px] h-[3px] rounded-full bg-surface-400"></span>
            <span class="tabular-nums">{{ formatDate(updateInfo.date) }}</span>
          </template>
        </div>
      </div>
    </template>

    <div v-if="updateInfo" class="flex flex-col gap-3">
      <!-- Grouped release notes -->
      <template v-if="noteGroups">
        <div class="flex flex-wrap gap-1.5">
          <span v-for="group in noteGroups" :key="'sum-' + group.label" class="tag" :class="group.cls">
            {{ group.items.length }} {{ group.label.toLowerCase() }}
          </span>
        </div>
        <div class="flex flex-col gap-4 p-4 rounded-lg border border-surface-200 dark:border-surface-700">
          <div v-for="group in noteGroups" :key="group.label" class="flex flex-col gap-1.5">
            <div><span class="tag" :class="group.cls">{{ group.label }}</span></div>
            <ul class="notes-list">
              <li v-for="(item, index) in group.items" :key="index" v-html="item"></li>
            </ul>
          </div>
        </div>
      </template>

      <!-- Notes that don't follow the changelog format -->
      <div
        v-else-if="fallbackNotes"
        class="p-4 rounded-lg border border-surface-200 dark:border-surface-700 prose prose-sm dark:prose-invert max-w-none"
        v-html="fallbackNotes"
      ></div>
    </div>

    <template #footer>
      <div class="flex flex-col gap-4 w-full">
        <!-- Download progress -->
        <div v-if="downloading" class="flex flex-col gap-2">
          <div class="flex items-center justify-between text-sm">
            <span class="text-surface-500 dark:text-surface-400">Downloading update…</span>
            <span class="font-medium tabular-nums">{{ downloadProgress }}%</span>
          </div>
          <ProgressBar :value="downloadProgress" :showValue="false" style="height: 6px" />
        </div>

        <div class="flex items-center justify-end gap-2">
          <Button
            label="Later"
            severity="secondary"
            @click="handleCancel"
            :disabled="downloading"
          />
          <Button
            :label="downloading ? 'Downloading…' : 'Install & Restart'"
            icon="pi pi-download"
            @click="handleInstall"
            :loading="downloading"
            :disabled="downloading"
          />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.tag {
  display: inline-block;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  padding: 1px 8px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}

.tag-new { color: #15803d; background: #e8f6ee; }
.tag-changed { color: #1d4ed8; background: #e8effd; }
.tag-fixed { color: #b45309; background: #fdf1e3; }
.tag-other { color: var(--p-surface-600); background: var(--p-surface-100); }

:global(.p-dark) .tag-new { color: #4ade80; background: #16301f; }
:global(.p-dark) .tag-changed { color: #93b4ff; background: #1b2a4a; }
:global(.p-dark) .tag-fixed { color: #f5b469; background: #3a2814; }
:global(.p-dark) .tag-other { color: var(--p-surface-300); background: var(--p-surface-800); }

.notes-list {
  margin: 0;
  padding-left: 1.25em;
  list-style: disc;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  line-height: 1.6;
}

.notes-list :deep(code) {
  font-family: 'JetBrains Mono Variable', 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  background-color: var(--p-surface-100);
  padding: 0.1em 0.35em;
  border-radius: 4px;
}

:global(.p-dark) .notes-list :deep(code) {
  background-color: var(--p-surface-800);
}

.prose :deep(h2),
.prose :deep(h3) {
  font-size: 14px;
  font-weight: 600;
  margin: 0.75em 0 0.4em;
}

.prose :deep(ul) {
  padding-left: 1.25em;
  list-style: disc;
}
</style>
