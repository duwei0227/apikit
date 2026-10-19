import { describe, expect, it } from 'vitest';
import { placePopup } from '@/utils/popupPosition';

const viewport = { width: 1280, height: 900 };

describe('popup placement', () => {
  it('POPUP-001 opens below the anchor when there is room', () => {
    expect(placePopup({ top: 200, bottom: 230, left: 300 }, { width: 400, height: 300 }, viewport))
      .toMatchObject({ top: 234, left: 300, placement: 'below' });
  });

  it('POPUP-002 opens above when it does not fit below and there is more room above', () => {
    expect(placePopup({ top: 700, bottom: 730, left: 300 }, { width: 400, height: 300 }, viewport))
      .toMatchObject({ top: 396, left: 300, placement: 'above' });
  });

  it('POPUP-003 stays below when neither side fits but below has more room', () => {
    const result = placePopup({ top: 300, bottom: 330, left: 300 }, { width: 400, height: 800 }, viewport);
    expect(result.placement).toBe('below');
    expect(result.top).toBe(334);
  });

  it('POPUP-004 keeps the popup inside the window horizontally and vertically', () => {
    expect(placePopup({ top: 500, bottom: 530, left: 1100 }, { width: 400, height: 100 }, viewport).left).toBe(872);
    expect(placePopup({ top: 500, bottom: 530, left: 0 }, { width: 400, height: 100 }, viewport).left).toBe(8);
    // 上方也不够高时贴住窗口顶部
    expect(placePopup({ top: 450, bottom: 880, left: 10 }, { width: 400, height: 600 }, viewport))
      .toMatchObject({ top: 8, left: 10, placement: 'above' });
  });

  it('POPUP-005 limits the height to the space on the chosen side when it fits neither side', () => {
    // 下方 900 - 8 - 334 = 558，上方 300 - 4 - 8 = 288：放在下方，高度不超过 558
    const below = placePopup({ top: 300, bottom: 330, left: 300 }, { width: 400, height: 800 }, viewport);
    expect(below).toMatchObject({ placement: 'below', top: 334, maxHeight: 558 });
    expect(below.top + Math.min(800, below.maxHeight)).toBeLessThanOrEqual(viewport.height - 8);

    // 上方更宽裕：放在上方，高度为上方的空间，紧贴锚点
    const above = placePopup({ top: 600, bottom: 630, left: 300 }, { width: 400, height: 800 }, viewport);
    expect(above).toMatchObject({ placement: 'above', top: 8, maxHeight: 588 });
    expect(above.top + Math.min(800, above.maxHeight)).toBe(600 - 4);
  });

  it('POPUP-006 does not limit a popup that fits', () => {
    const result = placePopup({ top: 200, bottom: 230, left: 300 }, { width: 400, height: 300 }, viewport);
    expect(result.maxHeight).toBe(900 - 8 - 234);
    expect(result.maxHeight).toBeGreaterThan(300);
  });
});
