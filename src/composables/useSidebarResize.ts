import { onBeforeUnmount, onMounted, ref } from 'vue';

const INITIAL_SIDEBAR_WIDTH = 320; // 初始宽度 (w-80 = 320px)
const COLLAPSE_THRESHOLD = INITIAL_SIDEBAR_WIDTH * 0.4; // 收起阈值：初始宽度的40%（缩小60%）= 128px
const MIN_SIDEBAR_WIDTH = Math.max(COLLAPSE_THRESHOLD - 50, 100); // 最小宽度设置为收起阈值以下，确保能触发收起

/**
 * 侧边栏宽度拖动与收起：拖动右边缘调整宽度（最大为窗口宽度的 40%），
 * 拖到收起阈值以下时自动收起；展开时恢复初始宽度。
 */
export function useSidebarResize() {
  const sidebarWidth = ref(INITIAL_SIDEBAR_WIDTH);
  const sidebarCollapsed = ref(false);
  const isResizing = ref(false);
  const maxSidebarWidth = ref(800); // 默认最大宽度，会在 mounted 时计算

  // Calculate max sidebar width (40% of window width)
  const updateMaxSidebarWidth = () => {
    maxSidebarWidth.value = Math.floor(window.innerWidth * 0.4);
  };

  // Handle sidebar resize
  const startResize = () => {
    if (sidebarCollapsed.value) return;
    isResizing.value = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleResize = (event: MouseEvent) => {
    if (!isResizing.value) return;

    const newWidth = event.clientX;

    // 限制宽度范围
    if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= maxSidebarWidth.value) {
      sidebarWidth.value = newWidth;

      // 检查是否需要自动收起
      if (newWidth < COLLAPSE_THRESHOLD) {
        sidebarCollapsed.value = true;
        isResizing.value = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    }
  };

  const stopResize = () => {
    isResizing.value = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  // Toggle sidebar collapse
  const toggleSidebar = () => {
    sidebarCollapsed.value = !sidebarCollapsed.value;
    if (!sidebarCollapsed.value) {
      // 展开时恢复到初始宽度
      sidebarWidth.value = INITIAL_SIDEBAR_WIDTH;
    }
  };

  onMounted(() => {
    // 计算最大侧边栏宽度，并监听窗口大小变化
    updateMaxSidebarWidth();
    window.addEventListener('resize', updateMaxSidebarWidth);
    window.addEventListener('mousemove', handleResize);
    window.addEventListener('mouseup', stopResize);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('resize', updateMaxSidebarWidth);
    window.removeEventListener('mousemove', handleResize);
    window.removeEventListener('mouseup', stopResize);
  });

  return { sidebarWidth, sidebarCollapsed, startResize, toggleSidebar };
}
