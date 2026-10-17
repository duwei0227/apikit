mod http;
mod mcp;
mod mock;
mod updater;

use http::PendingRequests;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_app_info() -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "name": env!("CARGO_PKG_NAME"),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pending_requests: PendingRequests = Arc::new(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        .manage(pending_requests)
        .manage(http::HttpClients::default())
        .manage(updater::PendingInstaller::default())
        .manage(mcp::McpState::default())
        .manage(mock::MockState::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_app_info,
            http::send_http_request,
            http::cancel_http_request,
            updater::download_windows_installer,
            updater::launch_windows_installer,
            updater::stop_local_servers,
            mcp::mcp_start,
            mcp::mcp_stop,
            mcp::mcp_status,
            mcp::mcp_respond,
            mcp::mcp_elicit,
            mock::mock_start,
            mock::mock_stop,
            mock::mock_status,
            mock::mock_respond
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // 窗口关闭或应用退出时停止 MCP 服务：释放端口，让还在等待的调用立即得到错误
            if matches!(
                event,
                tauri::RunEvent::Exit
                    | tauri::RunEvent::WindowEvent { event: tauri::WindowEvent::Destroyed, .. }
            ) {
                mcp::stop_on_exit(app);
                mock::stop_on_exit(app);
            }
        });
}
