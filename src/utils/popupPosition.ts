// 输入框和编辑器旁的浮层（{{ 变量补全、函数参数提示）的定位。
// 浮层挂在 body 上、用 position: fixed，不会被所在区域裁剪；
// 默认显示在锚点（输入框或光标所在行）下方，下方放不下且上方更宽裕时改到上方，左右不超出窗口；
// 两边都放不下时，高度限制为所选一侧的空间，内容在浮层内滚动。

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
  /** 所选一侧可用的高度，浮层不超过它 */
  maxHeight: number;
}

/** 浮层在页面中的位置；maxHeight 为空时不限制高度（用于测量浮层的实际高度） */
export interface PopupPosition {
  top: number;
  left: number;
  maxHeight?: number;
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
  const maxHeight = Math.max(0, above ? spaceAbove : spaceBelow);
  const height = Math.min(size.height, maxHeight);
  const top = above ? anchor.top - GAP - height : anchor.bottom + GAP;
  const maxLeft = viewport.width - MARGIN - size.width;
  const left = Math.max(MARGIN, Math.min(anchor.left, maxLeft));
  return { top, left, placement: above ? 'above' : 'below', maxHeight };
}

/**
 * 浮层的定位样式。可用高度通过 CSS 变量 --ak-popup-max-height 传给浮层，
 * 浮层的 max-height 取它与自身上限中较小的值；没有时不设置，浮层按自身内容和上限显示。
 */
export function popupStyle(position: PopupPosition): Record<string, string | undefined> {
  return {
    top: `${position.top}px`,
    left: `${position.left}px`,
    '--ak-popup-max-height': position.maxHeight === undefined ? undefined : `${position.maxHeight}px`,
  };
}
