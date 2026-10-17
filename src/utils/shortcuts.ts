// 快捷键匹配：mod 表示 Ctrl 或 Cmd，修饰键需要完全一致。
// 字母键不区分大小写（大写锁定时 key 为大写）；修饰键或输入法让 key 不是拉丁字母时
// （如 macOS 上 Option+D 为 "∂"、俄文键盘），按物理按键 code 匹配。

export interface ShortcutSpec {
  /** 字母（如 's'）或按键名（如 '/'、'F1'、'Delete'） */
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

export function matchesShortcut(event: ShortcutEvent, spec: ShortcutSpec): boolean {
  if (Boolean(spec.mod) !== (event.ctrlKey || event.metaKey)) return false;
  if (Boolean(spec.shift) !== event.shiftKey || Boolean(spec.alt) !== event.altKey) return false;
  if (!/^[a-z]$/i.test(spec.key)) return event.key === spec.key;
  const letter = spec.key.toLowerCase();
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase() === letter;
  return event.code === `Key${letter.toUpperCase()}`;
}

export const isMacPlatform = (platform: string = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent) =>
  /Mac|iPhone|iPad/i.test(platform);

const MAC_KEY_LABELS: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Up: '↑', Down: '↓' };
const KEY_LABELS: Record<string, string> = { Mod: 'Ctrl', Up: '↑', Down: '↓' };

/** 把 "Mod+Shift+Z" 拆成显示用的按键：Mod 在 macOS 上为 ⌘，其他系统为 Ctrl */
export function shortcutKeys(combo: string, mac: boolean = isMacPlatform()): string[] {
  const labels = mac ? MAC_KEY_LABELS : KEY_LABELS;
  return combo.split('+').map(key => labels[key] ?? key);
}

/** 菜单里显示的快捷键文字，如 "Ctrl+D"、"⌘D" */
export function formatShortcut(combo: string, mac: boolean = isMacPlatform()): string {
  return shortcutKeys(combo, mac).join(mac ? '' : '+');
}
