//! Bundled local LLM runtime (`talkee-llm` sidecar). It mirrors `talkee-stt`: a tiny
//! raw-TCP HTTP server, but backed by llama.cpp (via `llama-cpp-2`) and exposing
//! an OpenAI-compatible `/v1/chat/completions` endpoint so the desktop app can
//! run summary locally. The GGUF model path is passed with `-m`.

#[cfg(not(target_os = "macos"))]
compile_error!("talkee supports macOS only");

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
mod request_control;
use request_control::RequestControl;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaChatTemplate, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::TokenToStringError;

const SERVER_NAME: &str = "talkee-llm";
const ENGINE_NAME: &str = "llama.cpp";
const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;
// The sidecar often runs together with local STT. Keep its default aligned
// with the desktop launcher so creating the first inference context does not
// exhaust memory on supported 8–16 GB Windows machines.
const DEFAULT_CTX: u32 = 4096;
const DEFAULT_MAX_TOKENS: i32 = 1024;

fn perf_core_count() -> usize {
    static CORES: OnceLock<usize> = OnceLock::new();
    *CORES.get_or_init(|| {
        #[cfg(target_os = "macos")]
        if let Some(count) = sysctl_perflevel0_physicalcpu() {
            return count;
        }

        std::thread::available_parallelism()
            .map(|count| count.get())
            .unwrap_or(0)
    })
}

#[cfg(target_os = "macos")]
fn sysctl_perflevel0_physicalcpu() -> Option<usize> {
    use std::ffi::CString;

    let name = CString::new("hw.perflevel0.physicalcpu").ok()?;
    let mut value: i32 = 0;
    let mut size = std::mem::size_of::<i32>();
    let result = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            &mut value as *mut i32 as *mut libc::c_void,
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };

    (result == 0 && value > 0).then_some(value as usize)
}

struct Config {
    host: String,
    port: u16,
    model_path: PathBuf,
    ctx_size: u32,
}

struct HttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

struct Work {
    stream: TcpStream,
    body: Vec<u8>,
    id: Option<String>,
    cancelled: Arc<AtomicBool>,
    deadline: Option<Instant>,
}

fn main() {
    let config = Arc::new(parse_args());
    let bind_addr = format!("{}:{}", config.host, config.port);
    let control = Arc::new(RequestControl::default());
    let (sender, receiver) = sync_channel::<Work>(1);
    let (ready_sender, ready_receiver) = sync_channel(1);
    let worker_config = config.clone();
    let worker_control = control.clone();
    std::thread::spawn(move || {
        let backend = LlamaBackend::init().expect("llama backend initialization");
        let params = LlamaModelParams::default().with_n_gpu_layers(999);
        let model = LlamaModel::load_from_file(&backend, &worker_config.model_path, &params)
            .expect("llama model loading");
        let _ = ready_sender.send(());
        for mut work in receiver {
            let done = Arc::new(AtomicBool::new(false));
            if let Ok(mut socket) = work.stream.try_clone() {
                let cancelled = work.cancelled.clone();
                let done = done.clone();
                std::thread::spawn(move || {
                    let _ = socket.set_read_timeout(Some(Duration::from_millis(100)));
                    let mut byte = [0u8; 1];
                    while !done.load(Ordering::Acquire) {
                        match socket.read(&mut byte) {
                            Ok(0) => {
                                cancelled.store(true, Ordering::Release);
                                break;
                            }
                            Ok(_) => {}
                            Err(e)
                                if matches!(
                                    e.kind(),
                                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                                ) => {}
                            Err(_) => {
                                cancelled.store(true, Ordering::Release);
                                break;
                            }
                        }
                    }
                });
            }
            let result = chat_completion(
                &work.body,
                &backend,
                &model,
                &worker_config,
                &work.cancelled,
                work.deadline,
            );
            let (status, body) = match result {
                Ok(body) => (200, body),
                Err(message) => (
                    if message == "cancelled" { 409 } else { 500 },
                    json!({"error":message}),
                ),
            };
            let _ = write_json(&mut work.stream, status, &body);
            done.store(true, Ordering::Release);
            if let Some(id) = work.id {
                worker_control.finish(&id);
            }
        }
    });
    if ready_receiver.recv().is_err() {
        std::process::exit(1);
    }
    let listener = TcpListener::bind(&bind_addr).expect("bind local LLM listener");
    eprintln!("{} listening on {}", SERVER_NAME, bind_addr);
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let sender = sender.clone();
                let control = control.clone();
                let config = config.clone();
                std::thread::spawn(move || handle_connection(stream, &sender, &control, &config));
            }
            Err(err) => eprintln!("connection error: {}", err),
        }
    }
}

fn parse_args() -> Config {
    let mut host = "127.0.0.1".to_string();
    let mut port: u16 = 8011;
    let mut model_path: Option<PathBuf> = None;
    let mut ctx_size = DEFAULT_CTX;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--host" => {
                if let Some(value) = args.next() {
                    host = value;
                }
            }
            "--port" => {
                if let Some(value) = args.next() {
                    port = value.parse().unwrap_or(port);
                }
            }
            "-m" | "--model" => {
                if let Some(value) = args.next() {
                    model_path = Some(PathBuf::from(value));
                }
            }
            "-c" | "--ctx-size" => {
                if let Some(value) = args.next() {
                    ctx_size = value.parse().unwrap_or(ctx_size);
                }
            }
            // Ignore unknown flags (e.g. --jinja, --data-dir, --models-dir).
            _ => {}
        }
    }

    let model_path = model_path.unwrap_or_else(|| {
        eprintln!("missing required -m <model.gguf>");
        std::process::exit(2);
    });

    Config {
        host,
        port,
        model_path,
        ctx_size,
    }
}

fn handle_connection(
    mut stream: TcpStream,
    sender: &SyncSender<Work>,
    control: &RequestControl,
    config: &Config,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(message) => {
            let _ = write_json(&mut stream, 400, &json!({"error":message}));
            return;
        }
    };
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/health") => {
            let _ = write_json(
                &mut stream,
                200,
                &json!({
                    "status":"ok", "runtime":SERVER_NAME, "engine":ENGINE_NAME,
                    "analysis_control_version":1, "context_size":config.ctx_size
                }),
            );
        }
        ("GET", "/v1/models") => {
            let _ = write_json(
                &mut stream,
                200,
                &json!({
                    "object":"list", "data":[{"id":SERVER_NAME,"object":"model","owned_by":"talkee"}]
                }),
            );
        }
        ("POST", "/v1/requests/cancel") => {
            let body: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
            if let Some(id) = body.get("request_id").and_then(Value::as_str) {
                control.cancel(id);
                let _ = write_json(&mut stream, 200, &json!({"cancelled":true}));
            } else {
                let _ = write_json(&mut stream, 400, &json!({"error":"missing request_id"}));
            }
        }
        ("POST", "/v1/chat/completions") => {
            let body: Value = match serde_json::from_slice(&request.body) {
                Ok(body) => body,
                Err(_) => {
                    let _ = write_json(&mut stream, 400, &json!({"error":"invalid json"}));
                    return;
                }
            };
            let id = body
                .get("request_id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let cancelled = match id.as_ref() {
                Some(id) => match control.register(id) {
                    Ok(flag) => flag,
                    Err(error) => {
                        let _ = write_json(&mut stream, 409, &json!({"error":error}));
                        return;
                    }
                },
                None => Arc::new(AtomicBool::new(false)),
            };
            let work = Work {
                stream,
                body: request.body,
                deadline: id
                    .as_ref()
                    .map(|_| Instant::now() + Duration::from_secs(60)),
                id,
                cancelled,
            };
            if let Err(error) = sender.try_send(work) {
                let mut work = match error {
                    std::sync::mpsc::TrySendError::Full(work)
                    | std::sync::mpsc::TrySendError::Disconnected(work) => work,
                };
                if let Some(id) = work.id {
                    control.finish(&id);
                }
                let _ = write_json(&mut work.stream, 503, &json!({"error":"busy"}));
            }
        }
        _ => {
            let _ = write_json(&mut stream, 404, &json!({"error":"not found"}));
        }
    }
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut buffer = Vec::new();
    let mut temp = [0u8; 8192];
    let header_end;

    loop {
        let bytes_read = stream
            .read(&mut temp)
            .map_err(|err| format!("read error: {}", err))?;
        if bytes_read == 0 {
            return Err("empty request".to_string());
        }
        buffer.extend_from_slice(&temp[..bytes_read]);
        if buffer.len() > MAX_REQUEST_BYTES {
            return Err("request too large".to_string());
        }
        if let Some(index) = find_subsequence(&buffer, b"\r\n\r\n") {
            header_end = index + 4;
            break;
        }
    }

    let header_text = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = header_text.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts.next().unwrap_or_default().to_string();

    let mut content_length = 0usize;
    for line in lines {
        if let Some(value) = line
            .to_ascii_lowercase()
            .strip_prefix("content-length:")
            .map(|value| value.trim().to_string())
        {
            content_length = value.parse().unwrap_or(0);
        }
    }

    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let bytes_read = stream
            .read(&mut temp)
            .map_err(|err| format!("read error: {}", err))?;
        if bytes_read == 0 {
            break;
        }
        body.extend_from_slice(&temp[..bytes_read]);
        if body.len() > MAX_REQUEST_BYTES {
            return Err("request too large".to_string());
        }
    }

    Ok(HttpRequest { method, path, body })
}

fn chat_completion(
    body: &[u8],
    backend: &LlamaBackend,
    model: &LlamaModel,
    config: &Config,
    cancelled: &AtomicBool,
    deadline: Option<Instant>,
) -> Result<Value, String> {
    let payload: Value =
        serde_json::from_slice(body).map_err(|err| format!("invalid json: {}", err))?;
    let messages = payload
        .get("messages")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "missing messages".to_string())?;
    let temperature = payload
        .get("temperature")
        .and_then(|value| value.as_f64())
        .unwrap_or(0.3) as f32;
    let max_tokens = payload
        .get("max_tokens")
        .and_then(|value| value.as_i64())
        .map(|value| value as i32)
        .unwrap_or(DEFAULT_MAX_TOKENS);

    let prompt = build_prompt(model, messages);
    let content = generate(
        backend,
        model,
        &prompt,
        temperature,
        max_tokens,
        config.ctx_size,
        cancelled,
        deadline,
    )?;

    Ok(json!({
        "id": "chatcmpl-talkee-llm",
        "object": "chat.completion",
        "model": SERVER_NAME,
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": content.trim() },
            "finish_reason": "stop"
        }]
    }))
}

/// Build a model-native prompt from OpenAI-style messages. GGUF chat templates
/// are preferred; ChatML stays as a fallback for older Qwen2.5 files.
// The installed llama.cpp legacy API cannot pass Jinja keyword arguments.
// Qwen3's enable_thinking=false branch is an empty, closed assistant think block.
fn disable_thinking(template: &str, mut prompt: String) -> String {
    if template.contains("enable_thinking") && !prompt.ends_with("</think>\n\n") {
        if prompt.ends_with("<think>\n") {
            prompt.push_str("\n</think>\n\n");
        } else {
            prompt.push_str("<think>\n\n</think>\n\n");
        }
    }
    prompt
}

fn build_prompt(model: &LlamaModel, messages: &[Value]) -> String {
    let chat = build_chat_messages(messages);
    let template = model
        .chat_template(None)
        .map_err(|err| err.to_string())
        .or_else(|_| LlamaChatTemplate::new("chatml").map_err(|err| err.to_string()));

    match template {
        Ok(tmpl) => match model.apply_chat_template(&tmpl, &chat, true) {
            Ok(prompt) => disable_thinking(tmpl.to_str().unwrap_or_default(), prompt),
            Err(err) => {
                eprintln!(
                    "failed to apply chat template, falling back to ChatML: {}",
                    err
                );
                build_chatml(messages)
            }
        },
        Err(err) => {
            eprintln!(
                "failed to load chat template, falling back to ChatML: {}",
                err
            );
            build_chatml(messages)
        }
    }
}

fn build_chat_messages(messages: &[Value]) -> Vec<LlamaChatMessage> {
    messages
        .iter()
        .filter_map(|message| {
            let role = message
                .get("role")
                .and_then(|value| value.as_str())
                .unwrap_or("user")
                .replace('\0', " ");
            let content = message_content(message).replace('\0', " ");
            LlamaChatMessage::new(role, content).ok()
        })
        .collect()
}

fn message_content(message: &Value) -> String {
    let Some(content) = message.get("content") else {
        return String::new();
    };

    if let Some(text) = content.as_str() {
        return text.to_string();
    }

    if let Some(parts) = content.as_array() {
        return parts
            .iter()
            .filter_map(|part| {
                part.as_str()
                    .or_else(|| part.get("text").and_then(|value| value.as_str()))
            })
            .collect::<Vec<_>>()
            .join("\n");
    }

    String::new()
}

/// Build a ChatML prompt from OpenAI-style messages.
fn build_chatml(messages: &[Value]) -> String {
    let mut prompt = String::new();
    for message in messages {
        let role = message
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or("user");
        let content = message_content(message);
        prompt.push_str(&format!("<|im_start|>{}\n{}<|im_end|>\n", role, content));
    }
    prompt.push_str("<|im_start|>assistant\n");
    prompt
}

// Keep inference parameters explicit alongside cancellation and deadline controls.
#[allow(clippy::too_many_arguments)]
fn generate(
    backend: &LlamaBackend,
    model: &LlamaModel,
    prompt: &str,
    temperature: f32,
    max_tokens: i32,
    ctx_size: u32,
    cancelled: &AtomicBool,
    deadline: Option<Instant>,
) -> Result<String, String> {
    check_cancelled(cancelled, deadline)?;
    let threads = perf_core_count() as i32;
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(ctx_size))
        .with_n_threads(threads)
        .with_n_threads_batch(threads);
    let mut ctx = model
        .new_context(backend, ctx_params)
        .map_err(|err| format!("context error: {}", err))?;

    let tokens = model
        .str_to_token(prompt, AddBos::Always)
        .map_err(|err| format!("tokenize error: {}", err))?;
    let available_output_tokens = ctx_size as i32 - tokens.len() as i32 - 1;
    if available_output_tokens < 64 {
        return Err(format!(
            "Запрос слишком длинный для локальной модели: {} токенов, лимит контекста {}. Уменьшите текст или выберите модель с большим контекстом.",
            tokens.len(),
            ctx_size
        ));
    }
    let max_tokens = max_tokens.max(1).min(available_output_tokens);

    let prompt_batch_size = 512usize;
    let mut batch = LlamaBatch::new(prompt_batch_size, 1);
    let last_index = tokens.len() as i32 - 1;
    for (chunk_index, chunk) in tokens.chunks(prompt_batch_size).enumerate() {
        check_cancelled(cancelled, deadline)?;
        batch.clear();
        let offset = chunk_index * prompt_batch_size;
        for (index, token) in chunk.iter().enumerate() {
            let position = offset + index;
            batch
                .add(*token, position as i32, &[0], position as i32 == last_index)
                .map_err(|err| format!("batch error: {}", err))?;
        }
        ctx.decode(&mut batch)
            .map_err(|err| format!("decode error: {}", err))?;
        check_cancelled(cancelled, deadline)?;
    }

    let mut sampler = if temperature <= 0.0 {
        LlamaSampler::greedy()
    } else {
        LlamaSampler::chain_simple([
            LlamaSampler::temp(temperature),
            LlamaSampler::top_p(0.95, 1),
            LlamaSampler::dist(1234),
        ])
    };

    let mut n_cur = tokens.len() as i32;
    let limit = n_cur + max_tokens;
    let mut output = String::new();
    let mut pending: Vec<u8> = Vec::new();

    while n_cur < limit {
        check_cancelled(cancelled, deadline)?;
        let token = sampler.sample(&ctx, batch.n_tokens() - 1);
        sampler.accept(token);

        if model.is_eog_token(token) {
            break;
        }

        // Accumulate raw token bytes and emit only COMPLETE UTF-8 sequences. A
        // single token can carry a partial multibyte char (Cyrillic spans token
        // boundaries), so decoding tokens one-by-one yielded garbled glyphs.
        let piece_bytes = match model.token_to_piece_bytes(token, 8, true, None) {
            Err(TokenToStringError::InsufficientBufferSpace(size)) => {
                let needed = size
                    .checked_neg()
                    .and_then(|value| usize::try_from(value).ok())
                    .unwrap_or(32);
                model.token_to_piece_bytes(token, needed, true, None)
            }
            result => result,
        };

        if let Ok(bytes) = piece_bytes {
            pending.extend_from_slice(&bytes);
            loop {
                match std::str::from_utf8(&pending) {
                    Ok(text) => {
                        output.push_str(text);
                        pending.clear();
                        break;
                    }
                    Err(err) => {
                        let valid = err.valid_up_to();
                        if valid > 0 {
                            output.push_str(
                                std::str::from_utf8(&pending[..valid])
                                    .expect("valid_up_to bytes are valid UTF-8"),
                            );
                            pending.drain(..valid);
                        }
                        match err.error_len() {
                            // Genuinely invalid bytes — drop them so we don't stall.
                            Some(bad) => {
                                pending.drain(..bad.max(1));
                            }
                            // Just an incomplete tail — wait for the next token.
                            None => break,
                        }
                    }
                }
            }
        }

        batch.clear();
        batch
            .add(token, n_cur, &[0], true)
            .map_err(|err| format!("batch error: {}", err))?;
        n_cur += 1;
        ctx.decode(&mut batch)
            .map_err(|err| format!("decode error: {}", err))?;
    }

    // Flush any complete trailing bytes (a dangling partial sequence is dropped).
    match std::str::from_utf8(&pending) {
        Ok(text) => output.push_str(text),
        Err(err) => output.push_str(
            std::str::from_utf8(&pending[..err.valid_up_to()])
                .expect("valid_up_to bytes are valid UTF-8"),
        ),
    }

    check_cancelled(cancelled, deadline)?;
    Ok(output)
}

fn check_cancelled(flag: &AtomicBool, deadline: Option<Instant>) -> Result<(), String> {
    if flag.load(Ordering::Acquire) || deadline.is_some_and(|d| Instant::now() >= d) {
        return Err("cancelled".into());
    }
    Ok(())
}

fn write_json(stream: &mut TcpStream, status: u16, body: &Value) -> std::io::Result<()> {
    let body = body.to_string();
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        reason,
        body.len(),
        body
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod cleanup_thinking_tests {
    use super::*;
    #[test]
    fn disables_only_templates_supporting_thinking() {
        assert_eq!(disable_thinking("chatml", "assistant".into()), "assistant");
        assert_eq!(
            disable_thinking("enable_thinking", "assistant".into()),
            "assistant<think>\n\n</think>\n\n"
        );
        assert_eq!(
            disable_thinking("enable_thinking", "assistant<think>\n".into()),
            "assistant<think>\n\n</think>\n\n"
        );
    }
}
