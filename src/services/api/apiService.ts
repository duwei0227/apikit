// API Service - Single gateway for all Tauri backend commands.
//
// Centralizes every `invoke()` call so components/stores depend on this
// abstraction instead of `@tauri-apps/api/core` directly (Dependency Inversion).
// This is a thin, behavior-preserving wrapper: each method maps 1:1 to a
// Rust `#[tauri::command]`.

import { invoke } from '@tauri-apps/api/core';

/** Options passed to the `send_http_request` Rust command. */
export interface SendHttpRequestOptions {
  requestId: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  bodyFilePath?: string;
  multipart?: unknown;
  maxRedirections: number;
  verifySsl: boolean;
  acceptEncoding: boolean;
  /** 流式响应（SSE / NDJSON）边接收边通过 `http://stream` 事件推送 */
  streamEvents?: boolean;
}

/** Application metadata returned by `get_app_info`. */
/** `send_http_request` 的结果（Rust 端 HttpResponseResult） */
export interface HttpSendResult {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  /** 文本内容，或 isBase64 为 true 时的 base64 */
  body: string;
  isBase64: boolean;
  durationMs: number;
  bodyBytes: number;
  requestContentType?: string | null;
  /** 响应体是按流式接收的（SSE / NDJSON） */
  streamed?: boolean;
  firstChunkMs?: number | null;
  totalMs?: number | null;
  /** 流式响应没有正常结束的原因："stopped" 表示用户停止，其它为错误信息 */
  interrupted?: string | null;
}

export interface AppInfo {
  name: string;
  version: string;
}

export const apiService = {
  /** Execute an HTTP request on the Rust backend. */
  sendHttpRequest(options: SendHttpRequestOptions): Promise<HttpSendResult> {
    return invoke('send_http_request', { options });
  },

  /** Cancel an in-flight HTTP request by its runtime id. */
  cancelHttpRequest(requestId: string): Promise<boolean> {
    return invoke('cancel_http_request', { requestId });
  },

  /** Read application name/version metadata. */
  getAppInfo(): Promise<AppInfo> {
    return invoke('get_app_info');
  },
};
