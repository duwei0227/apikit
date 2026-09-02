use base64::Engine as _;
use reqwest::multipart;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;
use tokio_util::io::ReaderStream;
use tokio_util::sync::CancellationToken;

pub type PendingRequests = Arc<Mutex<HashMap<String, CancellationToken>>>;

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
    state: tauri::State<'_, PendingRequests>,
    options: HttpRequestOptions,
) -> Result<HttpResponseResult, String> {
    let token = CancellationToken::new();

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
    let redirect_policy = match (is_file_request, options.max_redirections) {
        (true, _) => reqwest::redirect::Policy::none(),
        (false, Some(0)) => reqwest::redirect::Policy::none(),
        (false, Some(n)) => reqwest::redirect::Policy::limited(n as usize),
        (false, None) => reqwest::redirect::Policy::limited(10),
    };

    let accept_invalid = !options.verify_ssl.unwrap_or(true);
    let accept_encoding = options.accept_encoding.unwrap_or(true);

    let client = reqwest::Client::builder()
        .redirect(redirect_policy)
        .danger_accept_invalid_certs(accept_invalid)
        .danger_accept_invalid_hostnames(accept_invalid)
        .gzip(accept_encoding)
        .deflate(accept_encoding)
        .brotli(accept_encoding)
        .build()
        .map_err(|e| full_error_chain(&e))?;

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

    let body_bytes_raw = tokio::select! {
        _ = token.cancelled() => {
            return Err("Request cancelled".to_string());
        }
        result = response.bytes() => {
            result.map_err(|e| full_error_chain(&e))?
        }
    };

    let body_bytes = body_bytes_raw.len();
    let body = base64::engine::general_purpose::STANDARD.encode(&body_bytes_raw);

    Ok(HttpResponseResult {
        status,
        status_text,
        headers,
        body,
        is_base64: true,
        duration_ms,
        body_bytes,
        request_content_type,
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
