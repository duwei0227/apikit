<script setup>
import { ref, watch, onMounted } from 'vue';
import { useRequestsStore } from '@/stores/requests';
import { debounce } from '@/utils/debounce';
import {
  prepareRequestForEditing,
  prepareRequestForPersistence,
  requestDraftFingerprint,
} from '@/utils/requestDraft';
import HttpRequest from './HttpRequest.vue';

const props = defineProps({
  requestId: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: false
  },
  environmentManager: {
    type: Object,
    default: null
  },
  collections: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['close', 'add-console-log', 'save-request', 'unsaved-changes']);

const requestsStore = useRequestsStore();

const request = ref(null);
const isLoading = ref(true);
const originalRequest = ref(null); // 保存原始请求用于比较
const originalFingerprint = ref('');
const httpRequestRef = ref(null); // HttpRequest 组件的引用

// Load request from store
onMounted(async () => {
  try {
    const [loadedRequest, savedRequest] = await Promise.all([
      requestsStore.loadRequest(props.requestId),
      requestsStore.loadSavedRequest(props.requestId),
    ]);

    if (loadedRequest) {
      request.value = prepareRequestForEditing(loadedRequest);
      originalRequest.value = prepareRequestForPersistence(savedRequest || loadedRequest);
      originalFingerprint.value = requestDraftFingerprint(originalRequest.value);
      const hasChangesNow = requestsStore.hasRequestDraft(props.requestId)
        || requestDraftFingerprint(request.value) !== originalFingerprint.value;
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

// 检查请求是否有变化
const hasChanges = (newRequest) => {
  if (!originalFingerprint.value) return true;
  return requestDraftFingerprint(newRequest) !== originalFingerprint.value;
};

const updateOriginalBaseline = (sourceRequest) => {
  originalRequest.value = prepareRequestForPersistence(sourceRequest);
  originalFingerprint.value = requestDraftFingerprint(originalRequest.value);
};

// 暴露 hasChanges 方法供父组件使用
const hasUnsavedChanges = () => {
  return request.value ? hasChanges(request.value) : false;
};

// 恢复到原始版本（用于 Discard）
const restoreOriginalRequest = async () => {
  if (!originalRequest.value || !request.value) return;

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
  if (httpRequestRef.value && typeof httpRequestRef.value.openSaveDialog === 'function') {
    httpRequestRef.value.openSaveDialog();
  }
};

defineExpose({
  hasUnsavedChanges,
  saveCurrentRequest,
  openSaveDialog,
  restoreOriginalRequest,
  request // 暴露当前请求对象
});

// Debounced save function - 自动保存为「草稿」（不覆盖已保存版本，也不更新 collection）
const debouncedSaveToCache = debounce(async (updatedRequest, hasChangesNow) => {
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
const handleRequestUpdate = (updatedRequest) => {
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

const handleAddConsoleLog = (log) => {
  emit('add-console-log', log);
};

const handleSaveRequest = (saveData) => {
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
      ref="httpRequestRef"
      :request="request"
      :isActive="isActive"
      :environmentManager="environmentManager"
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
