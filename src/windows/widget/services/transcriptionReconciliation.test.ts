import { describe, expect, test } from "bun:test";

import type { AppSettings } from "../../../lib/store";

import {
  resolveLiveTranscriptionReconciliationMode,
  shouldAcceptLiveTranscription,
} from "./transcriptionReconciliation";

function settings(overrides: Partial<AppSettings>): AppSettings {
  return {
    realtimeTranscriptionEnabled: true,
    selectedApiAdapter: "openai",
    apiAdapters: {},
    whisperModel: "",
    ...overrides,
  } as AppSettings;
}

describe("live transcription reconciliation", () => {
  test("does not reconcile when realtime produced no result", () => {
    expect(resolveLiveTranscriptionReconciliationMode(settings({}), false)).toBeNull();
  });

  test("preserves reconciliation for the legacy own-key OpenAI realtime model", () => {
    const ownKeySettings = settings({
      apiAdapters: {
        openai: {
          apiKey: "openai-key",
          endpoint: "https://api.openai.com",
          model: "gpt-realtime-whisper",
          connectionStatus: "verified",
          streamingCapability: "supported",
          streamingCapabilityFingerprint: "verified-config",
        },
      },
    });

    expect(shouldAcceptLiveTranscription(ownKeySettings, true)).toBe(true);
    expect(resolveLiveTranscriptionReconciliationMode(ownKeySettings, true)).toBe("openai");
  });

  test("does not add batch reconciliation to local or unrelated API realtime models", () => {
    expect(
      resolveLiveTranscriptionReconciliationMode(
        settings({
          selectedApiAdapter: "deepgram",
        }),
        true,
      ),
    ).toBeNull();
    expect(
      resolveLiveTranscriptionReconciliationMode(
        settings({
          selectedApiAdapter: "openai",
          apiAdapters: {
            openai: {
              apiKey: "openai-key",
              endpoint: "https://api.openai.com",
              model: "gpt-4o-transcribe",
              connectionStatus: "verified",
              streamingCapability: "supported",
              streamingCapabilityFingerprint: "verified-config",
            },
          },
        }),
        true,
      ),
    ).toBeNull();
  });
});
