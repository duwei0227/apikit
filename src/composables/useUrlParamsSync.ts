import { onMounted, watch, type Ref } from 'vue';
import type { KeyValue, Request } from '@/types/models';
import { reconcileRows } from '@/utils/stableRows';
import { parseRequestUrl, serializeRequestUrl } from '@/utils/urlQuery';

/**
 * URL 与 Query Params 双向同步：改 Params 时重写 URL 的 query 部分，
 * 在 URL 输入框中粘贴或修改时（停止输入 300ms 后或失焦时）把 query 解析回 Params。
 */
export function useUrlParamsSync(localRequest: Ref<Request>, isUrlInputFocused: Ref<boolean>) {
  let isSyncingUrlFromParams = false; // 防止由 params 同步触发的 URL 变化被重复解析

  // 监听 params 变化，当 key 被删除时同步更新 URL
  watch(() => localRequest.value.params, () => {
    // 如果是由 syncUrlFromParams 触发的 params 变化，则跳过（避免循环覆盖）
    if (isSyncingUrlFromParams) return;
    syncUrlFromParams();
  }, { deep: true });

  // 监听 URL 变化，当用户在 URL 输入框中粘贴或修改时同步到 Params
  watch(() => localRequest.value.url, () => {
    // 如果是由 syncUrlFromParams 触发的 URL 变化，则跳过（避免循环覆盖）
    if (isSyncingUrlFromParams) return;
    // 延迟执行，等待用户停止输入
    debouncedSyncParamsFromUrl();
  });

  // 当 Params 变化时，同步更新 URL
  const syncUrlFromParams = () => {
    const parsedUrl = parseRequestUrl(localRequest.value.url);
    const newUrl = serializeRequestUrl(parsedUrl.baseUrl, localRequest.value.params, {
      autoEncode: false,
      fragment: parsedUrl.fragment,
    });

    // 如果新 URL 与当前 URL 不同，则更新
    if (newUrl !== localRequest.value.url) {
      isSyncingUrlFromParams = true;
      localRequest.value.url = newUrl;
      // 重置标志，允许后续的 URL 变化被处理
      setTimeout(() => {
        isSyncingUrlFromParams = false;
      }, 0);
    }
  };

  // 当 URL 变化时，解析并更新 Params
  let isSyncingUrl = false; // 防止循环同步
  const syncParamsFromUrl = () => {
    if (isSyncingUrl) return;
    isSyncingUrl = true;
    isSyncingUrlFromParams = true; // 防止 params watcher 反向覆盖 URL

    try {
      const url = localRequest.value.url;
      const parsedUrl = parseRequestUrl(url);
      const parsedParams = parsedUrl.params;

      // 原地复用已有行对象（而非整体替换数组），保持行身份，
      // 避免 URL 解析回填后参数输入框被重建、撤销历史丢失
      const nextParams: KeyValue[] = parsedParams.length > 0 ? [...parsedParams] : [];
      // 确保最后一行为空行
      if (!nextParams.some(p => !p.key && !p.value)) {
        nextParams.push({ key: '', value: '', enabled: true });
      }
      if (!Array.isArray(localRequest.value.params)) localRequest.value.params = [];
      reconcileRows(localRequest.value.params, nextParams);
    } finally {
      setTimeout(() => {
        isSyncingUrl = false;
        isSyncingUrlFromParams = false;
        // Only rebuild URL from params when the input is not focused;
        // while typing, preserve the user's partial input (e.g. a bare "?").
        if (!isUrlInputFocused.value) {
          syncUrlFromParams();
        }
      }, 0);
    }
  };

  // 监听 URL 变化的防抖版本（用于粘贴等场景）
  let urlWatchTimeout: ReturnType<typeof setTimeout> | null = null;
  const debouncedSyncParamsFromUrl = () => {
    if (urlWatchTimeout) {
      clearTimeout(urlWatchTimeout);
    }
    urlWatchTimeout = setTimeout(() => {
      syncParamsFromUrl();
    }, 300);
  };

  // 初始化时如果 params 有数据但 URL 没有 query 参数，同步一次
  onMounted(() => {
    const hasParams = localRequest.value.params.some((p: KeyValue) => p.key);
    const hasQuery = localRequest.value.url && localRequest.value.url.includes('?');
    if (hasParams && !hasQuery) {
      syncUrlFromParams();
    }
  });

  return { syncUrlFromParams, syncParamsFromUrl };
}
