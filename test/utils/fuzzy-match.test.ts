import { describe, expect, it } from 'vitest';
import { FUZZY_SCORE, fuzzyFilter, fuzzyScore, nearestMatches, resolveByName, tokenizeQuery } from '@/utils/fuzzyMatch';

const named = (name: string, path?: string, extra?: string[]) => ({ name, path, extra });
const toTarget = (item: ReturnType<typeof named>) => item;

describe('fuzzyMatch', () => {
  it('FUZZY-001 splits the query into lower-case keywords', () => {
    expect(tokenizeQuery('  BPP   服务优化 ')).toEqual(['bpp', '服务优化']);
    expect(tokenizeQuery('')).toEqual([]);
  });

  it('FUZZY-002 ranks exact, prefix, name and path matches', () => {
    expect(fuzzyScore(named('Orders'), 'orders')).toBe(FUZZY_SCORE.exact);
    expect(fuzzyScore(named('Orders v2'), 'orders')).toBe(FUZZY_SCORE.prefix);
    expect(fuzzyScore(named('Create order'), 'ORDER create')).toBe(FUZZY_SCORE.name);
    expect(fuzzyScore(named('服务优化', 'BPP'), 'bpp 优化')).toBe(FUZZY_SCORE.other);
    expect(fuzzyScore(named('List', 'Shop', ['{{baseUrl}}/orders']), '/orders')).toBe(FUZZY_SCORE.other);
    expect(fuzzyScore(named('List', 'Shop'), 'orders')).toBeNull();
    // 所有关键词都要命中
    expect(fuzzyScore(named('Create order'), 'create invoice')).toBeNull();
  });

  it('FUZZY-003 sorts matches by score and keeps the original order for ties', () => {
    const items = [named('Create order'), named('List', 'Orders'), named('Order report'), named('order'), named('Other')];
    expect(fuzzyFilter(items, 'order', toTarget).map(match => match.item.name))
      .toEqual(['order', 'Order report', 'Create order', 'List']);
  });

  it('FUZZY-004 resolves a unique exact name even when others contain it', () => {
    const items = [named('服务优化'), named('服务优化v2')];
    expect(resolveByName(items, '服务优化', toTarget)).toEqual({ kind: 'unique', item: items[0], exact: true });
  });

  it('FUZZY-005 resolves a single partial match and reports several as ambiguous', () => {
    const items = [named('BPP'), named('BPP Admin'), named('Shop')];
    expect(resolveByName(items, 'shop', toTarget)).toMatchObject({ kind: 'unique', exact: true });
    expect(resolveByName(items, 'adm', toTarget)).toEqual({ kind: 'unique', item: items[1], exact: false });
    expect(resolveByName([named('BPP 测试'), named('BPP 正式')], 'bpp', toTarget))
      .toMatchObject({ kind: 'ambiguous', exact: false, candidates: [{ name: 'BPP 测试' }, { name: 'BPP 正式' }] });
    expect(resolveByName([named('A', 'X'), named('A', 'Y')], 'a', toTarget))
      .toMatchObject({ kind: 'ambiguous', exact: true });
    expect(resolveByName(items, 'invoice', toTarget)).toEqual({ kind: 'none' });
  });

  it('FUZZY-006 lists the nearest items when nothing matches all keywords', () => {
    const items = [named('Shop'), named('BPP 服务'), named('BPP Admin')];
    expect(nearestMatches(items, 'bpp 订单', toTarget, 5).map(item => item.name)).toEqual(['BPP 服务', 'BPP Admin']);
    expect(nearestMatches(items, 'zzz', toTarget, 5)).toEqual([]);
  });
});
