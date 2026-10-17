<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useRequestsStore } from '@/stores/requests';
import { debounce } from '@/utils/debounce';
import {
  prepareRequestForEditing,
  prepareRequestForPersistence,
  requestDraftFingerprint,
} from '@/utils/requestDraft';
import HttpRequest from './HttpRequest.vue';
import type { RequestSaveData } from '@/composables/useRequestSave';
import type { Collection, ConsoleLog, Request } from '@/types/models';

const props = withDefaults(defineProps<{
  requestId: string;
  isActive?: boolean;
  collections?: Collection[];
}>(), {
  isActive: false,
  collections: () => []
});

const emit = defineEmits<{
  close: [];
  'add-console-log': [log: ConsoleLog];
  'save-request': [saveData: RequestSaveData];
  'unsaved-changes': [hasChanges: boolean];
}>();

const requestsStore = useRequestsStore();

const request = ref<Request | null>(null);
const isLoading = ref(true);
const originalRequest = ref<Request | null>(null); // 保存原始请求用于比较
const originalFingerprint = ref('');
const httpRequestRef = ref<InstanceType<typeof HttpRequest> | null>(null); // HttpRequest 组件的引用
const editorRevision = ref(0); // 外部修改后递增，让编辑器按新内容重新挂载

// Load request from store
onMounted(async () => {
  try {
    const [loadedRequest, savedRequest] = await Promise.all([
      requestsStore.loadRequest(props.requestId),
      requestsStore.loadSavedRequest(props.requestId),
    ]);

    if (loadedRequest) {
      const editing = prepareRequestForEditing(loadedRequest);
      request.value = editing;
      updateOriginalBaseline(savedRequest || loadedRequest);
      const hasChangesNow = requestsStore.hasRequestDraft(props.requestId)
        || requestDraftFingerprint(editing) !== originalFingerprint.value;
      emit('unsaved-changes', hasChangesNow);
    } else {
      console.error('Request not found:', props.requestId);
      if (window.$toast) {
        window.$toast.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Request not found',
          life: 3000
        });
      }
    }
  } catch (error) {
    console.error('Failed to load request:', error);
  } finally {
    isLoading.value = false;
    performance.mark('editor-ready');
  }
});

// 监听 store 中的 request 变化（例如从 CollectionsPanel rename）
watch(
  () => requestsStore.requests.get(props.requestId)?.name,
  (newName) => {
    if (requestsStore.hasRequestDraft(props.requestId)) return;
    if (newName && request.value && newName !== request.value.name) {
      request.value.name = newName;
      if (originalRequest.value) {
        originalRequest.value.name = newName;
        originalFingerprint.value = requestDraftFingerprint(originalRequest.value);
      }
    }
  }
);

// 请求被外部（如 MCP）修改后载入新内容：直接保存时只在没有未保存修改时载入；
// 存为未保存修改时载入新的草稿，界面显示为未保存，由用户保存或丢弃
watch(
  () => requestsStore.externalRevisions[props.requestId],
  async () => {
    if (!request.value) return;
    const draft = requestsStore.getRequestDraft(props.requestId);
    if (!draft && hasChanges(request.value)) return;
    // 还没写入的自动保存会覆盖外部写入的草稿
    debouncedSaveToCache.cancel();
    const savedRequest = await requestsStore.loadSavedRequest(props.requestId);
    if (!savedRequest) return;
    request.value = prepareRequestForEditing(draft || savedRequest);
    updateOriginalBaseline(savedRequest);
    editorRevision.value++;
    emit('unsaved-changes', Boolean(draft));
  }
);

// 检查请求是否有变化
const hasChanges = (newRequest: Request) => {
  if (!originalFingerprint.value) return true;
  return requestDraftFingerprint(newRequest) !== originalFingerprint.value;
};

function updateOriginalBaseline(sourceRequest: Request) {
  const baseline = prepareRequestForPersistence(sourceRequest);
  originalRequest.value = baseline;
  originalFingerprint.value = requestDraftFingerprint(baseline);
}

// 暴露 hasChanges 方法供父组件使用
const hasUnsavedChanges = () => {
  return request.value ? hasChanges(request.value) : false;
};

// 恢复到原始版本（用于 Discard）
const restoreOriginalRequest = async () => {
  if (!originalRequest.value || !request.value) return;

  debouncedSaveToCache.cancel();
  const restoredRequest = prepareRequestForEditing({
    ...originalRequest.value,
    id: request.value.id,
    collectionId: request.value.collectionId,
    folderId: request.value.folderId,
    updatedAt: new Date().toISOString()
  });

  // 丢弃草稿：删除暂存编辑并把已保存版本载回工作缓存（不覆盖已保存文件）
  await requestsStore.discardRequestDraft(request.value.id);

  // 更新本地状态
  request.value = restoredRequest;
  emit('unsaved-changes', false);
};

// 暴露保存方法供父组件调用
const saveCurrentRequest = async () => {
  if (!request.value) return;
  
  try {
    // 如果请求有 collectionId，直接保存
    if (request.value.collectionId) {
      debouncedSaveToCache.cancel();
      const requestToSave = {
        ...prepareRequestForPersistence(request.value),
        updatedAt: new Date().toISOString()
      };
      
      await requestsStore.saveRequest(requestToSave);
      
      updateOriginalBaseline(requestToSave);
      
      // 通知父组件变化已保存
      emit('unsaved-changes', false);
      
      if (window.$toast) {
        window.$toast.add({
          severity: 'success',
          summary: 'Saved',
          detail: 'Request saved successfully',
          life: 2000
        });
      }
    } else {
      // 没有 collectionId，需要用户选择保存位置
      if (window.$toast) {
        window.$toast.add({
          severity: 'warn',
          summary: 'Cannot Save',
          detail: 'Please assign this request to a collection first',
          life: 3000
        });
      }
    }
  } catch (error) {
    console.error('Failed to save request:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to save request',
        life: 3000
      });
    }
  }
};

// 打开保存对话框供父组件调用
const openSaveDialog = () => {
  httpRequestRef.value?.openSaveDialog();
};

defineExpose({
  hasUnsavedChanges,
  saveCurrentRequest,
  openSaveDialog,
  restoreOriginalRequest,
  request // 暴露当前请求对象
});

// Debounced save function - 自动保存为「草稿」（不覆盖已保存版本，也不更新 collection）
const debouncedSaveToCache = debounce(async (updatedRequest: Request, hasChangesNow: boolean) => {
  // 没有变化时清除草稿：把内容改回与已保存版本一致时，应移除未保存标记。
  if (!hasChangesNow) {
    requestsStore.clearRequestDraft(updatedRequest.id);
    return;
  }

  try {
    // 保存为草稿（requests/_drafts/{id}.json），不覆盖已保存版本，也不更新 collection 引用
    const requestToSave = {
      ...prepareRequestForPersistence(updatedRequest),
      updatedAt: new Date().toISOString()
    };

    await requestsStore.setRequestDraft(requestToSave);
  } catch (error) {
    console.error('[HttpRequestWrapper] Failed to save request draft:', error);
  }
}, 1000);

// Watch for changes and auto-save to cache
const handleRequestUpdate = (updatedRequest: Request) => {
  request.value = updatedRequest;
  
  // 检查是否有变化并通知父组件
  const hasChangesNow = hasChanges(updatedRequest);
  emit('unsaved-changes', hasChangesNow);
  
  // 自动保存到缓存（不影响 collection）
  debouncedSaveToCache(updatedRequest, hasChangesNow);
};

const handleClose = () => {
  emit('close');
};

const handleAddConsoleLog = (log: ConsoleLog) => {
  emit('add-console-log', log);
};

const handleSaveRequest = (saveData: RequestSaveData) => {
  debouncedSaveToCache.cancel();
  emit('save-request', saveData);
  // 保存后更新原始请求状态
  if (request.value) {
    updateOriginalBaseline(request.value);
  }
  // 保存后清除未保存状态
  emit('unsaved-changes', false);
};
</script>

<template>
  <div class="h-full">
    <div v-if="isLoading" class="flex items-center justify-center h-full">
      <div class="text-center">
        <i class="pi pi-spin pi-spinner text-4xl text-surface-400 mb-2"></i>
        <p class="text-sm text-surface-500">Loading request...</p>
      </div>
    </div>
    
    <HttpRequest
      v-else-if="request"
      :key="editorRevision"
      ref="httpRequestRef"
      :request="request"
      :isActive="isActive"
      :collections="collections"
      @update:request="handleRequestUpdate"
      @close="handleClose"
      @add-console-log="handleAddConsoleLog"
      @save-request="handleSaveRequest"
    />
    
    <div v-else class="flex items-center justify-center h-full">
      <div class="text-center">
        <i class="pi pi-exclamation-triangle text-4xl text-red-400 mb-2"></i>
        <p class="text-sm text-surface-500">Request not found</p>
      </div>
    </div>
  </div>
</template>
