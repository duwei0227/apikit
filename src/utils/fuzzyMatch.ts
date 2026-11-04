// 名称模糊匹配：按空格拆成多个关键词，全部命中才算匹配，不区分大小写。
// 排序：名称完全相同 > 名称以查询开头 > 名称包含全部关键词 > 关键词分布在路径或其他字段中。

export interface FuzzyTarget {
  name: string;
  /** 从集合到所在位置的名称，例如 "BPP / 服务优化" */
  path?: string;
  /** 其他参与匹配的文本，例如请求的 URL */
  extra?: string[];
}

export const FUZZY_SCORE = {
  exact: 0,
  prefix: 1,
  name: 2,
  other: 3,
} as const;

export interface FuzzyMatch<T> {
  item: T;
  score: number;
}

const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

export function tokenizeQuery(query: string): string[] {
  return normalize(query).split(' ').filter(Boolean);
}

/** 不匹配时返回 null，分数越小越接近 */
export function fuzzyScore(target: FuzzyTarget, query: string): number | null {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return FUZZY_SCORE.other;
  const name = normalize(target.name);
  const whole = normalize(query);
  if (name === whole) return FUZZY_SCORE.exact;
  if (name.startsWith(whole)) return FUZZY_SCORE.prefix;
  if (tokens.every(token => name.includes(token))) return FUZZY_SCORE.name;
  const haystack = [name, target.path, ...(target.extra || [])]
    .filter((text): text is string => typeof text === 'string')
    .map(normalize)
    .join('\n');
  return tokens.every(token => haystack.includes(token)) ? FUZZY_SCORE.other : null;
}

/** 返回匹配项，按分数排序；分数相同时保持原顺序 */
export function fuzzyFilter<T>(items: T[], query: string, toTarget: (item: T) => FuzzyTarget): Array<FuzzyMatch<T>> {
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(toTarget(item), query) }))
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ item, score }) => ({ item, score }));
}

/** 部分关键词命中的项，用于找不到时给出最相近的候选 */
export function nearestMatches<T>(items: T[], query: string, toTarget: (item: T) => FuzzyTarget, limit: number): T[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return items.slice(0, limit);
  return items
    .map((item, index) => {
      const target = toTarget(item);
      const haystack = normalize([target.name, target.path, ...(target.extra || [])].filter(Boolean).join('\n'));
      return { item, index, rank: tokens.filter(token => haystack.includes(token)).length };
    })
    .filter(entry => entry.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .slice(0, limit)
    .map(entry => entry.item);
}

export type FuzzyResolution<T> =
  | { kind: 'unique'; item: T; exact: boolean }
  | { kind: 'ambiguous'; candidates: T[]; exact: boolean }
  | { kind: 'none' };

/**
 * 按名称定位一项：完全同名只有一个时直接使用；没有完全同名时模糊匹配到一个也直接使用；
 * 匹配到多个时交给调用方让用户选择。
 */
export function resolveByName<T>(items: T[], query: string, toTarget: (item: T) => FuzzyTarget): FuzzyResolution<T> {
  const matches = fuzzyFilter(items, query, toTarget);
  const exact = matches.filter(match => match.score === FUZZY_SCORE.exact).map(match => match.item);
  if (exact.length === 1) return { kind: 'unique', item: exact[0], exact: true };
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact, exact: true };
  if (matches.length === 1) return { kind: 'unique', item: matches[0].item, exact: false };
  if (matches.length > 1) return { kind: 'ambiguous', candidates: matches.map(match => match.item), exact: false };
  return { kind: 'none' };
}
