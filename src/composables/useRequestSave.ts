import { onMounted, onUnmounted, ref, type Ref } from 'vue';
import { useAppStateStore } from '@/stores/appState';
import { findFolderById, isRequestNameTaken, resolveSaveLocation } from '@/utils/collectionTree';
import { generateId } from '@/utils/id-generator';
import type { Collection, Folder, Request, TestConfig } from '@/types/models';
import { matchesShortcut } from '@/utils/shortcuts';

/** 保存事件的内容：要保存的请求和目标位置，由 MainContent 持久化 */
export interface RequestSaveData {
  request: Request;
  collection: Collection;
  folder: Folder | null;
}

interface RequestSaveOptions {
  props: { request: Request; collections: Collection[]; isActive: boolean };
  localRequest: Ref<Request>;
  /** 当前断言配置的深拷贝，随请求一起保存 */
  buildTestsConfig: () => TestConfig;
  emitSave: (saveData: RequestSaveData) => void;
}

/**
 * 请求保存：已在集合中的请求直接保存（Ctrl+S 或 Save 按钮），新请求打开保存对话框选择位置。
 * 返回保存对话框的状态和处理函数，供模板中的 SaveRequestDialog 使用。
 */
export function useRequestSave({ props, localRequest, buildTestsConfig, emitSave }: RequestSaveOptions) {
  const appStateStore = useAppStateStore();
  const showSaveDialog = ref(false);
  // 保存对话框的预填充数据（传给 SaveRequestDialog 子组件）
  const saveDialogName = ref('');
  const saveDialogCollection = ref<Collection | null>(null);
  const saveDialogFolder = ref<Folder | null>(null);

  // 要保存的请求：去掉空行，位置信息保留旧值（由保存事件的 collection / folder 决定新位置）
  const buildRequestToSave = (id: string, name: string): Request => ({
    id,
    name,
    method: localRequest.value.method,
    url: localRequest.value.url,
    params: localRequest.value.params.filter(p => p.key || p.value),
    headers: localRequest.value.headers.filter(h => h.key || h.value),
    body: { ...localRequest.value.body },
    auth: { ...localRequest.value.auth },
    tests: localRequest.value.tests,
    testsConfig: buildTestsConfig(),
    settings: { ...localRequest.value.settings },
    collectionId: localRequest.value.collectionId,
    folderId: localRequest.value.folderId,
    createdAt: localRequest.value.createdAt,
    updatedAt: new Date().toISOString()
  });

  const openSaveDialog = () => {
    saveDialogName.value = localRequest.value.name;
    // 默认选中上次保存的位置；没有时只有一个集合则选中它
    const location = resolveSaveLocation(props.collections, appStateStore.lastSaveLocation);
    saveDialogCollection.value = location?.collection ?? null;
    saveDialogFolder.value = location?.folder ?? null;
    showSaveDialog.value = true;
  };

  const saveRequestDirectly = () => {
    // 直接保存到已有的 collection/folder
    const collection = props.collections.find(c => c.id === localRequest.value.collectionId);

    if (!collection) {
      console.error('Collection not found:', localRequest.value.collectionId);
      if (window.$toast) {
        window.$toast.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Collection not found',
          life: 3000
        });
      }
      return;
    }

    // 查找 folder（如果有）
    const folder = localRequest.value.folderId
      ? findFolderById(collection.folders || [], localRequest.value.folderId)
      : null;

    // 发出保存事件（不移动位置，只更新内容）
    emitSave({
      request: buildRequestToSave(localRequest.value.id, localRequest.value.name),
      collection,
      folder
    });
  };

  // 保存相关方法
  const handleSaveClick = () => {
    // 如果请求还没有分配 collection，显示对话框让用户选择
    if (!localRequest.value.collectionId) {
      openSaveDialog();
    } else {
      // 已经有 collection，直接保存
      saveRequestDirectly();
    }
  };

  // 由 SaveRequestDialog 的 @save 事件触发，payload 为 { name, collection, folder }
  const onDialogSave = ({ name, collection, folder }: { name: string; collection: Collection; folder: Folder | null }) => {
    // 检查名称是否重复
    const targetFolderId = folder?.id || null;
    if (isRequestNameTaken(props.collections, collection.id, targetFolderId, name, localRequest.value.id)) {
      if (window.$toast) {
        window.$toast.add({
          severity: 'warn',
          summary: 'Duplicate Name',
          detail: 'A request with this name already exists in the same location',
          life: 3000
        });
      }
      return;
    }

    const requestToSave = buildRequestToSave(localRequest.value.id || generateId(), name);

    // 更新本地请求状态
    localRequest.value.name = name;
    localRequest.value.id = requestToSave.id;
    // 更新 collectionId 和 folderId
    localRequest.value.collectionId = collection.id;
    localRequest.value.folderId = folder?.id || null;
    appStateStore.lastSaveLocation = { collectionId: collection.id, folderId: folder?.id || null };

    // 发出保存事件（成功提示由上层 MainContent.handleSaveRequest 在实际持久化后统一弹出）
    emitSave({ request: requestToSave, collection, folder });

    // 关闭对话框
    showSaveDialog.value = false;
  };

  // Keyboard shortcut handler for Ctrl+S
  const handleKeyDown = (event: KeyboardEvent) => {
    // Only handle Ctrl+S if this is the active request
    if (!props.isActive) return;

    // Check for Ctrl+S (or Cmd+S on Mac)
    if (matchesShortcut(event, { key: 's', mod: true })) {
      event.preventDefault(); // Prevent browser's default save dialog
      handleSaveClick();
    }
  };

  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  return {
    showSaveDialog,
    saveDialogName,
    saveDialogCollection,
    saveDialogFolder,
    handleSaveClick,
    openSaveDialog,
    onDialogSave,
  };
}
