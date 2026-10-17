// HTML 预览框里是否提供 "Run scripts" 按钮。
//
// 预览框用不带 allow-same-origin 的 sandbox 隔离。开启脚本的前提是框里的脚本调不到 ApiKit 的本地接口：
// 这一点只在 Linux（WebKitGTK）上实测过——框里没有 __TAURI_INTERNALS__ / ipc，也读不到父页面和存储。
// Windows（WebView2）和 macOS（WKWebView）还没有验证，所以先不提供按钮。
export function htmlPreviewAllowsScripts(userAgent: string = globalThis.navigator?.userAgent ?? ''): boolean {
  return /Linux/i.test(userAgent) && !/Android/i.test(userAgent);
}
