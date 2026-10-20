import { describe, expect, it } from 'vitest';
import { stripJsonComments } from '@/utils/jsonComments';

describe('stripJsonComments', () => {
  it('removes whole-line, trailing and block comments outside strings', () => {
    const body = [
      '{',
      '  "name": "apikit", // 名称',
      '  // "debug": true,',
      '  /* "tags": ["a"], */',
      '  "url": "http://x/*y*/"',
      '}',
    ].join('\n');
    expect(stripJsonComments(body)).toBe('{\n  "name": "apikit",\n  "url": "http://x/*y*/"\n}');
  });

  it('removes the comma left before } or ] after commenting out the last item', () => {
    expect(stripJsonComments('{\n  "a": 1,\n  // "b": 2\n}')).toBe('{\n  "a": 1\n}');
    expect(stripJsonComments('[\n  1,\n  2, // 3\n]')).toBe('[\n  1,\n  2\n]');
    expect(stripJsonComments('{"a": [1, /* 2 */], "b": "x,}"}')).toBe('{"a": [1 ], "b": "x,}"}');
  });

  it('keeps block comments that span lines out of the result', () => {
    expect(stripJsonComments('{\n  /*\n  "a": 1,\n  */\n  "b": 2\n}')).toBe('{\n  "b": 2\n}');
    expect(stripJsonComments('{"a": 1 /* unterminated')).toBe('{"a": 1');
  });

  it('keeps escaped quotes, slashes in strings and template variables', () => {
    const body = '{\n  "q": "a\\"//b", // c\n  "v": {{id}},\n  "p": "{{base}}//path"\n}';
    expect(stripJsonComments(body)).toBe('{\n  "q": "a\\"//b",\n  "v": {{id}},\n  "p": "{{base}}//path"\n}');
  });

  it('returns the text unchanged when there are no comments', () => {
    const body = '{\n  "a": 1,\n}\n';
    expect(stripJsonComments(body)).toBe(body);
    expect(stripJsonComments('')).toBe('');
  });
});
