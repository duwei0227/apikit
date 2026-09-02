/**
 * Pretty-print a JSON string while preserving the exact textual form of numbers.
 *
 * Native `JSON.parse` converts numeric literals to IEEE-754 doubles, which lose
 * precision for integers beyond `Number.MAX_SAFE_INTEGER` (2^53 - 1). For example
 * the Long value `852633836497678336` would be rounded to `852633836497678300`.
 *
 * This is a string-based recursive-descent formatter: numbers are copied verbatim
 * from the source text and never go through `Number`, so large integers keep full
 * precision. Throws on invalid JSON.
 */
export function formatJsonPreservingNumbers(text: string): string {
  const source = String(text);
  let index = 0;

  const indent = (depth: number) => '  '.repeat(depth);
  const fail = (): never => {
    throw new Error('Invalid JSON');
  };
  const skipWhitespace = () => {
    while (/\s/.test(source[index] || '')) index++;
  };
  const parseString = () => {
    const start = index++;

    while (index < source.length) {
      const ch = source[index];

      if (ch === '"') {
        index++;
        return source.slice(start, index);
      }
      if (ch === '\\') {
        const escaped = source[index + 1];
        if (!escaped || !/["\\/bfnrtu]/.test(escaped)) fail();
        index += 2;

        if (escaped === 'u') {
          const hex = source.slice(index, index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
          index += 4;
        }
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) fail();
      index++;
    }

    return fail();
  };
  const parseNumber = () => {
    const match = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    match.lastIndex = index;
    const result = match.exec(source);

    if (!result) fail();
    index = match.lastIndex;
    return result![0];
  };
  const parseKeyword = (keyword: string) => {
    if (!source.startsWith(keyword, index)) fail();
    index += keyword.length;
    return keyword;
  };
  const parseObject = (depth: number): string => {
    const lines: string[] = [];
    index++;
    skipWhitespace();

    if (source[index] === '}') {
      index++;
      return '{}';
    }

    while (index < source.length) {
      if (source[index] !== '"') fail();
      const key = parseString();
      skipWhitespace();
      if (source[index] !== ':') fail();
      index++;
      skipWhitespace();
      lines.push(`${indent(depth + 1)}${key}: ${parseValue(depth + 1)}`);
      skipWhitespace();

      if (source[index] === ',') {
        index++;
        skipWhitespace();
        continue;
      }
      if (source[index] === '}') {
        index++;
        return `{\n${lines.join(',\n')}\n${indent(depth)}}`;
      }
      fail();
    }

    return fail();
  };
  const parseArray = (depth: number): string => {
    const lines: string[] = [];
    index++;
    skipWhitespace();

    if (source[index] === ']') {
      index++;
      return '[]';
    }

    while (index < source.length) {
      lines.push(`${indent(depth + 1)}${parseValue(depth + 1)}`);
      skipWhitespace();

      if (source[index] === ',') {
        index++;
        skipWhitespace();
        continue;
      }
      if (source[index] === ']') {
        index++;
        return `[\n${lines.join(',\n')}\n${indent(depth)}]`;
      }
      fail();
    }

    return fail();
  };
  const parseValue = (depth: number): string => {
    skipWhitespace();

    if (source[index] === '{') return parseObject(depth);
    if (source[index] === '[') return parseArray(depth);
    if (source[index] === '"') return parseString();
    if (source[index] === 't') return parseKeyword('true');
    if (source[index] === 'f') return parseKeyword('false');
    if (source[index] === 'n') return parseKeyword('null');
    return parseNumber();
  };

  const formatted = parseValue(0);
  skipWhitespace();
  if (index !== source.length) fail();
  return formatted;
}

/**
 * Parse a JSON string into JS values while preserving integers that exceed
 * `Number.MAX_SAFE_INTEGER` (e.g. backend Long IDs like 852633836497678336).
 *
 * Such integers are returned as their original **string** token instead of a
 * lossy `number`, so downstream equality checks (`String(value) === ...`) and
 * variable substitution keep full precision. All other values — normal-range
 * numbers, floats, strings, booleans, null, objects, arrays — are returned as
 * ordinary JS values, so existing behavior is unchanged for them.
 *
 * Throws on invalid JSON (callers should try/catch as with `JSON.parse`).
 */
export function parseJsonPreservingNumbers(text: string): any {
  const source = String(text);
  let index = 0;

  const fail = (): never => {
    throw new Error('Invalid JSON');
  };
  const skipWhitespace = () => {
    while (/\s/.test(source[index] || '')) index++;
  };

  const parseString = (): string => {
    index++; // opening quote
    let result = '';

    while (index < source.length) {
      const ch = source[index];

      if (ch === '"') {
        index++;
        return result;
      }
      if (ch === '\\') {
        const escaped = source[index + 1];
        switch (escaped) {
          case '"': result += '"'; break;
          case '\\': result += '\\'; break;
          case '/': result += '/'; break;
          case 'b': result += '\b'; break;
          case 'f': result += '\f'; break;
          case 'n': result += '\n'; break;
          case 'r': result += '\r'; break;
          case 't': result += '\t'; break;
          case 'u': {
            const hex = source.slice(index + 2, index + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
            result += String.fromCharCode(parseInt(hex, 16));
            index += 4;
            break;
          }
          default: fail();
        }
        index += 2;
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) fail();
      result += ch;
      index++;
    }

    return fail();
  };

  const parseNumber = (): number | string => {
    const match = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    match.lastIndex = index;
    const result = match.exec(source);

    if (!result) fail();
    index = match.lastIndex;
    const token = result![0];

    // Plain integers beyond the safe range keep their exact text; everything
    // else (floats, exponents, safe integers) becomes a normal number.
    if (!/[.eE]/.test(token)) {
      const n = Number(token);
      if (!Number.isSafeInteger(n)) return token;
      return n;
    }
    return Number(token);
  };

  const parseKeyword = <T>(keyword: string, value: T): T => {
    if (!source.startsWith(keyword, index)) fail();
    index += keyword.length;
    return value;
  };

  const parseObject = (): Record<string, any> => {
    const obj: Record<string, any> = {};
    index++; // {
    skipWhitespace();

    if (source[index] === '}') {
      index++;
      return obj;
    }

    while (index < source.length) {
      skipWhitespace();
      if (source[index] !== '"') fail();
      const key = parseString();
      skipWhitespace();
      if (source[index] !== ':') fail();
      index++;
      obj[key] = parseValue();
      skipWhitespace();

      if (source[index] === ',') {
        index++;
        continue;
      }
      if (source[index] === '}') {
        index++;
        return obj;
      }
      fail();
    }

    return fail();
  };

  const parseArray = (): any[] => {
    const arr: any[] = [];
    index++; // [
    skipWhitespace();

    if (source[index] === ']') {
      index++;
      return arr;
    }

    while (index < source.length) {
      arr.push(parseValue());
      skipWhitespace();

      if (source[index] === ',') {
        index++;
        continue;
      }
      if (source[index] === ']') {
        index++;
        return arr;
      }
      fail();
    }

    return fail();
  };

  const parseValue = (): any => {
    skipWhitespace();
    const ch = source[index];

    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === '"') return parseString();
    if (ch === 't') return parseKeyword('true', true);
    if (ch === 'f') return parseKeyword('false', false);
    if (ch === 'n') return parseKeyword('null', null);
    return parseNumber();
  };

  const value = parseValue();
  skipWhitespace();
  if (index !== source.length) fail();
  return value;
}
