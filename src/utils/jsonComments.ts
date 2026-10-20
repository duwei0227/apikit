// JSON 请求体里的注释：编辑器允许写 `//` 和 `/* */` 注释，发送前去掉。
// 只处理字符串外的注释，`"http://x"` 这类字符串里的 `//` 原样保留；`{{变量}}` 不含引号和斜杠，不受影响。
// 去掉注释后只剩空白的行整行删除；注释掉最后一项后留在 `}` / `]` 前的逗号也一并删除。
// 没有注释时原样返回，不改动任何字符（包括用户自己写的尾逗号）。

interface CommentScan {
  /** 去掉注释后的文本，按原来的行切分 */
  lines: string[];
  /** 哪些行含有被去掉的注释 */
  commentedLines: Set<number>;
}

const scanComments = (text: string): CommentScan | null => {
  let output = '';
  let line = 0;
  const commentedLines = new Set<number>();
  let inString = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (inString) {
      output += char;
      if (char === '\\' && index + 1 < text.length) {
        output += text[index + 1];
        index += 2;
        continue;
      }
      if (char === '"' || char === '\n') inString = false;
      if (char === '\n') line += 1;
      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      index += 1;
      continue;
    }

    const next = text[index + 1];
    if (char === '/' && next === '/') {
      commentedLines.add(line);
      const end = text.indexOf('\n', index);
      index = end === -1 ? text.length : end;
      continue;
    }

    if (char === '/' && next === '*') {
      commentedLines.add(line);
      const close = text.indexOf('*/', index + 2);
      const end = close === -1 ? text.length : close + 2;
      // 块注释跨行时保留其中的换行，后面的行号不变
      for (let position = index; position < end; position++) {
        if (text[position] !== '\n') continue;
        output += '\n';
        line += 1;
        commentedLines.add(line);
      }
      index = end;
      continue;
    }

    output += char;
    if (char === '\n') line += 1;
    index += 1;
  }

  if (commentedLines.size === 0) return null;
  return { lines: output.split('\n'), commentedLines };
};

/** 删除 `}` / `]` 前多余的逗号（中间只隔空白），字符串里的内容不动 */
const removeDanglingCommas = (text: string): string => {
  let output = '';
  let inString = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      output += char;
      if (char === '\\') output += text[++index] ?? '';
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    if (char === ',') {
      let next = index + 1;
      while (next < text.length && /\s/.test(text[next])) next += 1;
      const isDangling = text[next] === '}' || text[next] === ']';
      if (isDangling) continue;
    }
    output += char;
  }

  return output;
};

/** 去掉 JSON 文本中的注释，供发送请求和生成 cURL 使用 */
export function stripJsonComments(text: string): string {
  const scan = scanComments(text);
  if (!scan) return text;

  const kept: string[] = [];
  scan.lines.forEach((content, line) => {
    if (!scan.commentedLines.has(line)) {
      kept.push(content);
      return;
    }
    // 去掉注释留下的行尾空白；整行都是注释时删除这一行
    const trimmed = content.trimEnd();
    if (trimmed.trim()) kept.push(trimmed);
  });

  return removeDanglingCommas(kept.join('\n'));
}
