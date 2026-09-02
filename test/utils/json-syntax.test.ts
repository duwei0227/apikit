import { describe, expect, it } from 'vitest';
import { isValidJsonSyntax } from '@/utils/jsonSyntax';

describe('JSON syntax validation', () => {
  it.each([
    '{"nested":[true,false,null,-12.5e+2,"escaped\\ntext"]}',
    ' [ 1, 2, {"unicode":"\\u4f60\\u597d"} ] ',
    '"scalar"',
    '0',
  ])('accepts valid JSON without constructing its value: %s', input => {
    expect(isValidJsonSyntax(input)).toBe(true);
  });

  it.each([
    '',
    '{not-json}',
    '{"trailing":true,}',
    '[1,]',
    '{"missing":}',
    '01',
    '"unterminated',
  ])('rejects invalid JSON: %s', input => {
    expect(isValidJsonSyntax(input)).toBe(false);
  });
});
