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
}

/** Application metadata returned by `get_app_info`. */
export interface AppInfo {
  name: string;
  version: string;
}

export const apiService = {
  /** Execute an HTTP request on the Rust backend. */
  sendHttpRequest(options: SendHttpRequestOptions): Promise<any> {
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
