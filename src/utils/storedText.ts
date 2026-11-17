/** 日志中保存的 body 超过上限时截断，末尾注明原始大小 */
const TRUNCATED_MARKER = /\n… \(truncated, [\d.]+ KB in total\)$/;

/** UTF-8 字节数；孤立 UTF-16 代理项按 U+FFFD 计数，与 Blob/TextEncoder 一致。 */
const utf8ByteLength = (text: string): number => {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
};

/** 不是字符串（例如 null）时原样返回 */
export function truncateStoredText<T>(text: T, limit: number): T;
export function truncateStoredText(text: unknown, limit: number): unknown {
  if (typeof text !== 'string' || text.length <= limit || TRUNCATED_MARKER.test(text)) return text;
  const totalKb = (utf8ByteLength(text) / 1024).toFixed(1);
  return `${text.slice(0, limit)}\n… (truncated, ${totalKb} KB in total)`;
}
