import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSequencesStore } from '@/stores/sequences';

describe('sequence preview', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('simulates sequence steps without changing the stored sequence', () => {
    const store = useSequencesStore();
    store.sequences.set('order', {
      name: 'order',
      currentValue: 7,
      startValue: 1,
      step: 2,
      padding: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const cursors = new Map();

    expect(store.getPreviewNextValue(cursors, 'order')).toBe('007');
    expect(store.getPreviewNextValue(cursors, 'order')).toBe('009');
    expect(store.getSequenceSnapshot('order')?.currentValue).toBe(7);
  });

  it('previews an uninitialized sequence without creating it', () => {
    const store = useSequencesStore();
    const cursors = new Map();

    expect(store.getPreviewNextValue(cursors, 'new', 4, 5, 3)).toBe('0005');
    expect(store.getPreviewNextValue(cursors, 'new', 4, 5, 3)).toBe('0008');
    expect(store.getSequenceSnapshot('new')).toBeUndefined();
  });
});
