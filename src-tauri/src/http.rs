use base64::Engine as _;
use reqwest::multipart;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;
use tokio::sync::Mutex;
use tokio_util::io::ReaderStream;
use tokio_util::sync::CancellationToken;

pub type PendingRequests = Arc<Mutex<HashMap<String, CancellationToken>>>;

/// 空闲连接保留时间：复用连接省去握手，又不会长时间连到已变更的地址
const POOL_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum RedirectMode {
    None,
    Limited(usize),
}

/// 决定客户端行为的设置；设置相同的请求共用一个客户端和它的连接池
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct ClientKey {
    redirect: RedirectMode,
    accept_invalid_certs: bool,
    accept_encoding: bool,
}

#[derive(Default)]
pub struct HttpClients(std::sync::Mutex<HashMap<ClientKey, reqwest::Client>>);

impl HttpClients {
    fn get(&self, key: ClientKey) -> Result<reqwest::Client, String> {
        let mut clients = self.0.lock().map_err(|_| "HTTP client cache is unavailable".to_string())?;
        if let Some(client) = clients.get(&key) {
            // reqwest::Client 内部是 Arc，克隆后共用同一个连接池
            return Ok(client.clone());
        }
        let redirect_policy = match key.redirect {
            RedirectMode::None => reqwest::redirect::Policy::none(),
            RedirectMode::Limited(limit) => reqwest::redirect::Policy::limited(limit),
        };
        let client = reqwest::Client::builder()
            .redirect(redirect_policy)
            .danger_accept_invalid_certs(key.accept_invalid_certs)
            .danger_accept_invalid_hostnames(key.accept_invalid_certs)
            .gzip(key.accept_encoding)
            .deflate(key.accept_encoding)
            .brotli(key.accept_encoding)
            .pool_idle_timeout(POOL_IDLE_TIMEOUT)
            .build()
            .map_err(|e| full_error_chain(&e))?;
        clients.insert(key, client.clone());
        Ok(client)
    }
}

/// 递归提取完整错误链
fn full_error_chain(err: &dyn std::error::Error) -> String {
    let mut msg = err.to_string();
    let mut source = err.source();
    while let Some(cause) = source {
        msg.push_str(": ");
        msg.push_str(&cause.to_string());
        source = cause.source();
    }
    msg
}

/// Build a multipart form from the provided data.
async fn build_multipart_form(
    multipart_data: MultipartFormData,
) -> Result<multipart::Form, String> {
    let mut form = multipart::Form::new();

    for field in multipart_data.fields {
        let name = field.name;
        if let Some(file_path) = field.file_path {
            let mut part = multipart::Part::file(&file_path)
                .await
                .map_err(|e| format!("Failed to open upload file '{}': {}", file_path, e))?;

            if let Some(filename) = field.filename {
                part = part.file_name(filename);
            }
            if let Some(mime_type) = field.mime_type {
                part = part
                    .mime_str(&mime_type)
                    .map_err(|e| format!("Invalid mime type: {}", e))?;
            }

            form = form.part(name, part);
        } else if let Some(filename) = field.filename {
            let value = field
                .value
                .ok_or_else(|| "Missing base64 file data".to_string())?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&value)
                .map_err(|e| format!("Failed to decode file data: {}", e))?;

            let mut part = multipart::Part::bytes(bytes).file_name(filename);

            if let Some(mime_type) = field.mime_type {
                part = part
                    .mime_str(&mime_type)
                    .map_err(|e| format!("Invalid mime type: {}", e))?;
            }

            form = form.part(name, part);
        } else {
            form = form.text(name, field.value.unwrap_or_default());
        }
    }

    Ok(form)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestOptions {
    pub request_id: String,
    pub method: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub body_file_path: Option<String>,
    pub max_redirections: Option<u32>,
    pub verify_ssl: Option<bool>,
    pub accept_encoding: Option<bool>,
    /// 流式响应（SSE / NDJSON）边接收边通过 `http://stream` 事件推给前端
    pub stream_events: Option<bool>,
    /// Multipart form data for file uploads
    pub multipart: Option<MultipartFormData>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MultipartFormData {
    pub fields: Vec<MultipartField>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MultipartField {
    pub name: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub filename: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub file_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponseResult {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub is_base64: bool,
    pub duration_ms: u64,
    pub body_bytes: usize,
    pub request_content_type: Option<String>,
    /// 响应体是按流式接收的（SSE / NDJSON）
    pub streamed: bool,
    /// 流式响应从发出请求到收到第一块数据、到接收结束的毫秒数
    pub first_chunk_ms: Option<u64>,
    pub total_ms: Option<u64>,
    /// 流式响应没有正常结束的原因："stopped" 表示用户停止，其它为错误信息
    pub interrupted: Option<String>,
}

/// 与前端一致的二进制内容类型，这些响应按 base64 传给前端
fn is_binary_content_type(content_type: &str) -> bool {
    let content_type = content_type.to_ascii_lowercase();
    content_type.starts_with("image/")
        || content_type.starts_with("audio/")
        || content_type.starts_with("video/")
        || content_type.starts_with("font/")
        || ["octet-stream", "pdf", "zip", "gzip"].iter().any(|kind| content_type.contains(kind))
}

/// 文本响应直接以字符串传给前端，避免 base64 增大体积和前端逐字节解码；
/// 二进制、非 UTF-8 或带 BOM 的内容仍用 base64，保证字节原样保留
fn encode_body(bytes: &[u8], content_type: &str) -> (String, bool) {
    if !is_binary_content_type(content_type) && !bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        if let Ok(text) = std::str::from_utf8(bytes) {
            return (text.to_string(), false);
        }
    }
    (base64::engine::general_purpose::STANDARD.encode(bytes), true)
}

/// SSE 和逐行 JSON 的响应按流式处理
fn is_stream_content_type(content_type: &str) -> bool {
    let content_type = content_type.to_ascii_lowercase();
    ["text/event-stream", "application/x-ndjson", "application/ndjson", "application/jsonl", "application/x-jsonlines"]
        .iter()
        .any(|kind| content_type.starts_with(kind))
}

/// 取出缓冲区里已经完整的 UTF-8 文本，被数据块边界截断的多字节字符留到下一块
fn take_utf8_text(buffer: &mut Vec<u8>) -> String {
    let mut text = String::new();
    loop {
        match std::str::from_utf8(buffer) {
            Ok(valid) => {
                text.push_str(valid);
                buffer.clear();
                return text;
            }
            Err(error) => {
                let valid = error.valid_up_to();
                // error_len 为 None 表示末尾是不完整的字符，等后续数据
                let Some(invalid) = error.error_len() else {
                    text.push_str(&String::from_utf8_lossy(&buffer[..valid]));
                    buffer.drain(..valid);
                    return text;
                };
                text.push_str(&String::from_utf8_lossy(&buffer[..valid + invalid]));
                buffer.drain(..valid + invalid);
            }
        }
    }
}

fn apply_request_headers(
    mut request: reqwest::RequestBuilder,
    headers: &HashMap<String, String>,
) -> reqwest::RequestBuilder {
    for (key, value) in headers {
        request = request.header(key, value);
    }
    request
}

fn remove_header(headers: &mut HashMap<String, String>, name: &str) {
    headers.retain(|key, _| !key.eq_ignore_ascii_case(name));
}

fn same_origin(left: &reqwest::Url, right: &reqwest::Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

async fn send_file_request(
    client: &reqwest::Client,
    token: &CancellationToken,
    mut method: reqwest::Method,
    url: &str,
    mut headers: HashMap<String, String>,
    file_path: &str,
    max_redirections: usize,
) -> Result<reqwest::Response, String> {
    let mut current_url = reqwest::Url::parse(url).map_err(|e| full_error_chain(&e))?;
    let mut send_body = true;
    let mut redirect_count = 0usize;

    loop {
        let mut request = client.request(method.clone(), current_url.clone());
        request = apply_request_headers(request, &headers);

        if send_body {
            let file = tokio::select! {
                _ = token.cancelled() => return Err("Request cancelled".to_string()),
                result = tokio::fs::File::open(file_path) => {
                    result.map_err(|e| format!("Failed to open request body file '{}': {}", file_path, e))?
                }
            };
            let has_content_length = headers
                .keys()
                .any(|key| key.eq_ignore_ascii_case("content-length"));
            if !has_content_length {
                let length = tokio::select! {
                    _ = token.cancelled() => return Err("Request cancelled".to_string()),
                    result = file.metadata() => {
                        result.map_err(|e| format!("Failed to inspect request body file '{}': {}", file_path, e))?.len()
                    }
                };
                request = request.header(reqwest::header::CONTENT_LENGTH, length);
            }
            request = request.body(reqwest::Body::wrap_stream(ReaderStream::new(file)));
        }

        let response = tokio::select! {
            _ = token.cancelled() => return Err("Request cancelled".to_string()),
            result = request.send() => result.map_err(|e| full_error_chain(&e))?,
        };
        let status = response.status();
        if !matches!(status.as_u16(), 301 | 302 | 303 | 307 | 308) {
            return Ok(response);
        }

        let Some(location) = response.headers().get(reqwest::header::LOCATION) else {
            return Ok(response);
        };
        if max_redirections == 0 {
            return Ok(response);
        }
        if redirect_count >= max_redirections {
            return Err(format!("Too many redirects (limit: {})", max_redirections));
        }

        let location = location
            .to_str()
            .map_err(|e| format!("Invalid redirect location: {}", e))?;
        let next_url = current_url
            .join(location)
            .map_err(|e| format!("Invalid redirect location '{}': {}", location, e))?;

        if !same_origin(&current_url, &next_url) {
            remove_header(&mut headers, "authorization");
            remove_header(&mut headers, "cookie");
            remove_header(&mut headers, "proxy-authorization");
        }

        if status == reqwest::StatusCode::SEE_OTHER
            || ((status == reqwest::StatusCode::MOVED_PERMANENTLY
                || status == reqwest::StatusCode::FOUND)
                && method == reqwest::Method::POST)
        {
            method = reqwest::Method::GET;
            send_body = false;
            remove_header(&mut headers, "content-length");
            remove_header(&mut headers, "content-type");
            remove_header(&mut headers, "transfer-encoding");
        }

        current_url = next_url;
        redirect_count += 1;
    }
}

#[tauri::command]
pub async fn send_http_request(
    app: tauri::AppHandle,
    state: tauri::State<'_, PendingRequests>,
    clients: tauri::State<'_, HttpClients>,
    options: HttpRequestOptions,
) -> Result<HttpResponseResult, String> {
    let token = CancellationToken::new();
    let stream_events = options.stream_events.unwrap_or(false);
    let stream_request_id = options.request_id.clone();

    {
        let mut pending = state.lock().await;
        pending.insert(options.request_id.clone(), token.clone());
    }

    let request_id = options.request_id.clone();
    let state_clone = state.inner().clone();

    let _cleanup = scopeguard::guard((), |_| {
        let state = state_clone;
        let id = request_id;
        tokio::spawn(async move {
            let mut pending = state.lock().await;
            pending.remove(&id);
        });
    });

    let is_file_request = options.body_file_path.is_some();
    let redirect = match (is_file_request, options.max_redirections) {
        // 文件请求体不能重放，由 send_file_request 自己处理重定向
        (true, _) => RedirectMode::None,
        (false, Some(0)) => RedirectMode::None,
        (false, Some(n)) => RedirectMode::Limited(n as usize),
        (false, None) => RedirectMode::Limited(10),
    };
    let client = clients.get(ClientKey {
        redirect,
        accept_invalid_certs: !options.verify_ssl.unwrap_or(true),
        accept_encoding: options.accept_encoding.unwrap_or(true),
    })?;

    let method = options.method.to_uppercase();
    let req_method = method
        .parse::<reqwest::Method>()
        .map_err(|e| full_error_chain(&e))?;

    let mut headers = options.headers.unwrap_or_default();
    if !headers
        .keys()
        .any(|key| key.eq_ignore_ascii_case("user-agent"))
    {
        let version = env!("CARGO_PKG_VERSION");
        let name = env!("CARGO_PKG_NAME");
        headers.insert("User-Agent".to_string(), format!("{}/{}", name, version));
    }

    let mut request_content_type = None;
    let start = Instant::now();

    let response = if let Some(file_path) = options.body_file_path {
        send_file_request(
            &client,
            &token,
            req_method,
            &options.url,
            headers,
            &file_path,
            options.max_redirections.unwrap_or(10) as usize,
        )
        .await?
    } else {
        let mut request = client.request(req_method, &options.url);
        request = apply_request_headers(request, &headers);

        // Handle multipart form data (file uploads)
        if let Some(multipart_data) = options.multipart {
            let form = build_multipart_form(multipart_data).await?;
            request_content_type =
                Some(format!("multipart/form-data; boundary={}", form.boundary()));
            request = request.multipart(form);
        } else if let Some(body) = options.body {
            request = request.body(body);
        }

        tokio::select! {
            _ = token.cancelled() => return Err("Request cancelled".to_string()),
            result = request.send() => result.map_err(|e| full_error_chain(&e))?,
        }
    };

    let duration_ms = start.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("Unknown")
        .to_string();

    let mut headers: Vec<(String, String)> = Vec::new();
    for (name, value) in response.headers().iter() {
        if let Ok(v) = value.to_str() {
            headers.push((name.to_string(), v.to_string()));
        }
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();

    if stream_events && is_stream_content_type(&content_type) {
        let mut response = response;
        let _ = app.emit(
            "http://stream",
            serde_json::json!({
                "requestId": stream_request_id,
                "kind": "start",
                "status": status,
                "statusText": status_text,
                "headers": headers,
                "elapsedMs": duration_ms,
            }),
        );

        let mut collected: Vec<u8> = Vec::new();
        let mut undecoded: Vec<u8> = Vec::new();
        let mut first_chunk_ms = None;
        let mut interrupted = None;
        loop {
            let chunk = tokio::select! {
                _ = token.cancelled() => {
                    // 用户停止：保留已经收到的内容
                    interrupted = Some("stopped".to_string());
                    break;
                }
                result = response.chunk() => result,
            };
            match chunk {
                Ok(Some(bytes)) => {
                    let elapsed_ms = start.elapsed().as_millis() as u64;
                    first_chunk_ms.get_or_insert(elapsed_ms);
                    collected.extend_from_slice(&bytes);
                    undecoded.extend_from_slice(&bytes);
                    let text = take_utf8_text(&mut undecoded);
                    if !text.is_empty() {
                        let _ = app.emit(
                            "http://stream",
                            serde_json::json!({
                                "requestId": stream_request_id,
                                "kind": "chunk",
                                "data": text,
                                "elapsedMs": elapsed_ms,
                                "receivedBytes": collected.len(),
                            }),
                        );
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    interrupted = Some(full_error_chain(&error));
                    break;
                }
            }
        }

        let (body, is_base64) = encode_body(&collected, &content_type);
        return Ok(HttpResponseResult {
            status,
            status_text,
            headers,
            body,
            is_base64,
            duration_ms,
            body_bytes: collected.len(),
            request_content_type,
            streamed: true,
            first_chunk_ms,
            total_ms: Some(start.elapsed().as_millis() as u64),
            interrupted,
        });
    }

    let body_bytes_raw = tokio::select! {
        _ = token.cancelled() => {
            return Err("Request cancelled".to_string());
        }
        result = response.bytes() => {
            result.map_err(|e| full_error_chain(&e))?
        }
    };

    let body_bytes = body_bytes_raw.len();
    let (body, is_base64) = encode_body(&body_bytes_raw, &content_type);

    Ok(HttpResponseResult {
        status,
        status_text,
        headers,
        body,
        is_base64,
        duration_ms,
        body_bytes,
        request_content_type,
        streamed: false,
        first_chunk_ms: None,
        total_ms: None,
        interrupted: None,
    })
}

#[tauri::command]
pub async fn cancel_http_request(
    state: tauri::State<'_, PendingRequests>,
    request_id: String,
) -> Result<bool, String> {
    let pending = state.lock().await;
    if let Some(token) = pending.get(&request_id) {
        token.cancel();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reuses_clients_with_the_same_settings() {
        let clients = HttpClients::default();
        let key = ClientKey { redirect: RedirectMode::Limited(10), accept_invalid_certs: false, accept_encoding: true };
        clients.get(key).unwrap();
        clients.get(key).unwrap();
        assert_eq!(clients.0.lock().unwrap().len(), 1);
        clients.get(ClientKey { redirect: RedirectMode::None, ..key }).unwrap();
        clients.get(ClientKey { accept_invalid_certs: true, ..key }).unwrap();
        assert_eq!(clients.0.lock().unwrap().len(), 3);
    }

    #[test]
    fn detects_stream_content_types() {
        assert!(is_stream_content_type("text/event-stream"));
        assert!(is_stream_content_type("Text/Event-Stream; charset=utf-8"));
        assert!(is_stream_content_type("application/x-ndjson"));
        assert!(!is_stream_content_type("application/json"));
        assert!(!is_stream_content_type(""));
    }

    #[test]
    fn sends_text_as_string_and_binary_as_base64() {
        assert_eq!(encode_body("{\"a\":\"你好\"}".as_bytes(), "application/json"), ("{\"a\":\"你好\"}".to_string(), false));
        assert_eq!(encode_body(b"hello", ""), ("hello".to_string(), false));
        assert_eq!(encode_body(b"\x89PNG", "image/png"), ("iVBORw==".to_string(), true));
        // 非 UTF-8 或带 BOM 的文本按字节保留
        assert!(encode_body(&[0xff, 0xfe, 0x41], "text/plain").1);
        assert!(encode_body(&[0xEF, 0xBB, 0xBF, b'{', b'}'], "application/json").1);
    }

    #[test]
    fn keeps_split_characters_for_the_next_chunk() {
        let bytes = "data: 你好\n".as_bytes();
        // 在 "你" 的第二个字节处截断
        let mut buffer = bytes[..8].to_vec();
        assert_eq!(take_utf8_text(&mut buffer), "data: ");
        assert_eq!(buffer.len(), 2);

        buffer.extend_from_slice(&bytes[8..]);
        assert_eq!(take_utf8_text(&mut buffer), "你好\n");
        assert!(buffer.is_empty());
    }

    #[test]
    fn replaces_invalid_bytes_without_stalling() {
        let mut buffer = vec![b'a', 0xff, b'b'];
        assert_eq!(take_utf8_text(&mut buffer), "a\u{fffd}b");
        assert!(buffer.is_empty());
    }
}
