// JSON beautifier built on `jsonc-parser` — the same tolerant formatter engine
// VS Code uses for its JSON formatting. It re-indents the token stream without
// requiring a semantically valid parse, so malformed input still formats
// (e.g. `{"as":}` or `{"aa"}`). Because it only edits whitespace between tokens,
// number tokens are preserved verbatim — big-int IDs beyond 2^53 keep full
// precision (unlike JSON.parse + JSON.stringify, which would round them).
//
// Things VS Code does NOT do are layered on in `repairJsonText` so the editor's
// Beautify button is more forgiving:
//   1. Auto-complete missing trailing brackets / unterminated strings (truncated
//      content).
//   2. Escape raw control characters inside strings (real newlines/tabs pasted
//      from logs or rich-text fields) so the result is valid JSON.
//   3. Insert missing commas (`"a": {} "b": 1`), drop duplicate / leading /
//      trailing commas, insert a missing colon, and fill a missing value with
//      `null` (`{"a":}`, `{"a"}`, truncated `{"a":`).
//   4. Convert single-quoted strings to double-quoted ones and quote bare keys
//      (`{'a': 'x', b: 1}`).
import { format, applyEdits, parse, type ParseError } from 'jsonc-parser';

// Matches a `{{variable}}` template placeholder. Variable names never contain
// braces, mirroring the highlight/autocomplete regex in JsonEditor.vue so both
// agree on what counts as a placeholder.
const TEMPLATE_VAR_REGEX = /\{\{[^{}]*?\}\}/g;

// A unique-per-call sentinel base. Unquoted placeholders are swapped for a JSON
// string token built from this so `format` cannot mangle their `{{ }}` braces;
// the random segment makes an accidental collision with literal body text that
// happens to read `"__APIKIT_VAR_n__"` effectively impossible.
const makeSentinelBase = (): string =>
  `__APIKIT_VAR_${Math.random().toString(36).slice(2)}_`;

// Replace every UNQUOTED `{{xxx}}` with a placeholder JSON string so the
// formatter treats it as an opaque value instead of nested object braces.
// Placeholders already inside a quoted string are valid JSON and left untouched.
// Returns the masked text plus the ordered list of original fragments.
const maskTemplateVars = (
  text: string,
): { masked: string; store: string[]; base: string } => {
  const base = makeSentinelBase();
  const store: string[] = [];
  let out = '';
  // Quote char of the string being scanned; single-quoted strings are left
  // alone too, since `repairJsonText` converts them with their content intact.
  let quote = '';
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) { out += ch; escape = false; continue; }
    if (quote) {
      if (ch === '\\') { out += ch; escape = true; continue; }
      if (ch === quote) { out += ch; quote = ''; continue; }
      out += ch;
      continue;
    }

    if (ch === '"' || ch === "'") { out += ch; quote = ch; continue; }

    if (ch === '{' && text[i + 1] === '{') {
      TEMPLATE_VAR_REGEX.lastIndex = i;
      const m = TEMPLATE_VAR_REGEX.exec(text);
      if (m && m.index === i) {
        out += `"${base}${store.length}__"`;
        store.push(m[0]);
        i = TEMPLATE_VAR_REGEX.lastIndex - 1;
        continue;
      }
    }
    out += ch;
  }

  return { masked: out, store, base };
};

// Reverse `maskTemplateVars`: swap each placeholder string token (quotes
// included) back to its original `{{xxx}}` fragment after formatting.
const restoreTemplateVars = (text: string, store: string[], base: string): string => {
  if (store.length === 0) return text;
  const restoreRegex = new RegExp(
    `"${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)__"`,
    'g',
  );
  return text.replace(restoreRegex, (_match, n: string) => store[Number(n)] ?? _match);
};

// Escape a raw control character (code point < 0x20) into its JSON escape form.
const escapeControlChar = (ch: string): string => {
  switch (ch) {
    case '\b': return '\\b';
    case '\f': return '\\f';
    case '\n': return '\\n';
    case '\r': return '\\r';
    case '\t': return '\\t';
    default: return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
  }
};

// Read a string starting at `start` (a `"` or `'`) and return it as a valid
// double-quoted JSON string: raw control characters are escaped, a single-quoted
// string has its inner `"` escaped and `\'` unescaped, and an unterminated
// string is closed at the end of the text.
const readString = (text: string, start: number): { value: string; end: number } => {
  const quote = text[start];
  let value = '"';
  let i = start + 1;

  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1] ?? '';
      value += quote === "'" && next === "'" ? "'" : ch + next;
      i += 2;
      continue;
    }
    if (ch === quote) return { value: value + '"', end: i + 1 };
    if (ch === '"') value += '\\"';
    else if (ch.charCodeAt(0) < 0x20) value += escapeControlChar(ch);
    else value += ch;
    i += 1;
  }

  return { value: value + '"', end: text.length };
};

// Read a `//` or `/* */` comment starting at `start`; an unterminated block
// comment is closed at the end of the text.
const readComment = (text: string, start: number): { value: string; end: number } => {
  if (text[start + 1] === '/') {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    return { value: text.slice(start, end), end };
  }
  const close = text.indexOf('*/', start + 2);
  if (close === -1) return { value: text.slice(start) + '*/', end: text.length };
  return { value: text.slice(start, close + 2), end: close + 2 };
};

const isCommentStart = (text: string, i: number): boolean =>
  text[i] === '/' && (text[i + 1] === '/' || text[i + 1] === '*');

const isWordChar = (text: string, i: number): boolean =>
  !/[\s{}[\],:"']/.test(text[i]) && !isCommentStart(text, i);

// First significant character at or after `start`, skipping whitespace and comments.
const peekSignificant = (text: string, start: number): string => {
  let i = start;
  while (i < text.length) {
    if (/\s/.test(text[i])) { i += 1; continue; }
    if (isCommentStart(text, i)) { i = readComment(text, i).end; continue; }
    return text[i];
  }
  return '';
};

type ObjectState = 'key' | 'colon' | 'value' | 'comma';
type ArrayState = 'value' | 'comma';
type Frame =
  | { type: 'object'; state: ObjectState }
  | { type: 'array'; state: ArrayState };

// Repair common structural mistakes in one pass over the token stream (see the
// header comment), leaving whitespace and comments where they are. The output
// is collected as pieces so a comma, colon or `null` can be attached right
// after the token it belongs to, before any whitespace or comment that follows.
export const repairJsonText = (text: string): string => {
  const pieces: string[] = [];
  const frames: Frame[] = [];
  // Piece of the last value or key token, where a missing comma/colon/null goes.
  let lastToken = -1;
  // Piece of a comma not yet followed by a key/value, removed if a closing
  // bracket comes next — unless a comment sits in between, since a commented-out
  // last item is handled when the body is sent.
  let pendingComma = -1;
  let commentSinceComma = false;

  const top = (): Frame | undefined => frames[frames.length - 1];
  const appendToLast = (suffix: string) => { pieces[lastToken] += suffix; };
  const push = (value: string) => { pieces.push(value); return pieces.length - 1; };
  const dropPendingComma = () => {
    if (pendingComma !== -1 && !commentSinceComma) pieces[pendingComma] = '';
    pendingComma = -1;
  };

  // Called before a key or value token; fixes a missing comma/colon/value first.
  // Returns true when the token is an object key.
  const beforeToken = (isStringLike: boolean, end: number): boolean => {
    const frame = top();
    if (!frame) return false;
    pendingComma = -1;

    if (frame.type === 'array') {
      if (frame.state === 'comma') appendToLast(',');
      frame.state = 'comma';
      return false;
    }

    if (frame.state === 'colon') {
      // `"a" "b": 1` — the previous key had no value; otherwise a missing colon.
      const nextIsKey = isStringLike && peekSignificant(text, end) === ':';
      if (!nextIsKey) {
        appendToLast(':');
        frame.state = 'comma';
        return false;
      }
      appendToLast(': null,');
      frame.state = 'key';
    } else if (frame.state === 'comma') {
      appendToLast(',');
      frame.state = 'key';
    }

    if (frame.state === 'key') {
      frame.state = 'colon';
      return isStringLike;
    }
    frame.state = 'comma';
    return false;
  };

  // Close the innermost frame, filling a missing value first.
  const closeFrame = (frame: Frame) => {
    if (frame.type === 'object' && frame.state === 'colon') appendToLast(': null');
    else if (frame.type === 'object' && frame.state === 'value') lastToken = push('null');
    else dropPendingComma();
    pendingComma = -1;
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (/\s/.test(ch)) {
      push(ch);
      i += 1;
      continue;
    }

    if (isCommentStart(text, i)) {
      const comment = readComment(text, i);
      push(comment.value);
      commentSinceComma = true;
      i = comment.end;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const str = readString(text, i);
      beforeToken(true, str.end);
      lastToken = push(str.value);
      i = str.end;
      continue;
    }

    if (ch === '{' || ch === '[') {
      beforeToken(false, i);
      push(ch);
      frames.push(ch === '{' ? { type: 'object', state: 'key' } : { type: 'array', state: 'value' });
      i += 1;
      continue;
    }

    if (ch === '}' || ch === ']') {
      const frame = top();
      const matches = frame?.type === (ch === '}' ? 'object' : 'array');
      if (frame && matches) {
        closeFrame(frame);
        frames.pop();
      }
      lastToken = push(ch);
      i += 1;
      continue;
    }

    if (ch === ',') {
      const frame = top();
      i += 1;
      if (frame?.type === 'object' && frame.state === 'colon') appendToLast(': null');
      if (frame?.type === 'object' && frame.state === 'value') push('null');
      const isExtraComma = frame && (frame.state === 'key' || (frame.type === 'array' && frame.state === 'value'));
      if (isExtraComma) continue; // duplicate or leading comma
      pendingComma = push(ch);
      commentSinceComma = false;
      if (frame) frame.state = frame.type === 'object' ? 'key' : 'value';
      continue;
    }

    if (ch === ':') {
      const frame = top();
      i += 1;
      if (frame?.type === 'object' && frame.state === 'value') continue; // duplicate colon
      if (frame?.type === 'object' && frame.state === 'colon') frame.state = 'value';
      push(ch);
      continue;
    }

    let end = i;
    while (end < text.length && isWordChar(text, end)) end += 1;
    if (end === i) end = i + 1;
    const word = text.slice(i, end);
    const isKey = beforeToken(true, end);
    lastToken = push(isKey ? JSON.stringify(word) : word);
    i = end;
  }

  // Close whatever is still open (truncated content), innermost first.
  while (frames.length > 0) {
    const frame = frames.pop()!;
    closeFrame(frame);
    lastToken = push(frame.type === 'object' ? '}' : ']');
  }
  return pieces.join('');
};

export const beautifyJsonText = (text: string): string => {
  // Mask unquoted `{{xxx}}` placeholders first so neither sanitizeForFormat's
  // structural repair nor the formatter mistakes their braces for JSON structure.
  const { masked, store, base } = maskTemplateVars(text);
  const sanitized = repairJsonText(masked);

  // Reject input with no object/array structure that also isn't a valid bare
  // JSON value, so Beautify still surfaces "not JSON" feedback for plain text.
  if (!/[{[]/.test(sanitized)) {
    const errors: ParseError[] = [];
    parse(sanitized, errors, { allowTrailingComma: true });
    if (errors.length > 0) {
      throw new Error('No valid JSON content found to beautify');
    }
  }

  const edits = format(sanitized, undefined, {
    tabSize: 2,
    insertSpaces: true,
    eol: '\n',
  });
  return restoreTemplateVars(applyEdits(sanitized, edits), store, base);
};
