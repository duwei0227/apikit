//! 内置 MCP 服务（Streamable HTTP，无状态，只返回 JSON）。
//!
//! 只监听 127.0.0.1，要求 Bearer token。工具定义和执行都在前端：
//! Rust 收到 `tools/call` 后发出 `mcp://call` 事件，前端执行完通过 `mcp_respond` 返回结果。
//!
//! 客户端在 `initialize` 里声明了 elicitation 能力时会得到一个会话；这类会话调用需要用户确认的
//! 工具时，应答改为事件流（SSE），前端可以通过 `mcp_elicit` 让客户端弹出确认。

use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use serde_json::{json, Value};
use futures_core::Stream;
use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot, Mutex};

const SUPPORTED_PROTOCOL_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL_VERSION: &str = "2025-06-18";
/// 执行类工具要等用户在界面里确认，运行 workflow 也可能很久
const TOOL_CALL_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const MIN_TOKEN_LENGTH: usize = 16;
/// 重启时等待旧服务释放端口的上限，超时后强制结束
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
/// 事件流空闲时定期发注释行，避免客户端超时，也用来发现客户端已断开
const SSE_KEEP_ALIVE: Duration = Duration::from_secs(15);
const MAX_SESSIONS: usize = 256;
const SESSION_HEADER: &str = "mcp-session-id";

const SERVER_INSTRUCTIONS: &str = "ApiKit is a desktop API client. Collections hold folders and saved HTTP requests; \
workflows chain requests with if/for/while/doWhile/until steps. Pass each tool's arguments as direct fields from its input schema; do not wrap them in a params object. The params field inside a request definition is an array of HTTP URL query parameters, not a tool-argument wrapper. Call list_collections, list_workflows and \
list_environments first to find ids; search_requests accepts query, method, collectionId and limit as direct arguments; use query to search a name or URL fragment, and do not use keyword. Requests use {{name}} placeholders that resolve from the active environment \
and global variables; create_environment, update_environment and set_global_variables manage them. \
list_builtin_variables lists built-in dynamic variables such as {{$timestamp}} and {{$guid}}. get_request_log and get_workflow_logs return bodies in pages; follow hasMore and nextOffset to retrieve the full body. send_request returns logId for retrieving its full response with get_request_log. send_request and \
run_workflow make real network calls and, like set_active_environment and the delete_* tools, wait for the user to approve them. Request and workflow updates follow ApiKit's configured edit mode: they may stage changes on top of an existing draft, or save directly (which fails when a draft exists). Follow each tool's result and description.";

type PendingCalls = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;
/// 调用 id -> 这次调用的事件流
type EventStreams = Arc<Mutex<HashMap<String, mpsc::UnboundedSender<String>>>>;
/// elicitation 请求 id -> (调用 id, 等待客户端答复的一方)
type PendingElicitations = Arc<Mutex<HashMap<String, (String, oneshot::Sender<Value>)>>>;

struct RunningServer {
    port: u16,
    shutdown: oneshot::Sender<()>,
    task: tauri::async_runtime::JoinHandle<()>,
}

/// 停止服务并等它释放端口；未完成的调用直接返回错误，避免客户端一直等待
async fn shutdown_server(running: RunningServer, state: &McpState) {
    let _ = running.shutdown.send(());
    state.elicitations.lock().await.clear();
    for (_, sender) in state.pending.lock().await.drain() {
        let _ = sender.send(tool_error("ApiKit stopped the MCP server"));
    }
    state.streams.lock().await.clear();
    let task = running.task;
    let abort = task.inner().abort_handle();
    if tokio::time::timeout(SHUTDOWN_TIMEOUT, task).await.is_err() {
        abort.abort();
    }
}

#[derive(Default)]
pub struct McpState {
    server: Mutex<Option<RunningServer>>,
    pending: PendingCalls,
    streams: EventStreams,
    elicitations: PendingElicitations,
    next_elicitation_id: AtomicU64,
}

struct ServerShared {
    app: AppHandle,
    port: u16,
    token: String,
    tools: Value,
    /// 可能需要用户确认的工具
    confirm_tools: Vec<String>,
    /// 声明了 elicitation 能力的客户端会话
    sessions: Mutex<HashSet<String>>,
    pending: PendingCalls,
    streams: EventStreams,
    elicitations: PendingElicitations,
    next_call_id: AtomicU64,
}

#[tauri::command]
pub async fn mcp_start(
    app: AppHandle,
    state: tauri::State<'_, McpState>,
    port: u16,
    token: String,
    tools: Value,
    confirm_tools: Vec<String>,
) -> Result<(), String> {
    if token.len() < MIN_TOKEN_LENGTH {
        return Err("The MCP token is too short".to_string());
    }
    if !tools.is_array() {
        return Err("Invalid MCP tool list".to_string());
    }

    let mut server = state.server.lock().await;
    if let Some(running) = server.take() {
        shutdown_server(running, &state).await;
    }

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("Port {} is unavailable: {}", port, e))?;

    let shared = Arc::new(ServerShared {
        app,
        port,
        token,
        tools,
        confirm_tools,
        sessions: Mutex::new(HashSet::new()),
        pending: state.pending.clone(),
        streams: state.streams.clone(),
        elicitations: state.elicitations.clone(),
        next_call_id: AtomicU64::new(1),
    });
    let router = Router::new()
        .route("/mcp", post(handle_post).get(method_not_allowed).delete(method_not_allowed))
        .with_state(shared);

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let task = tauri::async_runtime::spawn(async move {
        let result = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await;
        if let Err(error) = result {
            eprintln!("MCP server stopped with error: {}", error);
        }
    });

    *server = Some(RunningServer { port, shutdown: shutdown_tx, task });
    Ok(())
}

#[tauri::command]
pub async fn mcp_stop(state: tauri::State<'_, McpState>) -> Result<(), String> {
    if let Some(running) = state.server.lock().await.take() {
        shutdown_server(running, &state).await;
    }
    Ok(())
}

/// 停止服务并释放端口：更新重启前，以及窗口关闭或应用退出时调用
pub async fn stop_all(app: &AppHandle) {
    let state = app.state::<McpState>();
    if let Some(running) = state.server.lock().await.take() {
        shutdown_server(running, &state).await;
    }
}

/// 窗口关闭或应用退出时调用：执行工具的前端已经不在了，服务不能继续接受连接
pub fn stop_on_exit(app: &AppHandle) {
    tauri::async_runtime::block_on(stop_all(app));
}

#[tauri::command]
pub async fn mcp_status(state: tauri::State<'_, McpState>) -> Result<Value, String> {
    let server = state.server.lock().await;
    Ok(json!({
        "running": server.is_some(),
        "port": server.as_ref().map(|running| running.port),
    }))
}

#[tauri::command]
pub async fn mcp_respond(
    state: tauri::State<'_, McpState>,
    id: String,
    result: Value,
) -> Result<(), String> {
    if let Some(sender) = state.pending.lock().await.remove(&id) {
        let _ = sender.send(result);
    }
    Ok(())
}

/// 让客户端向用户弹出确认，返回客户端答复的 JSON-RPC 消息（含 result 或 error）。
/// 只对事件流应答中的调用有效；客户端已断开时按取消处理。
#[tauri::command]
pub async fn mcp_elicit(
    state: tauri::State<'_, McpState>,
    call_id: String,
    message: String,
    requested_schema: Value,
) -> Result<Value, String> {
    let Some(stream) = state.streams.lock().await.get(&call_id).cloned() else {
        return Err("This call cannot ask in the AI tool".to_string());
    };

    let elicitation_id = format!("apikit-elicit-{}", state.next_elicitation_id.fetch_add(1, Ordering::Relaxed) + 1);
    let (reply_tx, reply_rx) = oneshot::channel();
    state.elicitations.lock().await.insert(elicitation_id.clone(), (call_id, reply_tx));

    let request = json!({
        "jsonrpc": "2.0",
        "id": elicitation_id,
        "method": "elicitation/create",
        "params": { "message": message, "requestedSchema": requested_schema },
    });
    if stream.send(sse_message(&request)).is_err() {
        state.elicitations.lock().await.remove(&elicitation_id);
        return Ok(elicitation_cancelled());
    }

    match tokio::time::timeout(TOOL_CALL_TIMEOUT, reply_rx).await {
        Ok(Ok(reply)) => Ok(reply),
        Ok(Err(_)) => Ok(elicitation_cancelled()),
        Err(_) => {
            state.elicitations.lock().await.remove(&elicitation_id);
            Ok(elicitation_cancelled())
        }
    }
}

async fn method_not_allowed() -> Response {
    (StatusCode::METHOD_NOT_ALLOWED, [(header::ALLOW, "POST")]).into_response()
}

async fn handle_post(State(shared): State<Arc<ServerShared>>, headers: HeaderMap, body: Bytes) -> Response {
    if !is_allowed_host(&headers, shared.port) || !is_allowed_origin(&headers) {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }
    if !is_authorized(&headers, &shared.token) {
        return (StatusCode::UNAUTHORIZED, "Invalid or missing bearer token").into_response();
    }

    let message: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => return json_response(StatusCode::BAD_REQUEST, rpc_error(Value::Null, -32700, "Parse error")),
    };
    if message.is_array() {
        return json_response(
            StatusCode::BAD_REQUEST,
            rpc_error(Value::Null, -32600, "Batch requests are not supported"),
        );
    }

    let method = message.get("method").and_then(Value::as_str);
    let session = headers.get(SESSION_HEADER).and_then(|value| value.to_str().ok());
    if method != Some("initialize") {
        if let Some(session) = session {
            // ApiKit 重启后旧会话失效，客户端收到 404 会重新初始化
            if !shared.sessions.lock().await.contains(session) {
                return (StatusCode::NOT_FOUND, "Unknown session").into_response();
            }
        }
    }

    let id = message.get("id").cloned().filter(|id| !id.is_null());
    let (Some(method), Some(id)) = (method, id) else {
        if method.is_none() {
            deliver_client_response(&shared.elicitations, &message).await;
        }
        // 通知或客户端发来的响应，无需回复
        return StatusCode::ACCEPTED.into_response();
    };
    let params = message.get("params").cloned().unwrap_or(Value::Null);

    let reply = match method {
        "initialize" => {
            let reply = rpc_result(id, initialize_result(&params));
            if !supports_elicitation(&params) {
                return json_response(StatusCode::OK, reply);
            }
            let session = new_session_id();
            {
                let mut sessions = shared.sessions.lock().await;
                if sessions.len() >= MAX_SESSIONS {
                    sessions.clear();
                }
                sessions.insert(session.clone());
            }
            let mut response = json_response(StatusCode::OK, reply);
            if let Ok(value) = HeaderValue::from_str(&session) {
                response.headers_mut().insert(SESSION_HEADER, value);
            }
            return response;
        }
        "ping" => rpc_result(id, json!({})),
        "tools/list" => rpc_result(id, json!({ "tools": shared.tools })),
        "tools/call" => {
            let (name, arguments) = match parse_tool_call(&shared, &params) {
                Ok(call) => call,
                Err((code, message)) => return json_response(StatusCode::OK, rpc_error(id, code, &message)),
            };
            // 只有会话声明了 elicitation、且工具可能要确认时才用事件流应答
            if session.is_some() && accepts_event_stream(&headers) && shared.confirm_tools.contains(&name) {
                return call_tool_stream(shared.clone(), id, name, arguments).await;
            }
            let call_id = new_call_id(&shared);
            rpc_result(id, run_tool(&shared, &call_id, &name, arguments, false).await)
        }
        _ => rpc_error(id, -32601, "Method not found"),
    };
    json_response(StatusCode::OK, reply)
}

/// 把客户端对 elicitation/create 的答复交给等待它的一方
async fn deliver_client_response(elicitations: &PendingElicitations, message: &Value) {
    let Some(id) = message.get("id").and_then(Value::as_str) else {
        return;
    };
    if message.get("result").is_none() && message.get("error").is_none() {
        return;
    }
    if let Some((_, sender)) = elicitations.lock().await.remove(id) {
        let _ = sender.send(message.clone());
    }
}

/// 客户端断开后，把它还没答复的 elicitation 按取消处理
async fn cancel_elicitations(elicitations: &PendingElicitations, call_id: &str) {
    let mut elicitations = elicitations.lock().await;
    let ids: Vec<String> = elicitations
        .iter()
        .filter(|(_, (owner, _))| owner == call_id)
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        if let Some((_, sender)) = elicitations.remove(&id) {
            let _ = sender.send(elicitation_cancelled());
        }
    }
}

fn elicitation_cancelled() -> Value {
    json!({ "result": { "action": "cancel" } })
}

fn supports_elicitation(params: &Value) -> bool {
    params
        .get("capabilities")
        .and_then(|capabilities| capabilities.get("elicitation"))
        .is_some_and(Value::is_object)
}

fn accepts_event_stream(headers: &HeaderMap) -> bool {
    headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|accept| accept.to_ascii_lowercase().contains("text/event-stream"))
}

fn new_session_id() -> String {
    use std::hash::{BuildHasher, Hasher};
    // RandomState 的密钥来自操作系统的随机数
    let part = || {
        let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
        hasher.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_nanos())
                .unwrap_or_default(),
        );
        hasher.finish()
    };
    format!("{:016x}{:016x}", part(), part())
}

fn new_call_id(shared: &ServerShared) -> String {
    format!("call-{}", shared.next_call_id.fetch_add(1, Ordering::Relaxed))
}

fn sse_message(message: &Value) -> String {
    format!("event: message\ndata: {}\n\n", message)
}

struct EventStream(mpsc::UnboundedReceiver<String>);

impl Stream for EventStream {
    type Item = Result<String, Infallible>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.0.poll_recv(cx).map(|event| event.map(Ok))
    }
}

/// 以事件流应答 tools/call：结果之前可以先发 elicitation/create 请求
async fn call_tool_stream(shared: Arc<ServerShared>, id: Value, name: String, arguments: Value) -> Response {
    let call_id = new_call_id(&shared);
    let (events, receiver) = mpsc::unbounded_channel::<String>();
    shared.streams.lock().await.insert(call_id.clone(), events.clone());

    tauri::async_runtime::spawn(async move {
        let result = {
            let run = run_tool(&shared, &call_id, &name, arguments, true);
            tokio::pin!(run);
            let mut keep_alive = tokio::time::interval(SSE_KEEP_ALIVE);
            keep_alive.tick().await;
            let mut connected = true;
            loop {
                tokio::select! {
                    result = &mut run => break result,
                    _ = keep_alive.tick(), if connected => {
                        if events.send(": keep-alive\n\n".to_string()).is_err() {
                            connected = false;
                            cancel_elicitations(&shared.elicitations, &call_id).await;
                        }
                    }
                }
            }
        };
        shared.streams.lock().await.remove(&call_id);
        let _ = events.send(sse_message(&rpc_result(id, result)));
    });

    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/event-stream"), (header::CACHE_CONTROL, "no-cache")],
        Body::from_stream(EventStream(receiver)),
    )
        .into_response()
}

fn initialize_result(params: &Value) -> Value {
    let requested = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("");
    let version = if SUPPORTED_PROTOCOL_VERSIONS.contains(&requested) {
        requested
    } else {
        LATEST_PROTOCOL_VERSION
    };
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": "apikit", "version": env!("CARGO_PKG_VERSION") },
        "instructions": SERVER_INSTRUCTIONS,
    })
}

/// 取出工具名和参数；工具不存在时返回 JSON-RPC 错误码和消息
fn parse_tool_call(shared: &ServerShared, params: &Value) -> Result<(String, Value), (i64, String)> {
    let Some(name) = params.get("name").and_then(Value::as_str) else {
        return Err((-32602, "Missing tool name".to_string()));
    };
    let known = shared
        .tools
        .as_array()
        .map(|tools| tools.iter().any(|tool| tool.get("name").and_then(Value::as_str) == Some(name)))
        .unwrap_or(false);
    if !known {
        return Err((-32602, format!("Unknown tool: {}", name)));
    }
    let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    Ok((name.to_string(), arguments))
}

/// 把调用交给前端执行并等待结果；can_elicit 表示这次调用可以通过 mcp_elicit 在客户端里确认
async fn run_tool(shared: &ServerShared, call_id: &str, name: &str, arguments: Value, can_elicit: bool) -> Value {
    let (tx, rx) = oneshot::channel();
    shared.pending.lock().await.insert(call_id.to_string(), tx);

    let event = json!({ "id": call_id, "name": name, "arguments": arguments, "canElicit": can_elicit });
    if let Err(error) = shared.app.emit("mcp://call", event) {
        shared.pending.lock().await.remove(call_id);
        return tool_error(&format!("Failed to reach ApiKit: {}", error));
    }

    match tokio::time::timeout(TOOL_CALL_TIMEOUT, rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => tool_error("ApiKit did not return a result"),
        Err(_) => {
            shared.pending.lock().await.remove(call_id);
            tool_error("Timed out waiting for ApiKit")
        }
    }
}

fn tool_error(message: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": message }], "isError": true })
}

fn rpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn json_response(status: StatusCode, body: Value) -> Response {
    (status, [(header::CONTENT_TYPE, "application/json")], body.to_string()).into_response()
}

fn is_authorized(headers: &HeaderMap, token: &str) -> bool {
    let Some(value) = headers.get(header::AUTHORIZATION).and_then(|value| value.to_str().ok()) else {
        return false;
    };
    let Some(provided) = value.strip_prefix("Bearer ").map(str::trim) else {
        return false;
    };
    constant_time_eq(provided.as_bytes(), token.as_bytes())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// 防 DNS rebinding：Host 只能是本机地址
fn is_allowed_host(headers: &HeaderMap, port: u16) -> bool {
    let Some(host) = headers.get(header::HOST).and_then(|value| value.to_str().ok()) else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    [format!("127.0.0.1:{}", port), format!("localhost:{}", port), format!("[::1]:{}", port)]
        .iter()
        .any(|allowed| *allowed == host)
}

/// 浏览器发起的请求会带 Origin，只允许本机页面
fn is_allowed_origin(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN).and_then(|value| value.to_str().ok()) else {
        return true;
    };
    let origin = origin.to_ascii_lowercase();
    let host = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .unwrap_or("");
    let host = if host.starts_with("[::1]") {
        "[::1]"
    } else {
        host.split(':').next().unwrap_or("")
    };
    matches!(host, "127.0.0.1" | "localhost" | "[::1]")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(header::HeaderName, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(name.clone(), HeaderValue::from_str(value).unwrap());
        }
        map
    }

    #[test]
    fn checks_bearer_token() {
        let token = "0123456789abcdef";
        assert!(is_authorized(&headers(&[(header::AUTHORIZATION, "Bearer 0123456789abcdef")]), token));
        assert!(!is_authorized(&headers(&[(header::AUTHORIZATION, "Bearer 0123456789abcdeg")]), token));
        assert!(!is_authorized(&headers(&[(header::AUTHORIZATION, "Basic 0123456789abcdef")]), token));
        assert!(!is_authorized(&HeaderMap::new(), token));
    }

    #[test]
    fn only_allows_local_host_and_origin() {
        assert!(is_allowed_host(&headers(&[(header::HOST, "127.0.0.1:27121")]), 27121));
        assert!(is_allowed_host(&headers(&[(header::HOST, "localhost:27121")]), 27121));
        assert!(!is_allowed_host(&headers(&[(header::HOST, "evil.example:27121")]), 27121));
        assert!(!is_allowed_host(&headers(&[(header::HOST, "127.0.0.1:80")]), 27121));
        assert!(!is_allowed_host(&HeaderMap::new(), 27121));

        assert!(is_allowed_origin(&HeaderMap::new()));
        assert!(is_allowed_origin(&headers(&[(header::ORIGIN, "http://localhost:1420")])));
        assert!(is_allowed_origin(&headers(&[(header::ORIGIN, "http://[::1]:3000")])));
        assert!(!is_allowed_origin(&headers(&[(header::ORIGIN, "https://evil.example")])));
        assert!(!is_allowed_origin(&headers(&[(header::ORIGIN, "http://localhost.evil.example")])));
    }

    #[test]
    fn detects_elicitation_clients() {
        assert!(supports_elicitation(&json!({ "capabilities": { "elicitation": {} } })));
        assert!(!supports_elicitation(&json!({ "capabilities": { "roots": {} } })));
        assert!(!supports_elicitation(&json!({ "capabilities": { "elicitation": true } })));
        assert!(!supports_elicitation(&Value::Null));

        assert!(accepts_event_stream(&headers(&[(header::ACCEPT, "application/json, text/event-stream")])));
        assert!(!accepts_event_stream(&headers(&[(header::ACCEPT, "application/json")])));
        assert!(!accepts_event_stream(&HeaderMap::new()));
    }

    #[test]
    fn formats_events_and_session_ids() {
        let event = sse_message(&json!({ "jsonrpc": "2.0", "id": 1, "result": { "text": "a\nb" } }));
        assert!(event.starts_with("event: message\ndata: {"));
        assert!(event.ends_with("}\n\n"));
        // JSON 里的换行被转义，一个事件只占一行 data
        assert_eq!(event.matches('\n').count(), 3);

        let first = new_session_id();
        assert_eq!(first.len(), 32);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(first, new_session_id());
    }

    #[tokio::test]
    async fn routes_elicitation_replies() {
        let elicitations: PendingElicitations = Default::default();
        let (first_tx, first_rx) = oneshot::channel();
        let (second_tx, second_rx) = oneshot::channel();
        elicitations.lock().await.insert("e1".to_string(), ("call-1".to_string(), first_tx));
        elicitations.lock().await.insert("e2".to_string(), ("call-2".to_string(), second_tx));

        // 没有 result / error 的消息、id 对不上的消息都不会被当成答复
        deliver_client_response(&elicitations, &json!({ "jsonrpc": "2.0", "id": "e1" })).await;
        deliver_client_response(&elicitations, &json!({ "jsonrpc": "2.0", "id": "other", "result": {} })).await;
        assert_eq!(elicitations.lock().await.len(), 2);

        let reply = json!({ "jsonrpc": "2.0", "id": "e1", "result": { "action": "accept", "content": {} } });
        deliver_client_response(&elicitations, &reply).await;
        assert_eq!(first_rx.await.unwrap(), reply);

        cancel_elicitations(&elicitations, "call-2").await;
        assert_eq!(second_rx.await.unwrap()["result"]["action"], "cancel");
        assert!(elicitations.lock().await.is_empty());
    }

    #[test]
    fn negotiates_protocol_version() {
        let result = initialize_result(&json!({ "protocolVersion": "2025-03-26" }));
        assert_eq!(result["protocolVersion"], "2025-03-26");
        let result = initialize_result(&json!({ "protocolVersion": "1999-01-01" }));
        assert_eq!(result["protocolVersion"], LATEST_PROTOCOL_VERSION);
        assert_eq!(result["serverInfo"]["name"], "apikit");
    }
}
