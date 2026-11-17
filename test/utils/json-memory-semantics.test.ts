import { describe, expect, it } from 'vitest';
import { parseJsonPreservingNumbers } from '@/utils/jsonFormat';
import { stripJsonComments } from '@/utils/jsonComments';
import { neutralPlaceholder, validateRawBody } from '@/utils/bodyValidation';

describe('large JSON processing semantics', () => {
  it('preserves long strings, every escape and exact integers', () => {
    const value = 'a'.repeat(200000) + '\"\\/\b\f\n\r\t中文😀\ud800' + 'b'.repeat(200000);
    const raw = `{"value":${JSON.stringify(value)},"id":852633836497678336}`;
    expect(parseJsonPreservingNumbers(raw)).toEqual({ value, id: '852633836497678336' });
    expect(parseJsonPreservingNumbers('"\\u0061\\/\\uD83D\\uDE00"')).toBe('a/😀');
    expect(validateRawBody('json', raw, neutralPlaceholder)).toBeNull();
    expect(stripJsonComments(raw)).toBe(raw);
  });
  it.each(['"\\x"', '"\\u00xx"', '"unterminated', '"a\nb"', '"a\u0000b"', '"\\'])('rejects invalid strings: %j', raw => {
    expect(() => parseJsonPreservingNumbers(raw)).toThrow('Invalid JSON');
  });
  it('preserves comment and error-position semantics across CRLF and block comments', () => {
    const raw = '{\r\n"a": 1, /* comment\r\n comment */\r\n}';
    expect(validateRawBody('json', raw, neutralPlaceholder)).toBeNull();
    expect(parseJsonPreservingNumbers(stripJsonComments(raw))).toEqual({ a: 1 });
    expect(validateRawBody('json', '{/*comment*/"a": 1 "b":2}', neutralPlaceholder))
      .toEqual({ message: 'Comma expected', line: 1, column: 20 });
  });
});
