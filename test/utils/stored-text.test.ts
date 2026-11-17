import { afterEach, describe, expect, it, vi } from 'vitest';
import { truncateStoredText } from '@/utils/storedText';

afterEach(() => vi.unstubAllGlobals());
describe('stored text byte counting', () => {
  it.each(['abc', '中文', '😀', '\ud800', '\udc00', '\ud800A\udc00', '\ud800\ud800\udc00', 'a\r\nb'])('matches UTF-8 byte size without allocating a Blob: %j', sample => {
    const text = sample.repeat(1000);
    const expected = `${text.slice(0, 2)}\n… (truncated, ${(new Blob([text]).size / 1024).toFixed(1)} KB in total)`;
    vi.stubGlobal('Blob', class { constructor() { throw new Error('body-sized Blob allocation'); } });
    expect(truncateStoredText(text, 2)).toBe(expected);
  });
  it('keeps absent, short and already truncated text intact', () => {
    expect(truncateStoredText(null, 2)).toBeNull();
    expect(truncateStoredText('ab', 2)).toBe('ab');
    const text = 'ab\n… (truncated, 100.0 KB in total)';
    expect(truncateStoredText(text, 2)).toBe(text);
  });
});
