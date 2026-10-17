import { describe, expect, it } from 'vitest';
import { placePopup } from '@/utils/popupPosition';

const viewport = { width: 1280, height: 900 };

describe('popup placement', () => {
  it('POPUP-001 opens below the anchor when there is room', () => {
    expect(placePopup({ top: 200, bottom: 230, left: 300 }, { width: 400, height: 300 }, viewport))
      .toEqual({ top: 234, left: 300, placement: 'below' });
  });

  it('POPUP-002 opens above when it does not fit below and there is more room above', () => {
    expect(placePopup({ top: 700, bottom: 730, left: 300 }, { width: 400, height: 300 }, viewport))
      .toEqual({ top: 396, left: 300, placement: 'above' });
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
      .toEqual({ top: 8, left: 10, placement: 'above' });
  });
});
