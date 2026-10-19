import { describe, expect, it } from 'vitest';
import { newFolderIndex } from '@/utils/folderPlacement';

describe('newFolderIndex', () => {
  it('places a new folder right after the last folder', () => {
    expect(newFolderIndex([true, true, false, false])).toBe(2);
    // 交错时紧跟最后一个文件夹
    expect(newFolderIndex([true, false, true, false])).toBe(3);
  });

  it('places it first when the level has no folders, and alone in an empty level', () => {
    expect(newFolderIndex([false, false])).toBe(0);
    expect(newFolderIndex([])).toBe(0);
  });
});
