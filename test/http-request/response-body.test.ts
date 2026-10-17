import { describe, expect, it } from 'vitest';
import { decodeResponseBody, formatResponseText, MAX_FORMATTED_RESPONSE_CHARS } from '@/utils/responseBody';

const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe('response body decoding', () => {
  it('RESP-001 uses text sent as a string and decodes base64 fallbacks', () => {
    expect(decodeResponseBody({ body: '{"a":"你好"}', isBase64: false }, 'application/json').responseText).toBe('{"a":"你好"}');
    expect(decodeResponseBody({ body: base64('{"a":"你好"}'), isBase64: true }, 'application/json').responseText).toBe('{"a":"你好"}');
    // 带 BOM 的文本由 Rust 以 base64 发送，解码时去掉 BOM
    expect(decodeResponseBody({ body: base64('﻿{}'), isBase64: true }, 'application/json').responseText).toBe('{}');
  });

  it('RESP-002 keeps binary responses as base64 data URLs', () => {
    const result = decodeResponseBody({ body: 'iVBORw==', isBase64: true, bodyBytes: 4 }, 'image/png');
    expect(result.isBinaryContent).toBe(true);
    expect(result.imageDataUrl).toBe('data:image/png;base64,iVBORw==');
    expect(result.responseText).toBe('[Binary: image/png, 4 bytes]');
  });

  it('RESP-003 formats JSON but skips large or non-JSON text', () => {
    expect(formatResponseText('{"a":1}', 'application/json', false).responseBody).toBe('{\n  "a": 1\n}');
    expect(formatResponseText('[1]', 'text/plain', false).responseBody).toContain('1');
    expect(formatResponseText('<html></html>', 'text/html', false).responseBody).toBe('<html></html>');

    const large = `[${'1,'.repeat(MAX_FORMATTED_RESPONSE_CHARS / 2)}1]`;
    expect(formatResponseText(large, 'application/json', false).responseBody).toBe(large);

    const partial = formatResponseText('{"a":1,"b":', 'application/json', false, { allowPartialJson: true });
    expect(partial.isPartialJson).toBe(true);
    expect(formatResponseText('{"a":1,"b":', 'application/json', false).isPartialJson).toBe(false);
  });
});
