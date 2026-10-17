// 编辑器和响应区搜索框的查找：普通文本或正则表达式，可区分大小写。

export interface TextMatch {
  /** 在文本中的起始位置（字符偏移） */
  index: number;
  length: number;
  text: string;
}

export interface TextSearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
}

/**
 * 查找所有匹配项。正则表达式无效时抛出 SyntaxError。
 * 能匹配空字符串的正则（例如 `a*`、`^`）跳过空匹配，不会停在同一位置反复匹配。
 */
export function findTextMatches(content: string, query: string, options: TextSearchOptions = {}): TextMatch[] {
  if (!content || !query) return [];
  const matches: TextMatch[] = [];

  if (options.regex) {
    const regex = new RegExp(query, options.caseSensitive ? 'g' : 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      matches.push({ index: match.index, length: match[0].length, text: match[0] });
    }
    return matches;
  }

  const needle = options.caseSensitive ? query : query.toLowerCase();
  const haystack = options.caseSensitive ? content : content.toLowerCase();
  let start = 0;
  while (true) {
    const index = haystack.indexOf(needle, start);
    if (index === -1) break;
    matches.push({ index, length: query.length, text: content.slice(index, index + query.length) });
    start = index + 1;
  }
  return matches;
}
