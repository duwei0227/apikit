import { describe, expect, it } from 'vitest';
import { DIALOG_WIDTHS, dialogStyle } from '@/utils/dialogSize';

describe('dialog sizes', () => {
  it('uses increasing fixed widths for the size tiers', () => {
    const widths = (['sm', 'md', 'lg', 'xl', 'xxl'] as const).map(size => parseFloat(DIALOG_WIDTHS[size]));
    expect(widths).toEqual([30, 36, 42, 50, 60]);
  });

  it('keeps the dialog inside a small window', () => {
    expect(dialogStyle('md')).toEqual({ width: '36rem', maxWidth: 'calc(100vw - 2rem)' });
  });
});
