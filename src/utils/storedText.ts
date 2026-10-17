/** 日志中保存的 body 超过上限时截断，末尾注明原始大小 */
const TRUNCATED_MARKER = /\n… \(truncated, [\d.]+ KB in total\)$/;

/** 不是字符串（例如 null）时原样返回 */
export function truncateStoredText<T>(text: T, limit: number): T;
export function truncateStoredText(text: unknown, limit: number): unknown {
  if (typeof text !== 'string' || text.length <= limit || TRUNCATED_MARKER.test(text)) return text;
  const totalKb = (new Blob([text]).size / 1024).toFixed(1);
  return `${text.slice(0, limit)}\n… (truncated, ${totalKb} KB in total)`;
}
