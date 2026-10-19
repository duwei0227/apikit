<script setup lang="ts">
import { computed, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { useContextMenuEscape } from '@/composables/useContextMenuEscape';
import { useMocksStore } from '@/stores/mocks';
import type { MockService } from '@/types/models';

const props = withDefaults(defineProps<{ searchQuery?: string }>(), { searchQuery: '' });

const emit = defineEmits<{
  'new-mock': [];
  'open-mock': [serviceId: string];
  'mock-deleted': [serviceId: string];
}>();

const confirm = useConfirm();
const mocksStore = useMocksStore();
const contextMenu = ref<{ show: (event: Event) => void; hide: () => void } | null>(null);
const { onShow: onContextMenuShow, onHide: onContextMenuHide } = useContextMenuEscape(contextMenu);
const menuService = ref<MockService | null>(null);

const filteredServices = computed(() => {
  const query = props.searchQuery.trim().toLowerCase();
  if (!query) return mocksStore.services;
  return mocksStore.services.filter(service => service.name.toLowerCase().includes(query)
    || String(service.port).includes(query)
    || service.routes.some(route => route.path.toLowerCase().includes(query)));
});

type ServiceState = 'running' | 'error' | 'stopped';
const stateOf = (service: MockService): ServiceState => {
  if (mocksStore.errors[service.id]) return 'error';
  return mocksStore.running[service.id] ? 'running' : 'stopped';
};

const infoOf = (service: MockService) => {
  const error = mocksStore.errors[service.id];
  if (error) return error;
  const routes = `${service.routes.length} route${service.routes.length === 1 ? '' : 's'}`;
  if (!mocksStore.running[service.id]) return `${routes} · Stopped`;
  const calls = mocksStore.logs[service.id]?.length || 0;
  return `${routes} · ${calls} call${calls === 1 ? '' : 's'}`;
};

const isActive = (service: MockService) => mocksStore.activeServiceId === service.id;

const openService = (service: MockService) => {
  mocksStore.activeServiceId = service.id;
  emit('open-mock', service.id);
};

const toggleRunning = async (service: MockService) => {
  if (mocksStore.running[service.id]) await mocksStore.stop(service.id);
  else await mocksStore.start(service.id);
};

const deleteService = (service: MockService) => {
  confirm.require({
    message: `Are you sure you want to delete "${service.name}"? Its routes and logs are deleted too.`,
    header: 'Confirm Deletion',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await mocksStore.deleteService(service.id);
      emit('mock-deleted', service.id);
    },
  });
};

const menuItems = computed(() => {
  const service = menuService.value;
  if (!service) return [];
  const isRunning = Boolean(mocksStore.running[service.id]);
  return [
    { label: 'Open', icon: 'pi pi-external-link', command: () => openService(service) },
    { label: isRunning ? 'Stop' : 'Start', icon: isRunning ? 'pi pi-stop-circle' : 'pi pi-play', command: () => toggleRunning(service) },
    { separator: true },
    {
      label: 'Duplicate',
      icon: 'pi pi-copy',
      command: async () => {
        const copy = await mocksStore.duplicateService(service.id);
        if (copy) openService(copy);
      },
    },
    { separator: true },
    { label: 'Delete', icon: 'pi pi-trash', class: 'text-red-600', command: () => deleteService(service) },
  ];
});

const showMenu = (event: MouseEvent, service: MockService) => {
  event.preventDefault();
  menuService.value = service;
  contextMenu.value?.show(event);
};
</script>

<template>
  <div class="p-2 bg-surface-0 dark:bg-surface-950">
    <div class="mb-2">
      <Button label="New Mock Service" icon="pi pi-plus" size="small" class="w-full" @click="emit('new-mock')" />
    </div>

    <div v-if="filteredServices.length === 0" class="text-surface-500 dark:text-surface-400 text-xs text-center py-4">
      {{ searchQuery ? 'No matching mock services found' : 'No mock services yet' }}
    </div>

    <div v-else class="space-y-1">
      <div
        v-for="service in filteredServices"
        :key="service.id"
        role="button"
        tabindex="0"
        class="mock-service-row w-full flex items-center gap-2 border-l-4 px-2 py-2 rounded text-left transition-colors cursor-pointer"
        :class="isActive(service)
          ? 'border-primary-500 bg-primary-100 text-primary-950 shadow-sm dark:border-primary-400 dark:bg-primary-900/55 dark:text-primary-50'
          : 'border-transparent text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-800'"
        :data-mock-service="service.name"
        @click="openService(service)"
        @keydown.enter="openService(service)"
        @contextmenu="showMenu($event, service)"
      >
        <span class="mock-status-dot shrink-0" :class="stateOf(service)" :title="stateOf(service)"></span>
        <span class="flex-1 min-w-0 flex flex-col">
          <span class="flex items-center gap-2 min-w-0">
            <span class="truncate text-sm" :class="{ 'font-semibold': isActive(service) }">{{ service.name }}</span>
            <span class="ml-auto font-mono text-xs text-surface-500 dark:text-surface-400">:{{ service.port }}</span>
          </span>
          <span
            class="truncate text-xs"
            :class="stateOf(service) === 'error' ? 'text-red-600 dark:text-red-400' : 'text-surface-500 dark:text-surface-400'"
          >{{ infoOf(service) }}</span>
        </span>
        <Button
          :icon="mocksStore.running[service.id] ? 'pi pi-stop-circle' : 'pi pi-play'"
          text
          rounded
          size="small"
          severity="secondary"
          :title="mocksStore.running[service.id] ? 'Stop' : 'Start'"
          @click.stop="toggleRunning(service)"
        />
      </div>
    </div>

    <ContextMenu ref="contextMenu" :model="menuItems" @before-show="onContextMenuShow" @hide="onContextMenuHide" />
  </div>
</template>

<style scoped>
.mock-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--p-surface-300);
}
.mock-status-dot.running {
  background: #16a34a;
}
.mock-status-dot.error {
  background: #dc2626;
}
</style>
