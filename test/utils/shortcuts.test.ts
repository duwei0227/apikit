import { describe, expect, it } from 'vitest';
import { formatShortcut, isMacPlatform, matchesShortcut, shortcutKeys, type ShortcutEvent } from '@/utils/shortcuts';

const key = (k: string, init: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key: k,
  code: /^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : '',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...init,
});

describe('matchesShortcut', () => {
  it('accepts Ctrl or Cmd and ignores letter case', () => {
    expect(matchesShortcut(key('s', { ctrlKey: true }), { key: 's', mod: true })).toBe(true);
    expect(matchesShortcut(key('s', { metaKey: true }), { key: 's', mod: true })).toBe(true);
    // 大写锁定
    expect(matchesShortcut(key('S', { ctrlKey: true }), { key: 's', mod: true })).toBe(true);
    expect(matchesShortcut(key('s'), { key: 's', mod: true })).toBe(false);
  });

  it('requires the modifiers to match exactly', () => {
    expect(matchesShortcut(key('D', { ctrlKey: true, shiftKey: true }), { key: 'd', mod: true })).toBe(false);
    expect(matchesShortcut(key('d', { ctrlKey: true, altKey: true }), { key: 'd', mod: true })).toBe(false);
    expect(matchesShortcut(key('D', { ctrlKey: true, shiftKey: true }), { key: 'd', mod: true, shift: true })).toBe(true);
    // 大写锁定时 Shift+D 的 key 为小写
    expect(matchesShortcut(key('d', { ctrlKey: true, shiftKey: true }), { key: 'd', mod: true, shift: true })).toBe(true);
  });

  it('falls back to the physical key when the key is not a Latin letter', () => {
    expect(matchesShortcut({ ...key('∂', { metaKey: true, altKey: true }), code: 'KeyD' }, { key: 'd', mod: true, alt: true })).toBe(true);
    expect(matchesShortcut({ ...key('в', { ctrlKey: true }), code: 'KeyD' }, { key: 'd', mod: true })).toBe(true);
    // 拉丁字母按 key 匹配，不按位置（Dvorak 上物理 S 键为 o）
    expect(matchesShortcut({ ...key('o', { ctrlKey: true }), code: 'KeyS' }, { key: 's', mod: true })).toBe(false);
  });

  it('matches named keys exactly', () => {
    expect(matchesShortcut(key('F1'), { key: 'F1' })).toBe(true);
    expect(matchesShortcut(key('/', { ctrlKey: true }), { key: '/', mod: true })).toBe(true);
    expect(matchesShortcut(key('Delete'), { key: 'Delete' })).toBe(true);
    expect(matchesShortcut(key('Delete', { ctrlKey: true }), { key: 'Delete' })).toBe(false);
  });

  it('formats shortcuts for macOS and other systems', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('Win32')).toBe(false);
    expect(shortcutKeys('Mod+Shift+Z', false)).toEqual(['Ctrl', 'Shift', 'Z']);
    expect(shortcutKeys('Mod+Shift+Z', true)).toEqual(['⌘', '⇧', 'Z']);
    expect(shortcutKeys('Ctrl+Alt+Up', true)).toEqual(['⌃', '⌥', '↑']);
    expect(formatShortcut('Mod+D', false)).toBe('Ctrl+D');
    expect(formatShortcut('Mod+D', true)).toBe('⌘D');
  });
});
