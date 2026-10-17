// JSON beautifier built on `jsonc-parser` — the same tolerant formatter engine
// VS Code uses for its JSON formatting. It re-indents the token stream without
// requiring a semantically valid parse, so malformed input still formats
// (e.g. `{"as":}` or `{"aa"}`). Because it only edits whitespace between tokens,
// number tokens are preserved verbatim — big-int IDs beyond 2^53 keep full
// precision (unlike JSON.parse + JSON.stringify, which would round them).
//
// Two things VS Code does NOT do are layered on in `sanitizeForFormat` so the
// editor's Beautify button is more forgiving:
//   1. Auto-complete missing trailing brackets / unterminated strings (truncated
//      content), dropping a dangling trailing comma.
//   2. Escape raw control characters inside strings (real newlines/tabs pasted
//      from logs or rich-text fields) so the result is valid JSON.
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
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) { out += ch; escape = false; continue; }
    if (inString) {
      if (ch === '\\') { out += ch; escape = true; continue; }
      if (ch === '"') { out += ch; inString = false; continue; }
      out += ch;
      continue;
    }

    if (ch === '"') { out += ch; inString = true; continue; }

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

// Single pass over the text that (a) escapes raw control chars inside strings and
// (b) records unbalanced brackets / an unterminated string so the structure can
// be closed. Returns the repaired text. Bracket counting respects string and
// escape state so braces inside string values are never miscounted.
const sanitizeForFormat = (text: string): string => {
  let out = '';
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) { out += ch; escape = false; continue; }
    if (inString) {
      if (ch === '\\') { out += ch; escape = true; continue; }
      if (ch === '"') { out += ch; inString = false; continue; }
      if (ch.charCodeAt(0) < 0x20) { out += escapeControlChar(ch); continue; }
      out += ch;
      continue;
    }

    if (ch === '"') { out += ch; inString = true; continue; }
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack[stack.length - 1] === ch) stack.pop();
    }
    out += ch;
  }

  if (inString) out += '"';                  // close an unterminated string
  if (stack.length > 0) {
    out = out.replace(/,\s*$/, '');          // drop a dangling trailing comma
    while (stack.length > 0) out += stack.pop(); // close innermost-first
  }
  return out;
};

export const beautifyJsonText = (text: string): string => {
  // Mask unquoted `{{xxx}}` placeholders first so neither sanitizeForFormat's
  // bracket balancing nor the formatter mistakes their braces for JSON structure.
  const { masked, store, base } = maskTemplateVars(text);
  const sanitized = sanitizeForFormat(masked);

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
