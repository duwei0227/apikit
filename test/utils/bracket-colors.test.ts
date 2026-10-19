import { describe, expect, it } from 'vitest';
import { bracketStateKey, colorBrackets, INITIAL_BRACKET_STATE, type BracketToken } from '@/utils/bracketColors';

const colorsOf = (tokens: BracketToken[]) => tokens.filter(t => t.rainbow).map(t => `${t.value}${t.rainbow!.replace('rainbow.rainbow-', '')}`);

describe('bracket colors', () => {
  it('BRACKET-001 colors JSON brackets by depth and splits merged bracket tokens', () => {
    const tokens: BracketToken[] = [
      { type: 'paren.lparen', value: '{' },
      { type: 'variable', value: '"a"' },
      { type: 'paren.lparen', value: '[{' },
      { type: 'paren.lparen', value: '[' },
      { type: 'paren.rparen', value: ']}' },
      { type: 'paren.rparen', value: ']}' },
    ];
    const { tokens: result, state } = colorBrackets('json', tokens, INITIAL_BRACKET_STATE);
    expect(colorsOf(result)).toEqual(['{0', '[1', '{2', '[0', ']0', '}2', ']1', '}0']);
    expect(result.find(t => t.type === 'variable')).toEqual({ type: 'variable', value: '"a"' });
    expect(result.every(t => t.type !== 'rainbow')).toBe(true);
    expect(state).toEqual({ depth: 0 });
  });

  it('BRACKET-002 carries JSON depth to the next line and marks unmatched closing brackets', () => {
    const first = colorBrackets('json', [{ type: 'paren.lparen', value: '{' }, { type: 'paren.lparen', value: '[' }], INITIAL_BRACKET_STATE);
    expect(first.state).toEqual({ depth: 2 });
    const second = colorBrackets('json', [{ type: 'paren.rparen', value: ']}}' }], first.state);
    expect(colorsOf(second.tokens)).toEqual([']1', '}0', '}unmatched']);
    expect(second.state).toEqual({ depth: 0 });
  });

  it('BRACKET-003 colors XML tags by depth, keeping self-closing tags on their level', () => {
    const tag = (kind: string, value: string): BracketToken => ({ type: `meta.tag.punctuation.${kind}.xml`, value });
    const name: BracketToken = { type: 'meta.tag.tag-name.xml', value: 'a' };
    const tokens = [
      tag('tag-open', '<'), name, tag('tag-close', '>'),
      tag('tag-open', '<'), name, tag('tag-close', '/>'),
      tag('tag-open', '<'), name, tag('tag-close', '>'),
      tag('end-tag-open', '</'), name, tag('tag-close', '>'),
      tag('end-tag-open', '</'), name, tag('tag-close', '>'),
      tag('end-tag-open', '</'), name, tag('tag-close', '>'),
    ];
    const { tokens: result, state } = colorBrackets('xml', tokens, INITIAL_BRACKET_STATE);
    expect(colorsOf(result)).toEqual(['<0', '>0', '<1', '/>1', '<1', '>1', '</1', '>1', '</0', '>0', '</unmatched', '>unmatched']);
    expect(state).toEqual({ depth: 0 });
  });

  it('BRACKET-004 keeps an XML tag that spans lines on one level', () => {
    const first = colorBrackets('xml', [
      { type: 'meta.tag.punctuation.tag-open.xml', value: '<' },
      { type: 'meta.tag.tag-name.xml', value: 'root' },
    ], { depth: 1 });
    expect(first.state).toEqual({ depth: 1, inTag: 'open' });
    expect(bracketStateKey(first.state)).not.toBe(bracketStateKey({ depth: 1 }));
    const second = colorBrackets('xml', [{ type: 'meta.tag.punctuation.tag-close.xml', value: '>' }], first.state);
    expect(colorsOf(second.tokens)).toEqual(['>1']);
    expect(second.state).toEqual({ depth: 2 });
  });
});
