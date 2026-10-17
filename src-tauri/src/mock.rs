//! 本地 Mock 服务：每个 Mock 服务一个端口，只监听 127.0.0.1。
//!
//! 路由匹配和响应生成都在前端：Rust 收到请求后发出 `mock://request` 事件，
//! 前端选好响应后通过 `mock_respond` 返回，Rust 按响应的延迟等待后再回复调用方。
//! 开启 CORS 时，预检请求由 Rust 直接应答，不交给前端。

use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex};

/// 前端没有及时回复（例如窗口正在重新加载）时返回 504
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REQUEST_BODY: usize = 10 * 1024 * 1024;
const MAX_DELAY: Duration = Duration::from_secs(60);
/// 重启时等待旧服务释放端口的上限，超时后强制结束
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const ALLOWED_METHODS: &str = "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockReply {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
    delay_ms: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MockRequestEvent {
    id: String,
    service_id: String,
    method: String,
    path: String,
    query: String,
    headers: Vec<(String, String)>,
    body: String,
}

type PendingReplies = Arc<Mutex<HashMap<String, oneshot::Sender<MockReply>>>>;

struct RunningMock {
    port: u16,
    shutdown: oneshot::Sender<()>,
    task: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Default)]
pub struct MockState {
    servers: Mutex<HashMap<String, RunningMock>>,
    pending: PendingReplies,
    next_id: Arc<AtomicU64>,
}

struct ServerShared {
    app: AppHandle,
    service_id: String,
    cors: bool,
    pending: PendingReplies,
    next_id: Arc<AtomicU64>,
}

async fn shutdown_server(running: RunningMock) {
    let _ = running.shutdown.send(());
    let task = running.task;
    let abort = task.inner().abort_handle();
    if tokio::time::timeout(SHUTDOWN_TIMEOUT, task).await.is_err() {
        abort.abort();
    }
}

#[tauri::command]
pub async fn mock_start(
    app: AppHandle,
    state: tauri::State<'_, MockState>,
    service_id: String,
    port: u16,
    cors: bool,
) -> Result<(), String> {
    let mut servers = state.servers.lock().await;
    if let Some(running) = servers.remove(&service_id) {
        shutdown_server(running).await;
    }
    if servers.values().any(|running| running.port == port) {
        return Err(format!("Port {} is used by another mock service", port));
    }

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("Port {} is unavailable: {}", port, e))?;

    let shared = Arc::new(ServerShared {
        app,
        service_id: service_id.clone(),
        cors,
        pending: state.pending.clone(),
        next_id: state.next_id.clone(),
    });
    let router = Router::new().fallback(handle_request).with_state(shared);

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let task = tauri::async_runtime::spawn(async move {
        let result = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await;
        if let Err(error) = result {
            eprintln!("Mock server stopped with error: {}", error);
        }
    });

    servers.insert(service_id, RunningMock { port, shutdown: shutdown_tx, task });
    Ok(())
}

#[tauri::command]
pub async fn mock_stop(state: tauri::State<'_, MockState>, service_id: String) -> Result<(), String> {
    if let Some(running) = state.servers.lock().await.remove(&service_id) {
        shutdown_server(running).await;
    }
    Ok(())
}

/// 正在运行的服务：[{ serviceId, port }]
#[tauri::command]
pub async fn mock_status(state: tauri::State<'_, MockState>) -> Result<Value, String> {
    let servers = state.servers.lock().await;
    Ok(Value::Array(
        servers
            .iter()
            .map(|(id, running)| json!({ "serviceId": id, "port": running.port }))
            .collect(),
    ))
}

#[tauri::command]
pub async fn mock_respond(state: tauri::State<'_, MockState>, id: String, reply: MockReply) -> Result<(), String> {
    if let Some(sender) = state.pending.lock().await.remove(&id) {
        let _ = sender.send(reply);
    }
    Ok(())
}

/// 窗口关闭或应用退出时停止所有服务，释放端口
pub fn stop_on_exit(app: &AppHandle) {
    tauri::async_runtime::block_on(stop_all(app));
}

/// 停止所有 Mock 服务并释放端口：更新重启前，以及窗口关闭或应用退出时调用
pub async fn stop_all(app: &AppHandle) {
    let state = app.state::<MockState>();
    let running: Vec<RunningMock> = state.servers.lock().await.drain().map(|(_, running)| running).collect();
    for server in running {
        shutdown_server(server).await;
    }
    state.pending.lock().await.clear();
}

async fn handle_request(State(shared): State<Arc<ServerShared>>, request: Request) -> Response {
    let origin = request.headers().get(header::ORIGIN).cloned();
    if shared.cors && is_preflight(request.method(), request.headers()) {
        return preflight_response(origin.as_ref(), request.headers());
    }

    let method = request.method().to_string();
    let path = request.uri().path().to_string();
    let query = request.uri().query().unwrap_or("").to_string();
    let headers = header_pairs(request.headers());
    let body = match to_bytes(request.into_body(), MAX_REQUEST_BODY).await {
        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        Err(_) => return error_response(StatusCode::PAYLOAD_TOO_LARGE, "The request body is larger than 10 MB", shared.cors, origin.as_ref()),
    };

    let id = format!("mock-{}", shared.next_id.fetch_add(1, Ordering::Relaxed) + 1);
    let (reply_tx, reply_rx) = oneshot::channel();
    shared.pending.lock().await.insert(id.clone(), reply_tx);

    let event = MockRequestEvent { id: id.clone(), service_id: shared.service_id.clone(), method, path, query, headers, body };
    if shared.app.emit("mock://request", event).is_err() {
        shared.pending.lock().await.remove(&id);
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, "ApiKit could not handle the request", shared.cors, origin.as_ref());
    }

    let reply = match tokio::time::timeout(RESPONSE_TIMEOUT, reply_rx).await {
        Ok(Ok(reply)) => reply,
        _ => {
            shared.pending.lock().await.remove(&id);
            return error_response(StatusCode::GATEWAY_TIMEOUT, "ApiKit did not answer in time", shared.cors, origin.as_ref());
        }
    };

    let delay = Duration::from_millis(reply.delay_ms).min(MAX_DELAY);
    if !delay.is_zero() {
        tokio::time::sleep(delay).await;
    }
    build_response(reply, shared.cors, origin.as_ref())
}

fn header_pairs(headers: &HeaderMap) -> Vec<(String, String)> {
    headers
        .iter()
        .map(|(name, value)| (name.as_str().to_string(), String::from_utf8_lossy(value.as_bytes()).into_owned()))
        .collect()
}

fn is_preflight(method: &Method, headers: &HeaderMap) -> bool {
    method == Method::OPTIONS && headers.contains_key(header::ACCESS_CONTROL_REQUEST_METHOD)
}

/// 允许发起请求的页面读取响应：有 Origin 时回显它（这样也能带 Cookie），否则为 *
fn cors_headers(origin: Option<&HeaderValue>) -> Vec<(HeaderName, HeaderValue)> {
    match origin {
        Some(origin) => vec![
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.clone()),
            (header::ACCESS_CONTROL_ALLOW_CREDENTIALS, HeaderValue::from_static("true")),
            (header::ACCESS_CONTROL_EXPOSE_HEADERS, HeaderValue::from_static("*")),
            (header::VARY, HeaderValue::from_static("Origin")),
        ],
        None => vec![
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*")),
            (header::ACCESS_CONTROL_EXPOSE_HEADERS, HeaderValue::from_static("*")),
        ],
    }
}

fn preflight_response(origin: Option<&HeaderValue>, headers: &HeaderMap) -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    let response_headers = response.headers_mut();
    for (name, value) in cors_headers(origin) {
        response_headers.insert(name, value);
    }
    response_headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static(ALLOWED_METHODS));
    let allow_headers = headers
        .get(header::ACCESS_CONTROL_REQUEST_HEADERS)
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_static("*"));
    response_headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, allow_headers);
    response_headers.insert(header::ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("600"));
    response
}

fn error_response(status: StatusCode, message: &str, cors: bool, origin: Option<&HeaderValue>) -> Response {
    let reply = MockReply {
        status: status.as_u16(),
        headers: vec![("content-type".to_string(), "application/json".to_string())],
        body: json!({ "error": message }).to_string(),
        delay_ms: 0,
    };
    build_response(reply, cors, origin)
}

/// 由前端的答复生成响应。无效的状态码按 500 处理，无效的响应头和由服务器决定的长度类响应头跳过
fn build_response(reply: MockReply, cors: bool, origin: Option<&HeaderValue>) -> Response {
    let status = StatusCode::from_u16(reply.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut response = Response::new(Body::from(reply.body));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    for (name, value) in reply.headers {
        let (Ok(name), Ok(value)) = (HeaderName::from_bytes(name.trim().as_bytes()), HeaderValue::from_str(value.trim())) else {
            continue;
        };
        if name == header::CONTENT_LENGTH || name == header::TRANSFER_ENCODING || name == header::CONNECTION {
            continue;
        }
        headers.append(name, value);
    }
    if cors {
        for (name, value) in cors_headers(origin) {
            if !headers.contains_key(&name) {
                headers.insert(name, value);
            }
        }
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reply(status: u16, headers: &[(&str, &str)]) -> MockReply {
        MockReply {
            status,
            headers: headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            body: "{}".to_string(),
            delay_ms: 0,
        }
    }

    #[test]
    fn detects_preflight_requests() {
        let mut headers = HeaderMap::new();
        assert!(!is_preflight(&Method::OPTIONS, &headers));
        headers.insert(header::ACCESS_CONTROL_REQUEST_METHOD, HeaderValue::from_static("POST"));
        assert!(is_preflight(&Method::OPTIONS, &headers));
        assert!(!is_preflight(&Method::GET, &headers));
    }

    #[test]
    fn answers_preflight_with_requested_headers() {
        let mut headers = HeaderMap::new();
        headers.insert(header::ACCESS_CONTROL_REQUEST_HEADERS, HeaderValue::from_static("authorization, content-type"));
        let origin = HeaderValue::from_static("http://localhost:5173");
        let response = preflight_response(Some(&origin), &headers);
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let got = response.headers();
        assert_eq!(got[header::ACCESS_CONTROL_ALLOW_ORIGIN], "http://localhost:5173");
        assert_eq!(got[header::ACCESS_CONTROL_ALLOW_HEADERS], "authorization, content-type");
        assert_eq!(got[header::ACCESS_CONTROL_ALLOW_METHODS], ALLOWED_METHODS);
    }

    #[test]
    fn builds_responses_from_replies() {
        let response = build_response(
            reply(404, &[("Content-Type", "application/json"), ("Content-Length", "99"), ("Bad Header", "x"), ("X-A", "1"), ("X-A", "2")]),
            true,
            None,
        );
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let headers = response.headers();
        assert_eq!(headers[header::CONTENT_TYPE], "application/json");
        assert!(headers.get(header::CONTENT_LENGTH).is_none());
        assert_eq!(headers.get_all("x-a").iter().count(), 2);
        assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");

        // 响应自己设置的 CORS 头优先；关闭 CORS 时不添加
        let own = build_response(reply(200, &[("Access-Control-Allow-Origin", "https://a.example")]), true, None);
        assert_eq!(own.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "https://a.example");
        let off = build_response(reply(200, &[]), false, None);
        assert!(off.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());

        assert_eq!(build_response(reply(1000, &[]), false, None).status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
