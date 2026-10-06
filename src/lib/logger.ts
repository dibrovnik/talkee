import { invoke } from "@tauri-apps/api/core";

export async function logInfo(tag: string, message: string): Promise<void> {
  console.log(`[${tag}] ${message}`);
  try {
    await invoke("log_event", { level: "INFO", tag, message });
  } catch {
    // ignore Tauri errors
  }
}

export async function logError(tag: string, message: string): Promise<void> {
  console.error(`[${tag}] ${message}`);
  try {
    await invoke("log_event", { level: "ERROR", tag, message });
  } catch {
    // ignore Tauri errors
  }
}

export async function logDebug(tag: string, message: string): Promise<void> {
  console.log(`[${tag}] ${message}`);
  try {
    await invoke("log_event", { level: "DEBUG", tag, message });
  } catch {
    // ignore Tauri errors
  }
}

export async function getLogPath(): Promise<string> {
  try {
    return await invoke("get_log_path_cmd");
  } catch {
    return "~/.talkee/talkee.log";
  }
}

export async function clearLogs(): Promise<void> {
  try {
    await invoke("clear_logs");
  } catch {
    // ignore
  }
}

/** Only known error categories enter diagnostic logs, never provider bodies. */
export function processingErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const code = message.match(/^\[text:([a-z_]+|http_\d{3})\]/)?.[1];
  if (code) return code;
  if (/abort/i.test(message)) return "cancelled";
  if (/timeout|timed out|таймаут/i.test(message)) return "timeout";
  return "unknown";
}
export function safeEndpoint(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "invalid-endpoint";
  }
}
export function diagnosticId(value: string): string {
  return value.slice(0, 96).replace(/[^a-z0-9_.:/-]/gi, "_");
}
