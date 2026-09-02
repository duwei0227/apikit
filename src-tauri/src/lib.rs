mod http;

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_app_info,
            http::send_http_request,
            http::cancel_http_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
