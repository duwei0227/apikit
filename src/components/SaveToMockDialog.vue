<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMocksStore } from '@/stores/mocks';
import type { HttpMethod, HttpResponseView } from '@/types/models';
import { createMockService, nextFreeMockPort } from '@/utils/mockFactory';
import { mockPathFromUrl, mockResponseFromObserved } from '@/utils/mockFromRequests';
import { mockRouteLabel } from '@/utils/mockMatching';

const visible = defineModel<boolean>('visible', { required: true });
const props = defineProps<{
  response: HttpResponseView;
  method: HttpMethod;
  url: string;
  requestName: string;
}>();

const mocksStore = useMocksStore();
const NEW_SERVICE = '__new__';
const NEW_ROUTE = '__new__';

const serviceId = ref<string>(NEW_SERVICE);
const routeId = ref<string>(NEW_ROUTE);
const path = ref('/');
const name = ref('');
const keepHeaders = ref(false);
const makeDefault = ref(false);
const isSaving = ref(false);

const serviceOptions = computed(() => [
  ...mocksStore.services.map(service => ({ label: `${service.name} (:${service.port})`, value: service.id })),
  { label: 'New mock service', value: NEW_SERVICE },
]);
const service = computed(() => mocksStore.getService(serviceId.value));
const routeOptions = computed(() => [
  ...(service.value?.routes || []).map(route => ({ label: mockRouteLabel(route), value: route.id })),
  { label: `New route: ${props.method} ${path.value}`, value: NEW_ROUTE },
]);

watch(visible, (open) => {
  if (!open) return;
  path.value = mockPathFromUrl(props.url);
  name.value = `${props.response.status} ${props.response.statusText || props.requestName || 'Response'}`.trim();
  keepHeaders.value = false;
  makeDefault.value = false;
  serviceId.value = mocksStore.activeServiceId && mocksStore.getService(mocksStore.activeServiceId)
    ? mocksStore.activeServiceId
    : mocksStore.services[0]?.id || NEW_SERVICE;
}, { immediate: true });

// 选中服务后预选与这个请求路径匹配的路由
watch([serviceId, visible], () => {
  const route = mocksStore.findRouteFor(serviceId.value, props.method, path.value);
  routeId.value = route?.id || NEW_ROUTE;
}, { immediate: true });

const save = async () => {
  isSaving.value = true;
  try {
    let targetId = serviceId.value;
    if (targetId === NEW_SERVICE) {
      const created = await mocksStore.createService(createMockService({
        name: 'Mock Service',
        port: nextFreeMockPort(mocksStore.services),
      }));
      targetId = created.id;
    }
    const route = routeId.value === NEW_ROUTE ? null : service.value?.routes.find(item => item.id === routeId.value);
    const response = mockResponseFromObserved({
      method: props.method,
      url: props.url,
      status: props.response.status,
      headers: props.response.headers,
      body: props.response.rawBody,
    }, name.value.trim() || 'Response', keepHeaders.value);
    response.isDefault = makeDefault.value;
    await mocksStore.addResponse(targetId, route?.method || props.method, route?.path || path.value, response);
    const target = mocksStore.getService(targetId);
    window.$toast?.add({
      severity: 'success',
      summary: 'Saved to Mock',
      detail: `Added "${response.name}" to ${target?.name || 'the mock service'}`,
      life: 2500,
    });
    visible.value = false;
  } finally {
    isSaving.value = false;
  }
};
</script>

<template>
  <Dialog v-model:visible="visible" header="Save Response to a Mock" modal :style="{ width: '30rem' }" :dismissable-mask="true">
    <div class="flex flex-col gap-3 text-sm">
      <label class="flex flex-col gap-1 text-xs text-surface-500">Mock service
        <Select v-model="serviceId" :options="serviceOptions" option-label="label" option-value="value" aria-label="Mock service" />
      </label>
      <label class="flex flex-col gap-1 text-xs text-surface-500">Route
        <Select v-model="routeId" :options="routeOptions" option-label="label" option-value="value" aria-label="Route" />
      </label>
      <label v-if="routeId === NEW_ROUTE" class="flex flex-col gap-1 text-xs text-surface-500">Path
        <InputText v-model="path" class="font-mono" aria-label="Path" />
      </label>
      <label class="flex flex-col gap-1 text-xs text-surface-500">Response name
        <InputText v-model="name" aria-label="Response name" />
      </label>
      <label class="flex items-center gap-2"><Checkbox v-model="keepHeaders" binary /> Keep response headers</label>
      <label class="flex items-center gap-2"><Checkbox v-model="makeDefault" binary /> Make it the default response</label>
      <span class="text-xs text-amber-700 dark:text-amber-400">Response bodies can hold real data such as tokens; check before serving them.</span>
    </div>
    <template #footer>
      <Button label="Cancel" severity="secondary" @click="visible = false" />
      <Button label="Save" :loading="isSaving" @click="save" />
    </template>
  </Dialog>
</template>
