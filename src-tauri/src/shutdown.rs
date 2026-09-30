use crate::{legacy_migration, llm_runtime, logger};
use tauri::AppHandle;

const SIDECAR_PROCESS_NAMES: &[&str] = &[
    "talkee-ffmpeg",
    "talkee-stt",
    "talkee-diarize",
    "talkee-llm",
];

/// Current sidecar names plus the legacy names, so an orphaned sidecar left by
/// a pre-rename session is cleaned up too.
fn managed_sidecar_process_names() -> impl Iterator<Item = &'static str> {
    SIDECAR_PROCESS_NAMES
        .iter()
        .chain(legacy_migration::LEGACY_SIDECAR_NAMES.iter())
        .copied()
}

pub fn quit(app: &AppHandle) {
    logger::log_info("SHUTDOWN", "Graceful application exit requested");
    llm_runtime::stop_runtime();
    terminate_sidecar_processes();
    app.exit(0);
}

#[cfg(windows)]
pub fn cleanup_orphaned_sidecars() {
    logger::log_info(
        "SHUTDOWN",
        "Cleaning up orphaned Windows sidecars from a previous app session",
    );
    terminate_sidecar_processes();
}

#[cfg(windows)]
fn terminate_sidecar_processes() {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    for process_name in managed_sidecar_process_names() {
        let image_name = format!("{process_name}.exe");
        match Command::new("taskkill")
            .args(["/F", "/T", "/IM", &image_name])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            Ok(output) if output.status.success() => logger::log_info(
                "SHUTDOWN",
                &format!("Stopped Windows sidecar process tree: {image_name}"),
            ),
            Ok(_) => {}
            Err(err) => logger::log_error(
                "SHUTDOWN",
                &format!("Failed to stop Windows sidecar {image_name}: {err}"),
            ),
        }
    }
}

#[cfg(unix)]
fn terminate_sidecar_processes() {
    use std::process::Command;

    let output = match Command::new("ps")
        .args(["-ax", "-o", "pid=,command="])
        .output()
    {
        Ok(output) => output,
        Err(err) => {
            logger::log_error(
                "SHUTDOWN",
                &format!("Failed to inspect managed sidecar processes: {err}"),
            );
            return;
        }
    };
    let current_pid = std::process::id();

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let trimmed = line.trim_start();
        let Some((pid_text, command)) = trimmed.split_once(char::is_whitespace) else {
            continue;
        };
        let Ok(pid) = pid_text.parse::<u32>() else {
            continue;
        };

        if pid == current_pid
            || !managed_sidecar_process_names()
                .any(|process_name| command.contains(process_name))
        {
            continue;
        }

        match Command::new("kill").arg(pid.to_string()).status() {
            Ok(status) if status.success() => logger::log_info(
                "SHUTDOWN",
                &format!("Stopped managed sidecar process: pid={pid}"),
            ),
            Ok(_) => {}
            Err(err) => logger::log_error(
                "SHUTDOWN",
                &format!("Failed to stop managed sidecar pid={pid}: {err}"),
            ),
        }
    }
}

#[cfg(not(any(unix, windows)))]
fn terminate_sidecar_processes() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_covers_every_bundled_sidecar() {
        assert_eq!(
            SIDECAR_PROCESS_NAMES,
            &["talkee-ffmpeg", "talkee-stt", "talkee-diarize", "talkee-llm"]
        );
    }

    #[test]
    fn shutdown_also_covers_legacy_sidecar_names() {
        let names: Vec<&str> = managed_sidecar_process_names().collect();
        for legacy in legacy_migration::LEGACY_SIDECAR_NAMES {
            assert!(names.contains(legacy), "missing legacy sidecar {legacy}");
        }
    }
}
