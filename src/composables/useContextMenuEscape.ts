import { onMounted, onUnmounted, ref, type Ref } from 'vue';

/** PrimeVue ContextMenu 实例中用到的部分 */
interface ContextMenuHandle {
  hide: () => void;
}

/**
 * 按 Esc 关闭右键菜单。PrimeVue ContextMenu 只在菜单列表获得焦点时处理 Esc，
 * 而列表要等显示动画结束才获得焦点，焦点也可能被移走，所以在菜单显示期间由这里处理：
 * 只关闭菜单，并阻止 Esc 继续传给树或页面上的其他快捷键。
 * 把返回的 onShow / onHide 绑定到 ContextMenu 的 @before-show / @hide。
 */
export function useContextMenuEscape(menu: Ref<ContextMenuHandle | null>) {
  const isVisible = ref(false);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !isVisible.value) return;
    event.preventDefault();
    event.stopPropagation();
    menu.value?.hide();
  };

  // 捕获阶段监听，先于树和全局快捷键收到 Esc
  onMounted(() => window.addEventListener('keydown', onKeyDown, true));
  onUnmounted(() => window.removeEventListener('keydown', onKeyDown, true));

  return {
    onShow: () => { isVisible.value = true; },
    onHide: () => { isVisible.value = false; },
  };
}
