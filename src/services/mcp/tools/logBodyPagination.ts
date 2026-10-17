import { fail } from './shared';

export function pageLogBody(text: string, offset: number, limit: number) {
  if (offset > text.length) fail(`offset must not exceed the body length (${text.length})`);
  let start = offset;
  if (start > 0 && start < text.length
    && /[\uDC00-\uDFFF]/.test(text[start])
    && /[\uD800-\uDBFF]/.test(text[start - 1])) {
    start += 1;
  }
  let end = Math.min(start + limit, text.length);
  if (end < text.length && end > 0
    && /[\uD800-\uDBFF]/.test(text[end - 1])
    && /[\uDC00-\uDFFF]/.test(text[end])) {
    end -= 1;
  }
  return {
    body: text.slice(start, end),
    bodyLength: text.length,
    bodyOffset: start,
    nextOffset: end,
    hasMore: end < text.length,
  };
}
