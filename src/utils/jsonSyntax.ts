type ObjectState = 'key-or-end' | 'key' | 'colon' | 'value' | 'comma-or-end';
type ArrayState = 'value-or-end' | 'value' | 'comma-or-end';

type JsonFrame =
  | { type: 'object'; state: ObjectState }
  | { type: 'array'; state: ArrayState };

const isWhitespace = (char: string): boolean =>
  char === ' ' || char === '\t' || char === '\n' || char === '\r';

const consumeString = (input: string, start: number): number => {
  if (input[start] !== '"') return -1;

  for (let index = start + 1; index < input.length; index++) {
    const char = input[index];
    if (char === '"') return index + 1;
    if (char.charCodeAt(0) < 0x20) return -1;
    if (char !== '\\') continue;

    const escaped = input[++index];
    if (escaped === undefined) return -1;
    if ('"\\/bfnrt'.includes(escaped)) continue;
    if (escaped !== 'u' || !/^[\da-f]{4}$/i.test(input.slice(index + 1, index + 5))) return -1;
    index += 4;
  }

  return -1;
};

const consumeNumber = (input: string, start: number): number => {
  let index = start;
  if (input[index] === '-') index += 1;
  if (input[index] === '0') {
    index += 1;
  } else {
    if (!/[1-9]/.test(input[index] || '')) return -1;
    while (/\d/.test(input[index] || '')) index += 1;
  }

  if (input[index] === '.') {
    index += 1;
    if (!/\d/.test(input[index] || '')) return -1;
    while (/\d/.test(input[index] || '')) index += 1;
  }

  if (input[index] === 'e' || input[index] === 'E') {
    index += 1;
    if (input[index] === '+' || input[index] === '-') index += 1;
    if (!/\d/.test(input[index] || '')) return -1;
    while (/\d/.test(input[index] || '')) index += 1;
  }

  return index;
};

/** Validate JSON syntax without materializing the parsed value tree. */
export const isValidJsonSyntax = (input: string): boolean => {
  const frames: JsonFrame[] = [];
  let index = 0;
  let rootComplete = false;

  const completeValue = () => {
    const parent = frames.at(-1);
    if (!parent) {
      rootComplete = true;
    } else {
      parent.state = 'comma-or-end';
    }
  };

  const consumeValue = (): boolean => {
    const char = input[index];
    if (char === '{') {
      frames.push({ type: 'object', state: 'key-or-end' });
      index += 1;
      return true;
    }
    if (char === '[') {
      frames.push({ type: 'array', state: 'value-or-end' });
      index += 1;
      return true;
    }

    let next = -1;
    if (char === '"') next = consumeString(input, index);
    else if (char === '-' || /\d/.test(char || '')) next = consumeNumber(input, index);
    else if (input.startsWith('true', index)) next = index + 4;
    else if (input.startsWith('false', index)) next = index + 5;
    else if (input.startsWith('null', index)) next = index + 4;
    if (next < 0) return false;

    index = next;
    completeValue();
    return true;
  };

  while (true) {
    while (index < input.length && isWhitespace(input[index])) index += 1;
    if (rootComplete) return index === input.length;

    const frame = frames.at(-1);
    if (!frame) {
      if (index >= input.length || !consumeValue()) return false;
      continue;
    }

    if (frame.type === 'object') {
      if (frame.state === 'key-or-end' && input[index] === '}') {
        frames.pop();
        index += 1;
        completeValue();
      } else if (frame.state === 'key-or-end' || frame.state === 'key') {
        const next = consumeString(input, index);
        if (next < 0) return false;
        index = next;
        frame.state = 'colon';
      } else if (frame.state === 'colon') {
        if (input[index] !== ':') return false;
        index += 1;
        frame.state = 'value';
      } else if (frame.state === 'value') {
        if (!consumeValue()) return false;
      } else if (input[index] === ',') {
        index += 1;
        frame.state = 'key';
      } else if (input[index] === '}') {
        frames.pop();
        index += 1;
        completeValue();
      } else {
        return false;
      }
    } else if (frame.state === 'value-or-end' && input[index] === ']') {
      frames.pop();
      index += 1;
      completeValue();
    } else if (frame.state === 'value-or-end' || frame.state === 'value') {
      if (!consumeValue()) return false;
    } else if (input[index] === ',') {
      index += 1;
      frame.state = 'value';
    } else if (input[index] === ']') {
      frames.pop();
      index += 1;
      completeValue();
    } else {
      return false;
    }
  }
};
