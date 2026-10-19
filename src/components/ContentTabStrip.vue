<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { ContentTab } from '@/stores/appState';

// 内容区顶部的页签栏（请求与 Workflow 混排）：选择、拖动排序、鼠标关闭和右键菜单。
// 页签数据与操作由 MainContent 提供，这里只负责显示和指针交互。
const props = withDefaults(defineProps<{
  tabs: ContentTab[];
  activeIndex?: number;
  getLabel: (tab: ContentTab) => string;
  isUnsaved: (tab: ContentTab) => boolean;
}>(), {
  activeIndex: 0,
});

const emit = defineEmits<{
  select: [index: number];
  close: [tab: ContentTab, index: number];
  reorder: [fromIndex: number, toIndex: number];
  contextmenu: [event: MouseEvent, index: number];
}>();

interface TabDragState {
  fromIndex: number;
  toIndex: number;
  offsetX: number;
  slotWidth: number;
}

interface TabDragSession {
  pointerId: number;
  startX: number;
  fromIndex: number;
  slotWidth: number;
  started: boolean;
}

const contentTabsRoot = ref<HTMLElement | null>(null);
const contentTabs = computed(() => props.tabs);

const findTabIndex = (tab: ContentTab) => props.tabs.findIndex(item => item.type === tab.type && item.id === tab.id);

const scrollTabIntoView = async (index: number) => {
  await nextTick();
  const tabElement = contentTabsRoot.value?.querySelector(`[data-content-tab-index="${index}"]`);
  if (!tabElement) return;

  tabElement.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest',
    inline: 'center'
  });
};

// ==================== Tab 拖拽排序（Chrome 式：指针拖动，页签实时跟随、其余页签让位） ====================
// 不用 HTML5 原生 DnD：WebView 下拖影/落点反馈差，且 Windows 上不稳定。
const TAB_GAP = 6; // 与 .request-tab-fixed 的 margin-right 保持一致
const TAB_DRAG_THRESHOLD = 4;
const tabDrag = ref<TabDragState | null>(null);
const suppressTabTransition = ref(false);
let tabDragSession: TabDragSession | null = null;

const getTabElement = (index: number) => contentTabsRoot.value?.querySelector<HTMLElement>(`[data-content-tab-index="${index}"]`);

const getTabDragStyle = (index: number) => {
  const drag = tabDrag.value;
  if (!drag) return null;
  if (index === drag.fromIndex) return { transform: `translateX(${drag.offsetX}px)` };
  if (drag.fromIndex < index && index <= drag.toIndex) return { transform: `translateX(${-drag.slotWidth}px)` };
  if (drag.toIndex <= index && index < drag.fromIndex) return { transform: `translateX(${drag.slotWidth}px)` };
  return null;
};

const endTabDrag = () => {
  window.removeEventListener('pointermove', onTabPointerMove);
  window.removeEventListener('pointerup', onTabPointerUp);
  window.removeEventListener('pointercancel', endTabDrag);
  tabDragSession = null;
  tabDrag.value = null;
};

const onTabPointerDown = (event: PointerEvent, index: number) => {
  if (event.button !== 0 || (event.target as Element).closest('.content-tab-close')) return;
  const tabElement = getTabElement(index);
  if (!tabElement) return;

  endTabDrag();
  tabDragSession = {
    pointerId: event.pointerId,
    startX: event.clientX,
    fromIndex: index,
    slotWidth: tabElement.getBoundingClientRect().width + TAB_GAP,
    started: false
  };
  window.addEventListener('pointermove', onTabPointerMove);
  window.addEventListener('pointerup', onTabPointerUp);
  window.addEventListener('pointercancel', endTabDrag);
};

function onTabPointerMove(event: PointerEvent) {
  const session = tabDragSession;
  if (!session || event.pointerId !== session.pointerId) return;

  const deltaX = event.clientX - session.startX;
  if (!session.started) {
    if (Math.abs(deltaX) < TAB_DRAG_THRESHOLD) return;
    session.started = true;
  }

  const maxIndex = contentTabs.value.length - 1;
  const offsetX = Math.min(
    (maxIndex - session.fromIndex) * session.slotWidth,
    Math.max(-session.fromIndex * session.slotWidth, deltaX)
  );
  tabDrag.value = {
    fromIndex: session.fromIndex,
    toIndex: session.fromIndex + Math.round(offsetX / session.slotWidth),
    offsetX,
    slotWidth: session.slotWidth
  };
}

function onTabPointerUp(event: PointerEvent) {
  const session = tabDragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  const drag = tabDrag.value;
  endTabDrag();
  if (!session.started || !drag) return;

  const movedTab = contentTabs.value[drag.fromIndex];
  if (drag.toIndex !== drag.fromIndex) {
    // 落位时 DOM 顺序与 transform 同时归位，关闭过渡避免页签「弹回再滑走」
    suppressTabTransition.value = true;
    emit('reorder', drag.fromIndex, drag.toIndex);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      suppressTabTransition.value = false;
    }));
  }

  // 与 Chrome 一致：拖动过的页签成为当前页签
  nextTick(() => {
    const index = movedTab ? findTabIndex(movedTab) : -1;
    if (index >= 0 && index !== props.activeIndex) emit('select', index);
  });
}

// ==================== Tab 宽度与鼠标关闭（Chrome 式） ====================
// 页签宽度随数量自适应；用鼠标连续关闭时锁定宽度，让下一个页签的关闭按钮停在指针下，
// 指针离开页签栏后再恢复自适应。
const TAB_MIN_WIDTH = 110;
const TAB_MAX_WIDTH = 220;
const tabStripWidth = ref(0);
const lockedTabWidth = ref<number | null>(null);
let tabStripResizeObserver: ResizeObserver | null = null;
let middlePressedTabIndex = -1;

const contentTabWidth = computed(() => {
  if (lockedTabWidth.value) return lockedTabWidth.value;
  const count = contentTabs.value.length;
  if (!count || !tabStripWidth.value) return TAB_MAX_WIDTH;
  const width = Math.floor((tabStripWidth.value - 4) / count) - TAB_GAP;
  return Math.min(TAB_MAX_WIDTH, Math.max(TAB_MIN_WIDTH, width));
});

const closeContentTabByMouse = (tab: ContentTab, index: number) => {
  lockedTabWidth.value = contentTabWidth.value;
  emit('close', tab, index);
};


const onTabStripPointerLeave = () => {
  lockedTabWidth.value = null;
};

const onTabMouseDown = (event: MouseEvent, index: number) => {
  middlePressedTabIndex = event.button === 1 ? index : -1;
  // 中键用于关闭页签，阻止其触发自动滚动
  if (event.button === 1) event.preventDefault();
};

const onTabMouseUp = (event: MouseEvent, tab: ContentTab, index: number) => {
  if (event.button !== 1) return;
  const pressedIndex = middlePressedTabIndex;
  middlePressedTabIndex = -1;
  if (pressedIndex !== index) return;
  event.preventDefault();
  closeContentTabByMouse(tab, index);
};

// 页签溢出时，鼠标滚轮纵向滚动转为横向滚动
const onTabStripWheel = (event: WheelEvent) => {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  const scroller = contentTabsRoot.value?.querySelector<HTMLElement>('.p-tablist-content');
  if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
  event.preventDefault();
  scroller.scrollLeft += event.deltaY;
};

onMounted(() => {
  if (!contentTabsRoot.value || typeof ResizeObserver === 'undefined') return;
  tabStripResizeObserver = new ResizeObserver(([entry]: ResizeObserverEntry[]) => {
    tabStripWidth.value = entry.contentRect.width;
  });
  tabStripResizeObserver.observe(contentTabsRoot.value);
});

onBeforeUnmount(() => {
  endTabDrag();
  tabStripResizeObserver?.disconnect();
  tabStripResizeObserver = null;
});

defineExpose({ scrollTabIntoView });
</script>

<template>
  <div
    ref="contentTabsRoot"
    class="flex-1 overflow-hidden"
    :class="{ 'tabs-no-transition': suppressTabTransition, 'tabs-dragging': tabDrag }"
    :style="{ '--content-tab-width': `${contentTabWidth}px` }"
    @pointerleave="onTabStripPointerLeave"
    @wheel="onTabStripWheel"
  >
    <Tabs
      v-if="contentTabs.length > 0"
      class="content-tabs"
      :value="activeIndex"
      @update:value="emit('select', $event)"
      scrollable
    >
      <TabList>
        <Tab
          v-for="(tab, index) in contentTabs"
          :key="`${tab.type}-${tab.id}`"
          :value="index"
          :data-content-tab-index="index"
          :style="getTabDragStyle(index)"
          @pointerdown="onTabPointerDown($event, index)"
          @mousedown="onTabMouseDown($event, index)"
          @mouseup="onTabMouseUp($event, tab, index)"
          @contextmenu="emit('contextmenu', $event, index)"
          class="request-tab-fixed"
          :class="{ 'tab-drag-active': tabDrag && tabDrag.fromIndex === index }"
        >
          <div class="flex items-center gap-1 min-w-0 flex-1">
            <span
              v-if="isUnsaved(tab)"
              class="w-2 h-2 rounded-full bg-orange-500 shrink-0"
            ></span>
            <i v-if="tab.type === 'workflow'" class="pi pi-sitemap text-xs text-primary-500"></i>
            <i v-else-if="tab.type === 'mock'" class="pi pi-server text-xs text-teal-600 dark:text-teal-400"></i>
            <span
              class="text-xs truncate"
              :class="{ 'text-orange-600 dark:text-orange-400': isUnsaved(tab) }"
              :title="getLabel(tab)"
            >{{ getLabel(tab) }}</span>
          </div>
          <span
            class="content-tab-close"
            title="Close (Middle Click)"
            @click.stop="closeContentTabByMouse(tab, index)"
          >
            <i class="pi pi-times"></i>
          </span>
        </Tab>
      </TabList>
    </Tabs>
  </div>
</template>

<style scoped>
:deep(.request-tab-fixed) {
  width: var(--content-tab-width, 126px) !important;
  min-width: var(--content-tab-width, 126px) !important;
  max-width: var(--content-tab-width, 126px) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  user-select: none;
  cursor: default;
  /* 只对位移做过渡；宽度变化不加动画，否则 PrimeVue 会按过渡中的宽度计算激活指示条位置 */
  transition: transform 0.15s ease, background-color 0.2s, border-color 0.2s, color 0.2s !important;
}

:deep(.request-tab-fixed.p-tab) {
  border: 1px solid var(--p-surface-200) !important;   /* 同 HttpRequest 标题分割线(亮) */
  border-radius: 3px !important;
  margin-right: 6px !important;
  padding: 0.8rem 0.5rem !important;
}

/* 暗色页签边框与 HttpRequest 标题分割线(dark:border-surface-700)一致。
   .p-tab 根元素带有作用域属性(组件根透传)，故写作用域选择器即可——
   关键是 .p-dark 必须在 :deep() 外作为普通祖先，否则编译成 [data-v] .p-dark … 永不匹配。 */
.p-dark .request-tab-fixed.p-tab {
  border-color: var(--p-surface-700) !important;
}

/* ===== 激活页签视觉强化：明亮蓝强调 =====
   Noir 是单色主题(无品牌色)，故引入固定的明亮蓝(blue-500 #3b82f6)作为激活强调色，
   与「未保存」的橙色冷暖互补、互不冲突。结构：蓝边框 + 2px 顶部蓝条 + 字重 600（背景沿用页签默认）。
   顶部条用 inset box-shadow 实现，不改变页签高度，无布局抖动。
   不覆盖标签文字颜色——这样页签既激活又未保存时，橙色提示仍保留。 */

/* 亮色：蓝边框 + 蓝顶条（背景保持页签默认） */
:deep(.request-tab-fixed.p-tab[data-p-active="true"]) {
  border-color: #93c5fd !important;          /* blue-300 */
  box-shadow: inset 0 2px 0 0 #3b82f6;       /* blue-500 顶条 */
}

/* 字重提升与主题无关，两种主题通用 */
:deep(.request-tab-fixed.p-tab[data-p-active="true"] .text-xs) {
  font-weight: 600;
}

/* 暗色：亮蓝边框 + 更亮蓝顶条（背景保持页签默认） */
.p-dark .request-tab-fixed.p-tab[data-p-active="true"] {
  background: var(--p-surface-950) !important;      /* tab.activeBackground：与编辑器同底 */
  border-color: var(--p-surface-700) !important;     /* tab.border */
  box-shadow: inset 0 2px 0 0 #3994bc;               /* tab.activeBorderTop */
}

/* 激活页签的指示条(active bar)默认取 primary 色，在 Noir 暗色下 = 近白(surface.50)，
   过亮且与其他分割线不一致。统一为页签边框/分割线颜色（亮:300 / 暗:600）。
   .content-tabs 限定只作用于顶部编辑器页签，不影响内部 request/response 页签。
   注意：.p-dark 在 <html> 上，必须作为普通祖先选择器（不能包进 :deep()，
   否则会编译成 [data-v] .p-dark …，永远匹配不到）；:deep() 只包裹子组件类名。 */
.content-tabs :deep(.p-tablist-active-bar) {
  background: var(--p-surface-200) !important;
}

.p-dark .content-tabs :deep(.p-tablist-active-bar) {
  background: var(--p-surface-700) !important;
}

/* ===== 拖拽排序视觉反馈 ===== */
/* 被拖动的页签跟随指针，不加过渡；浮于相邻页签之上 */
:deep(.request-tab-fixed.tab-drag-active) {
  position: relative;
  z-index: 2;
  transition: none !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

:deep(.request-tab-fixed.tab-drag-active[data-p-active="true"]) {
  box-shadow: inset 0 2px 0 0 #3b82f6, 0 2px 8px rgba(0, 0, 0, 0.15);
}

.tabs-dragging :deep(.request-tab-fixed) {
  cursor: default !important;
}

/* 落位瞬间关闭过渡，避免页签动画闪烁 */
.tabs-no-transition :deep(.request-tab-fixed) {
  transition: none !important;
}

/* ===== 关闭按钮：圆形热区 + 悬停底色（Chrome 式） ===== */
.content-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-left: 4px;
  border-radius: 50%;
  color: var(--p-surface-500);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.content-tab-close .pi {
  font-size: 0.625rem;
}

.content-tab-close:hover {
  background-color: var(--p-surface-200);
  color: var(--p-surface-900);
}

.content-tab-close:active {
  background-color: var(--p-surface-300);
}

.p-dark .content-tab-close {
  color: var(--p-surface-400);
}

.p-dark .content-tab-close:hover {
  background-color: var(--p-surface-700);
  color: var(--p-surface-0);
}

.p-dark .content-tab-close:active {
  background-color: var(--p-surface-600);
}
</style>
