use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

#[cfg(test)]
thread_local! { static TEST_LOGS: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) }; }
#[cfg(test)]
pub(crate) fn take_test_logs() -> Vec<String> {
    TEST_LOGS.with(|logs| std::mem::take(&mut *logs.borrow_mut()))
}

static LOG_MUTEX: Mutex<()> = Mutex::new(());

/// Diagnostic fields are bounded identifiers, not arbitrary provider text.
pub fn safe_field(value: &str) -> String {
    value
        .chars()
        .take(96)
        .map(|c| {
            if c.is_ascii_alphanumeric() || "-_.:/".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect()
}

pub fn safe_url(value: &str) -> String {
    match url::Url::parse(value) {
        Ok(mut parsed) => {
            let _ = parsed.set_username("");
            let _ = parsed.set_password(None);
            parsed.set_query(None);
            parsed.set_fragment(None);
            parsed.to_string()
        }
        Err(_) => "invalid-endpoint".into(),
    }
}

pub fn get_log_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".talkee")
}

pub fn get_log_path() -> PathBuf {
    get_log_dir().join("talkee.log")
}

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const MAX_ENTRY_BYTES: usize = 16 * 1024;
const ARCHIVES: usize = 3;

fn archive_path(path: &std::path::Path, index: usize) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(".{}", index));
    PathBuf::from(name)
}

fn private_file(path: &std::path::Path, append: bool) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .append(append)
        .mode(0o600)
        .open(path)?;
    file.set_permissions(fs::Permissions::from_mode(0o600))?;
    Ok(file)
}

fn trim_oversized(path: &std::path::Path, limit: u64) -> std::io::Result<()> {
    use std::io::{Read, Seek, SeekFrom};
    let size = match fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err),
    };
    if size <= limit {
        return Ok(());
    }
    let mut file = private_file(path, false)?;
    file.seek(SeekFrom::End(-(limit as i64)))?;
    let mut tail = Vec::with_capacity(limit as usize);
    file.take(limit).read_to_end(&mut tail)?;
    // Keep only complete records, avoiding a partial UTF-8 character/old giant line.
    let start = tail
        .iter()
        .position(|&v| v == b'\n')
        .map(|i| i + 1)
        .unwrap_or(tail.len());
    let end = tail
        .iter()
        .rposition(|&v| v == b'\n')
        .map(|i| i + 1)
        .unwrap_or(start);
    let mut file = private_file(path, false)?;
    file.set_len(0)?;
    file.write_all(&tail[start..end.max(start)])
}

fn remove_if_present(path: &std::path::Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

fn append_record(path: &std::path::Path, line: &str, limit: u64) -> std::io::Result<()> {
    if line.len() as u64 > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "oversized log record",
        ));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    trim_oversized(path, limit)?;
    for index in 1..=ARCHIVES {
        trim_oversized(&archive_path(path, index), limit)?;
    }
    let size = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    if size + line.len() as u64 > limit {
        remove_if_present(&archive_path(path, ARCHIVES))?;
        for index in (1..ARCHIVES).rev() {
            match fs::rename(archive_path(path, index), archive_path(path, index + 1)) {
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                result => result?,
            }
        }
        fs::rename(path, archive_path(path, 1))?;
    }
    private_file(path, true)?.write_all(line.as_bytes())
}

fn clear_log_files(path: &std::path::Path) -> std::io::Result<()> {
    remove_if_present(path)?;
    for index in 1..=ARCHIVES {
        remove_if_present(&archive_path(path, index))?;
    }
    Ok(())
}

fn bounded_line(level: &str, tag: &str, message: &str) -> String {
    // Restrict work/allocation even if a caller supplies a huge runtime message.
    let mut escaped = String::new();
    for c in message.chars().take(MAX_ENTRY_BYTES) {
        match c {
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            c if c.is_control() => escaped.push_str(&format!("\\u{{{:x}}}", c as u32)),
            c => escaped.push(c),
        }
    }
    let mut redact_next = false;
    let message = escaped
        .split_whitespace()
        .map(|word| {
            let lower = word.to_ascii_lowercase();
            let secret_field = lower.contains("api_key")
                || lower.contains("api-key")
                || lower.contains("authorization")
                || lower == "bearer";
            if secret_field || redact_next || lower.contains("sk-") {
                redact_next = secret_field && !(word.contains('=') && !word.ends_with('='));
                return "[redacted]".to_string();
            }
            if let Some(index) = word.find("https://").or_else(|| word.find("http://")) {
                let value = word[index..].trim_end_matches([')', ']', '"', '\'', ',', ';']);
                return format!("{}{}", &word[..index], safe_url(value));
            }
            word.to_string()
        })
        .collect::<Vec<_>>()
        .join(" ");
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let mut line = format!(
        "[{}] [{}] [{}] {}",
        timestamp,
        safe_field(level),
        safe_field(tag),
        message
    );
    if line.len() >= MAX_ENTRY_BYTES {
        let mut end = MAX_ENTRY_BYTES - " [truncated]\n".len();
        while !line.is_char_boundary(end) {
            end -= 1;
        }
        line.truncate(end);
        line.push_str(" [truncated]");
    }
    line.push('\n');
    line
}

pub fn log(level: &str, tag: &str, message: &str) {
    let line = bounded_line(level, tag, message);
    #[cfg(test)]
    TEST_LOGS.with(|logs| logs.borrow_mut().push(line.clone()));
    #[cfg(not(test))]
    {
        // ponytail: process-local lock; use an OS file lock if concurrent app writers are required.
        let _guard = LOG_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        if let Err(error) = append_record(&get_log_path(), &line, MAX_LOG_BYTES) {
            eprintln!("Talkee log write failed: {:?}", error.kind());
        }
        println!("{}", line.trim_end());
    }
}

pub fn log_info(tag: &str, message: &str) {
    log("INFO", tag, message);
}

pub fn log_error(tag: &str, message: &str) {
    log("ERROR", tag, message);
}

#[tauri::command]
pub fn log_event(level: String, tag: String, message: String) {
    log(&level, &tag, &message);
}

#[tauri::command]
pub fn get_log_path_cmd() -> String {
    get_log_path().to_string_lossy().to_string()
}

#[tauri::command]
pub fn clear_logs() -> Result<(), String> {
    let _guard = LOG_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
    clear_log_files(&get_log_path()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn rotates_at_boundary_and_evicts_oldest_archive() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("talkee.log");
        let first = "first\n";
        append_record(&path, first, 12).unwrap();
        append_record(&path, first, 12).unwrap();
        assert!(!archive_path(&path, 1).exists());
        for label in ["second", "third!", "fourth", "fifth!"] {
            append_record(&path, &format!("{}\n", label), 12).unwrap();
        }
        assert_eq!(fs::read_to_string(&path).unwrap(), "fifth!\n");
        assert_eq!(
            fs::read_to_string(archive_path(&path, 1)).unwrap(),
            "fourth\n"
        );
        assert_eq!(
            fs::read_to_string(archive_path(&path, 3)).unwrap(),
            "second\n"
        );
        assert!(!archive_path(&path, 4).exists());
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        fs::write(dir.path().join("neighbor.log"), "keep").unwrap();
        clear_log_files(&path).unwrap();
        clear_log_files(&path).unwrap();
        for i in 0..=ARCHIVES {
            assert!(!if i == 0 {
                path.clone()
            } else {
                archive_path(&path, i)
            }
            .exists());
        }
        append_record(&path, "new\n", 12).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new\n");
        assert!(dir.path().join("neighbor.log").exists());
    }

    #[test]
    fn legacy_oversize_keeps_complete_bounded_tail() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("talkee.log");
        fs::write(&path, "Русская строка\n".repeat(20)).unwrap();
        fs::write(archive_path(&path, 3), "x\n".repeat(90)).unwrap();
        append_record(&path, "new\n", 64).unwrap();
        for i in 0..=ARCHIVES {
            let file = if i == 0 {
                path.clone()
            } else {
                archive_path(&path, i)
            };
            if file.exists() {
                let content = fs::read_to_string(&file).unwrap();
                assert!(content.len() <= 64);
                assert!(content.ends_with('\n'));
            }
        }
        assert!(fs::read_to_string(&path).unwrap().contains("new"));
    }

    #[test]
    fn records_are_utf8_bounded_single_line_and_redacted() {
        let record = bounded_line("INFO\nEVIL", "TAG", &format!("endpoint=https://user:SECRET_URL@api.example.com/v1?token=SECRET_QUERY#SECRET_FRAGMENT sk-SECRET_KEY Authorization: Bearer SECRET_AUTH api_key=SECRET_FIELD\n[ERROR] injected\r{}", "Я".repeat(MAX_ENTRY_BYTES)));
        assert!(record.len() <= MAX_ENTRY_BYTES);
        assert_eq!(record.matches('\n').count(), 1);
        assert!(!record.contains('\r'));
        for secret in [
            "SECRET_URL",
            "SECRET_QUERY",
            "SECRET_FRAGMENT",
            "SECRET_KEY",
            "SECRET_AUTH",
            "SECRET_FIELD",
        ] {
            assert!(!record.contains(secret));
        }
        assert!(record.contains("https://api.example.com/v1"));
        assert!(record.contains(" [truncated]\n"));
    }

    #[test]
    fn writer_errors_are_returned_without_unbounded_append() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("blocked");
        fs::write(&path, "keep").unwrap();
        assert!(append_record(&path.join("talkee.log"), "x\n", 64).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "keep");
        assert!(append_record(&path, &"x".repeat(65), 64).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "keep");
    }

    #[test]
    fn test_log_capture_never_touches_real_app_log() {
        take_test_logs();
        log_info("TEST", "event=synthetic");
        assert_eq!(take_test_logs().len(), 1);
        assert!(take_test_logs().is_empty());
        assert_eq!(get_log_path(), get_log_dir().join("talkee.log"));
        assert_eq!(MAX_LOG_BYTES, 5 * 1024 * 1024);
    }
}
