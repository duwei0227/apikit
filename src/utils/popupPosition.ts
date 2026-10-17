// 输入框和编辑器旁的浮层（{{ 变量补全、函数参数提示）的定位。
// 浮层挂在 body 上、用 position: fixed，不会被所在区域裁剪；
// 默认显示在锚点（输入框或光标所在行）下方，下方放不下且上方更宽裕时改到上方，左右不超出窗口。

export interface PopupAnchor {
  /** 锚点上边缘和下边缘（窗口坐标） */
  top: number;
  bottom: number;
  left: number;
}

export interface PopupPlacement {
  top: number;
  left: number;
  placement: 'below' | 'above';
}

const GAP = 4;
const MARGIN = 8;

export function placePopup(
  anchor: PopupAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): PopupPlacement {
  const spaceBelow = viewport.height - MARGIN - (anchor.bottom + GAP);
  const spaceAbove = anchor.top - GAP - MARGIN;
  const above = size.height > spaceBelow && spaceAbove > spaceBelow;
  const top = above
    ? Math.max(MARGIN, anchor.top - GAP - size.height)
    : anchor.bottom + GAP;
  const maxLeft = viewport.width - MARGIN - size.width;
  const left = Math.max(MARGIN, Math.min(anchor.left, maxLeft));
  return { top, left, placement: above ? 'above' : 'below' };
}

/** 按浮层实际尺寸放置；浮层需已渲染（position: fixed） */
export function positionPopupElement(el: HTMLElement | null | undefined, anchor: PopupAnchor) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const { top, left } = placePopup(anchor, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight });
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}
