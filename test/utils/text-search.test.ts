import { describe, expect, it } from 'vitest';
import { findTextMatches } from '@/utils/textSearch';

describe('text search', () => {
  it('SEARCH-001 finds plain text, ignoring case by default', () => {
    expect(findTextMatches('Abc abc ABC', 'abc')).toEqual([
      { index: 0, length: 3, text: 'Abc' },
      { index: 4, length: 3, text: 'abc' },
      { index: 8, length: 3, text: 'ABC' },
    ]);
    expect(findTextMatches('Abc abc ABC', 'abc', { caseSensitive: true }).map(m => m.index)).toEqual([4]);
  });

  it('SEARCH-002 finds overlapping plain text matches', () => {
    expect(findTextMatches('aaaa', 'aa').map(m => m.index)).toEqual([0, 1, 2]);
  });

  it('SEARCH-003 finds regular expression matches', () => {
    expect(findTextMatches('"id": 12, "n": 345', '\\d+', { regex: true })).toEqual([
      { index: 6, length: 2, text: '12' },
      { index: 15, length: 3, text: '345' },
    ]);
    expect(findTextMatches('Ab ab', 'a', { regex: true, caseSensitive: true }).map(m => m.index)).toEqual([3]);
  });

  it('SEARCH-004 skips empty matches instead of looping forever', () => {
    expect(findTextMatches('baab', 'a*', { regex: true })).toEqual([{ index: 1, length: 2, text: 'aa' }]);
    expect(findTextMatches('line1\nline2', '^', { regex: true })).toEqual([]);
    expect(findTextMatches('abc', 'x?', { regex: true })).toEqual([]);
  });

  it('SEARCH-005 returns nothing for empty input and throws on an invalid pattern', () => {
    expect(findTextMatches('', 'a')).toEqual([]);
    expect(findTextMatches('abc', '')).toEqual([]);
    expect(() => findTextMatches('abc', '(', { regex: true })).toThrow(SyntaxError);
  });
});
