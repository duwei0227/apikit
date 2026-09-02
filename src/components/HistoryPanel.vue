<script setup>
import { computed, ref } from 'vue';
import { useHistoryStore } from '@/stores/history';
import { getLocalDateKey } from '@/utils/history';

const props = defineProps({
  searchQuery: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['open-from-history']);
const historyStore = useHistoryStore();
const groupExpandedOverrides = ref(new Map());

const filteredHistoryItems = computed(() => {
  if (!props.searchQuery) return historyStore.history;

  const query = props.searchQuery.toLowerCase();
  return historyStore.history.filter(item =>
    String(item.url || '').toLowerCase().includes(query) ||
    String(item.method || '').toLowerCase().includes(query)
  );
});

const groupedHistoryItems = computed(() => {
  const groups = new Map();

  filteredHistoryItems.value.forEach(item => {
    const key = getLocalDateKey(item.timestamp);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  const today = getLocalDateKey(new Date().toISOString());
  return Array.from(groups.entries()).map(([date, items]) => ({
    date,
    label: date === today
      ? 'Today'
      : new Date(`${date}T00:00:00`).toLocaleDateString('zh-CN'),
    expanded: groupExpandedOverrides.value.get(date) ?? date === today,
    items,
  }));
});

const toggleGroup = (group) => {
  const overrides = new Map(groupExpandedOverrides.value);
  overrides.set(group.date, !group.expanded);
  groupExpandedOverrides.value = overrides;
};

const getMethodColor = (method) => {
  const colors = {
    'GET': 'text-green-600 dark:text-green-400',
    'POST': 'text-blue-600 dark:text-blue-400',
    'PUT': 'text-yellow-600 dark:text-yellow-400',
    'DELETE': 'text-red-600 dark:text-red-400',
    'PATCH': 'text-purple-600 dark:text-purple-400',
  };
  return colors[method] || 'text-surface-600';
};

const getStatusColor = (status) => {
  if (status >= 200 && status < 300) return 'text-green-600 dark:text-green-400';
  if (status >= 400) return 'text-red-600 dark:text-red-400';
  return 'text-yellow-600 dark:text-yellow-400';
};

const openFromHistory = (historyItem) => {
  emit('open-from-history', historyItem);
};

const clearHistory = () => historyStore.clearHistory();
</script>

<template>
  <div class="p-2">
    <div v-if="historyStore.history.length > 0" class="flex justify-end mb-1">
      <button
        @click="clearHistory"
        class="text-xs text-surface-400 dark:text-surface-500 hover:text-red-500 dark:hover:text-red-400 transition"
      >
        Clear All
      </button>
    </div>
    <div v-if="filteredHistoryItems.length === 0" class="text-surface-500 dark:text-surface-400 text-xs text-center py-4">
      {{ searchQuery ? 'No matching history found' : 'No history yet' }}
    </div>
    <template v-for="group in groupedHistoryItems" :key="group.date">
      <button
        type="button"
        class="w-full flex items-center gap-1 text-xs font-semibold text-surface-400 dark:text-surface-500 px-1 pt-2 pb-1 select-none hover:text-surface-600 dark:hover:text-surface-300 transition"
        :aria-expanded="group.expanded"
        @click="toggleGroup(group)"
      >
        <i :class="['pi text-badge', group.expanded ? 'pi-chevron-down' : 'pi-chevron-right']" />
        <span>{{ group.label }}</span>
        <span class="ml-auto font-normal">{{ group.items.length }}</span>
      </button>
      <div
        v-for="item in group.expanded ? group.items : []"
        :key="item.id"
        @dblclick="openFromHistory(item)"
        class="p-2 mb-1 rounded hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer transition"
      >
        <div class="flex items-center gap-2 mb-1">
          <span :class="['text-badge font-semibold', getMethodColor(item.method)]">
            {{ item.method }}
          </span>
          <span :class="['text-meta', getStatusColor(item.status)]">
            {{ item.status }}
          </span>
        </div>
        <div class="text-xs text-surface-700 dark:text-surface-300 truncate mb-1">
          {{ item.url }}
        </div>
        <div class="text-meta text-surface-500 dark:text-surface-400">
          {{ new Date(item.timestamp).toLocaleString('zh-CN') }}
        </div>
      </div>
    </template>
  </div>
</template>
