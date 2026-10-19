// 括号按嵌套层级着色：成对的括号同色，按层级循环使用 BRACKET_COLOR_COUNT 种颜色，
// 多出来的右括号标为未配对。输入输出都是编辑器的 token（type + value），只读 type，
// 着色结果放在 rainbow 字段，不改 type（编辑器的自动配对、括号匹配都按 type 判断）。

export const BRACKET_COLOR_COUNT = 3;
export const UNMATCHED_BRACKET = 'rainbow.rainbow-unmatched';

export interface BracketToken {
  type: string;
  value: string;
  /** 着色用的额外 token 类型，例如 rainbow.rainbow-0 */
  rainbow?: string;
}

/** 一行结束时的括号状态，传给下一行 */
export interface BracketState {
  depth: number;
  /** XML：当前在开始标签、结束标签还是多出来的结束标签里（标签可以跨行） */
  inTag?: 'open' | 'close' | 'unmatched';
}

export type BracketLanguage = 'json' | 'xml';

export const INITIAL_BRACKET_STATE: BracketState = { depth: 0 };

const depthColor = (depth: number) => `rainbow.rainbow-${depth % BRACKET_COLOR_COUNT}`;

/** 状态的字符串形式，状态相同时字符串相同 */
export const bracketStateKey = (state: BracketState) => `${state.depth}${state.inTag ? `:${state.inTag}` : ''}`;

function colorJson(tokens: BracketToken[], start: BracketState) {
  let depth = start.depth;
  const result: BracketToken[] = [];
  for (const token of tokens) {
    const isOpen = token.type === 'paren.lparen';
    if (!isOpen && token.type !== 'paren.rparen') {
      result.push(token);
      continue;
    }
    // 相邻的同类括号会合并成一个 token（例如 "[{"），逐个字符拆开着色
    for (const char of token.value) {
      if (isOpen) {
        result.push({ type: token.type, value: char, rainbow: depthColor(depth) });
        depth++;
      } else if (depth === 0) {
        result.push({ type: token.type, value: char, rainbow: UNMATCHED_BRACKET });
      } else {
        depth--;
        result.push({ type: token.type, value: char, rainbow: depthColor(depth) });
      }
    }
  }
  return { tokens: result, state: { depth } };
}

const isXmlTagPunctuation = (token: BracketToken, kind: string) => token.type === `meta.tag.punctuation.${kind}.xml`;

function colorXml(tokens: BracketToken[], start: BracketState) {
  let { depth, inTag } = start;
  const result = tokens.map((token): BracketToken => {
    if (isXmlTagPunctuation(token, 'tag-open')) {
      inTag = 'open';
      return { ...token, rainbow: depthColor(depth) };
    }
    if (isXmlTagPunctuation(token, 'end-tag-open')) {
      if (depth === 0) {
        inTag = 'unmatched';
        return { ...token, rainbow: UNMATCHED_BRACKET };
      }
      depth--;
      inTag = 'close';
      return { ...token, rainbow: depthColor(depth) };
    }
    if (isXmlTagPunctuation(token, 'tag-close') && inTag) {
      const rainbow = inTag === 'unmatched' ? UNMATCHED_BRACKET : depthColor(depth);
      // 开始标签结束后进入下一层；自闭合标签（/>）不进入
      if (inTag === 'open' && token.value !== '/>') depth++;
      inTag = undefined;
      return { ...token, rainbow };
    }
    return token;
  });
  return { tokens: result, state: inTag ? { depth, inTag } : { depth } };
}

/** 给一行的 token 着色，start 是上一行结束时的状态 */
export function colorBrackets(language: BracketLanguage, tokens: BracketToken[], start: BracketState) {
  return language === 'json' ? colorJson(tokens, start) : colorXml(tokens, start);
}
