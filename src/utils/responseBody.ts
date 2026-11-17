import { formatJsonPreservingNumbers, prettyPrintPartialJson } from '@/utils/jsonFormat';
import type { HttpSendResult } from '@/services/api/apiService';

/** 超过这个长度的响应不做 JSON 格式化，避免界面卡顿 */
export const MAX_FORMATTED_RESPONSE_CHARS = 2 * 1024 * 1024;

/** 与格式化共用内容探测，避免 text/plain JSON 落入全文 PRE 布局。 */
export const detectResponseLanguage = (text: string, contentType: string): 'json' | 'xml' | 'html' | 'text' => {
  const type = contentType.toLowerCase();
  if (type.includes('json')) return 'json';
  if (type.includes('xml')) return 'xml';
  if (type.includes('html')) return 'html';
  const body = text.trimStart();
  if (body[0] === '{' || body[0] === '[') return 'json';
  if (body.startsWith('<?xml') || (body.startsWith('<') && body.includes('</'))) {
    if (/<!doctype html|<html/i.test(body)) return 'html';
    return 'xml';
  }
  return 'text';
};

/** 超长行默认横向滚动，避免浏览器为整段文本计算自动换行。 */
export const shouldWrapResponseText = (text: string): boolean => {
  let lineLength = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10 || code === 13) lineLength = 0;
    else if (++lineLength > 10000) return false;
  }
  return true;
};

export const isBinaryContentType = (contentType: string): boolean => (
  contentType.startsWith('image/')
  || contentType.startsWith('audio/')
  || contentType.startsWith('video/')
  || contentType.includes('octet-stream')
  || contentType.includes('pdf')
  || contentType.includes('zip')
  || contentType.includes('gzip')
  || contentType.startsWith('font/')
);

const decodeBase64Text = (base64: string): string => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
};

/** 解析 send_http_request 的结果：文本响应由 Rust 直接以字符串返回，二进制等内容为 base64 */
export const decodeResponseBody = (result: Pick<HttpSendResult, 'body' | 'isBase64'> & Partial<Pick<HttpSendResult, 'bodyBytes'>>, contentType: string) => {
  const isBinaryContent = isBinaryContentType(contentType);
  if (isBinaryContent) {
    return {
      responseText: `[Binary: ${contentType}, ${result.bodyBytes} bytes]`,
      imageDataUrl: contentType.startsWith('image/') && result.isBase64 !== false
        ? `data:${contentType};base64,${result.body}`
        : '',
      isBinaryContent,
    };
  }
  return {
    responseText: result.isBase64 === false ? String(result.body ?? '') : decodeBase64Text(result.body || ''),
    imageDataUrl: '',
    isBinaryContent,
  };
};

/** 格式化 JSON 响应；过大或明显不是 JSON 的内容原样返回 */
export const formatResponseText = (
  responseText: string,
  contentType: string,
  isBinaryContent: boolean,
  options: { allowPartialJson?: boolean } = {},
) => {
  const unchanged = { responseBody: responseText, isPartialJson: false };
  if (isBinaryContent || responseText.length > MAX_FORMATTED_RESPONSE_CHARS) return unchanged;

  const isJsonContent = contentType.toLowerCase().includes('json');
  if (detectResponseLanguage(responseText, contentType) !== 'json') return unchanged;

  try {
    return { responseBody: formatJsonPreservingNumbers(responseText), isPartialJson: false };
  } catch {
    if (options.allowPartialJson && isJsonContent) {
      const partial = prettyPrintPartialJson(responseText);
      if (partial !== responseText) return { responseBody: partial, isPartialJson: true };
    }
    return unchanged;
  }
};
