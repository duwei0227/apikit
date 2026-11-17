import { describe, expect, it } from 'vitest';
import { detectResponseLanguage, shouldWrapResponseText } from '@/utils/responseBody';

describe('response display policy', () => {
  it.each([
    ['text/plain;charset=UTF-8', ' \n[{"id":1}]', 'json'],
    ['', '\uFEFF {"id":1}', 'json'],
    ['Application/JSON', 'null', 'json'],
    ['text/plain', '<root></root>', 'xml'],
    ['text/plain', '<!DOCTYPE html><html></html>', 'html'],
    ['text/plain', 'ordinary text', 'text'],
    ['text/html', '[example]', 'html'],
  ])('detects %s content for the appropriate viewer', (type, body, expected) => {
    expect(detectResponseLanguage(body, type)).toBe(expected);
  });

  it('avoids wrapping a long line anywhere in the response but permits many short lines', () => {
    expect(shouldWrapResponseText('')).toBe(true);
    expect(shouldWrapResponseText('short\n'.repeat(20000))).toBe(true);
    expect(shouldWrapResponseText('x'.repeat(10000))).toBe(true);
    expect(shouldWrapResponseText('header\n' + 'x'.repeat(10001) + '\nfooter')).toBe(false);
    expect(shouldWrapResponseText('header\r' + 'x'.repeat(9000) + '\r' + 'y'.repeat(9000))).toBe(true);
  });
});
