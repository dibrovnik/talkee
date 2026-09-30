import type { MsgKey } from "../../../lib/i18n";
import { DEFAULT_LOCAL_STT_ENDPOINT, DEFAULT_LOCAL_STT_MODEL } from "../../../lib/modelMode";

type LocalRuntimeKind = "whisper" | "diarization";
type LocalModelKind = "transcription" | "text" | "other";

const LOCAL_RUNTIME_ENDPOINTS: Record<LocalRuntimeKind, string> = {
  whisper: DEFAULT_LOCAL_STT_ENDPOINT,
  diarization: "http://127.0.0.1:8003",
};
const LOCAL_STT_PRESET_ENDPOINT = LOCAL_RUNTIME_ENDPOINTS.whisper;
const LOCAL_STT_PRESET_MODEL = DEFAULT_LOCAL_STT_MODEL;
const LOCAL_STT_MODEL_DOWNLOAD_PROGRESS_EVENT = "local-stt-model-download-progress";

function isLocalSttEndpoint(endpoint?: string | null): boolean {
  return /127\.0\.0\.1|localhost/i.test(endpoint || "");
}

interface SettingsTabsProps {
  type: "model" | "style";
}

interface PromptPreview {
  prompt: string;
  layers: string[];
  profileKey: string;
  version: number;
}

interface LocalModelActionState {
  status: "idle" | "installing" | "deleting" | "success" | "error";
  message: string;
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
}

interface LocalModelDownloadProgressEvent {
  model: string;
  status: "starting" | "preparing" | "downloading" | "downloaded";
  downloaded_bytes: number;
  total_bytes?: number | null;
  percent?: number | null;
  message?: string | null;
}

interface LocalTranslatorInfo {
  provider: string;
  name: string;
  status: "not_installed" | "downloading" | "ready" | "error";
  managed: boolean;
  message?: string | null;
}

type ApiAdapterId =
  | "openai"
  | "deepgram"
  | "cartesia"
  | "mistral"
  | "elevenlabs"
  | "fireworks"
  | "groq"
  | "assemblyai"
  | "volcengine"
  | "xai";

type AdapterTestStatus = "idle" | "testing" | "success" | "error" | "info";
type ModelMode = "api" | "local";

interface ApiAdapterOption {
  id: ApiAdapterId;
  name: string;
  description: string;
  recommendedModel: string;
  models: ApiAdapterModelOption[];
  defaultEndpoint: string;
  initials: string;
  accent: string;
  testable: boolean;
}

interface ApiAdapterModelOption {
  id: string;
  supportsStreaming?: boolean;
}

const CUSTOM_API_MODEL_VALUE = "__custom_model__";
const TEXT_MODEL_OPTIONS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"];

const API_ADAPTERS: ApiAdapterOption[] = [
  {
    id: "openai",
    name: "OpenAI API",
    description: "Подключение через OpenAI API для распознавания речи.",
    recommendedModel: "gpt-4o-transcribe",
    models: [
      { id: "gpt-4o-transcribe", supportsStreaming: true },
      { id: "gpt-4o-mini-transcribe", supportsStreaming: true },
      { id: "gpt-realtime-whisper", supportsStreaming: true },
      { id: "whisper-1" },
    ],
    defaultEndpoint: "https://api.openai.com",
    initials: "AI",
    accent: "#0f172a",
    testable: true,
  },
  {
    id: "deepgram",
    name: "Deepgram API",
    description: "Адаптер для облачного распознавания речи через Deepgram.",
    recommendedModel: "nova-3",
    models: [
      { id: "nova-3", supportsStreaming: true },
      { id: "nova-2", supportsStreaming: true },
    ],
    defaultEndpoint: "https://api.deepgram.com",
    initials: "DG",
    accent: "#13ef93",
    testable: false,
  },
  {
    id: "cartesia",
    name: "Cartesia API",
    description: "Адаптер под речевые модели Cartesia.",
    recommendedModel: "sonic",
    models: [{ id: "sonic" }],
    defaultEndpoint: "",
    initials: "CA",
    accent: "#6d5dfc",
    testable: false,
  },
  {
    id: "mistral",
    name: "Mistral AI",
    description: "Адаптер под модели распознавания и обработки Mistral AI.",
    recommendedModel: "voxtral-mini-latest",
    models: [
      { id: "voxtral-mini-latest" },
      { id: "voxtral-mini-transcribe-realtime-2602", supportsStreaming: true },
    ],
    defaultEndpoint: "https://api.mistral.ai",
    initials: "MI",
    accent: "#ff7000",
    testable: false,
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs API",
    description: "Адаптер для speech-to-text сценариев через ElevenLabs.",
    recommendedModel: "scribe_v2",
    models: [
      { id: "scribe_v2" },
      { id: "scribe_v1" },
      { id: "scribe_v2_realtime", supportsStreaming: true },
    ],
    defaultEndpoint: "https://api.elevenlabs.io",
    initials: "EL",
    accent: "#111827",
    testable: false,
  },
  {
    id: "fireworks",
    name: "Fireworks AI API",
    description: "Адаптер под hosted speech-модели Fireworks AI.",
    recommendedModel: "whisper-v3",
    models: [{ id: "whisper-v3" }, { id: "whisper-v3-turbo" }],
    defaultEndpoint: "",
    initials: "FW",
    accent: "#f97316",
    testable: false,
  },
  {
    id: "groq",
    name: "Groq API",
    description: "Адаптер под быстрые hosted Whisper-модели Groq.",
    recommendedModel: "whisper-large-v3-turbo",
    models: [{ id: "whisper-large-v3-turbo" }, { id: "whisper-large-v3" }],
    defaultEndpoint: "",
    initials: "GQ",
    accent: "#f55036",
    testable: false,
  },
  {
    id: "assemblyai",
    name: "AssemblyAI",
    description: "Адаптер для распознавания речи через AssemblyAI.",
    recommendedModel: "universal",
    models: [
      { id: "universal" },
      { id: "u3-rt-pro", supportsStreaming: true },
      { id: "whisper-rt", supportsStreaming: true },
    ],
    defaultEndpoint: "https://streaming.assemblyai.com",
    initials: "AA",
    accent: "#2563eb",
    testable: false,
  },
  {
    id: "volcengine",
    name: "Volcengine API",
    description: "Адаптер под речевые сервисы Volcengine.",
    recommendedModel: "seed-asr",
    models: [{ id: "seed-asr" }],
    defaultEndpoint: "",
    initials: "VE",
    accent: "#7c3aed",
    testable: false,
  },
  {
    id: "xai",
    name: "xAI API",
    description: "Адаптер под API xAI для будущих voice/STT сценариев.",
    recommendedModel: "grok-transcribe",
    models: [{ id: "grok-transcribe", supportsStreaming: true }],
    defaultEndpoint: "https://api.x.ai",
    initials: "xAI",
    accent: "#000000",
    testable: false,
  },
];

interface LocalModelOption {
  id: string;
  name: string;
  description: string;
  model: string;
  engineLabel: string;
  runtime: string;
  runtimeKind: LocalRuntimeKind;
  size: string;
  speed: string;
  accuracy: string;
  languageLabel: string;
  initials: string;
  accent: string;
  recommended?: boolean;
  runtimeReady?: boolean;
  unavailableReason?: string;
  downloadBytes?: number;
  purpose?: "stt" | "diarization";
  supportsStreaming?: boolean;
}

interface LocalOtherComponent {
  id: string;
  name: string;
  descriptionKey: MsgKey;
  model: string;
  engineLabel: string;
  runtime: string;
  size: string;
  speed: string;
  accuracy: string;
  languageLabel: string;
  initials: string;
  accent: string;
  runtimeReady: boolean;
  downloadBytes?: number;
}

const LOCAL_MODEL_OPTIONS: LocalModelOption[] = [
  {
    id: "nemotron-35-asr-streaming-06b",
    name: "NVIDIA Nemotron 3.5 ASR Streaming 0.6B",
    description:
      "Мультиязычная streaming ASR-модель Nemotron для очень быстрой локальной диктовки.",
    model: "nvidia/nemotron-3.5-asr-streaming-0.6b",
    engineLabel: "Nemotron",
    runtime: "Talkee Local / transcribe.cpp",
    runtimeKind: "whisper",
    size: "0.6B",
    speed: "очень быстро",
    accuracy: "высокая",
    languageLabel: "40",
    initials: "N3",
    accent: "#76b900",
    recommended: true,
    runtimeReady: true,
    downloadBytes: 716_000_000,
    supportsStreaming: true,
  },
  {
    id: "gigaam-v3-e2e-rnnt",
    name: "GigaAM v3 E2E RNNT",
    description:
      "Русская ASR-модель с пунктуацией и нормализацией текста для качественной локальной диктовки.",
    model: "ai-sage/GigaAM-v3",
    engineLabel: "GigaAM",
    runtime: "Talkee Local / transcribe.cpp",
    runtimeKind: "whisper",
    size: "0.2B",
    speed: "очень быстро",
    accuracy: "высокая",
    languageLabel: "1",
    initials: "GA",
    accent: "#111827",
    runtimeReady: true,
    downloadBytes: 183_948_704,
  },
  {
    id: "whisper-large-v3-turbo",
    name: "Whisper Large V3 Turbo",
    description:
      "Рекомендуемый Whisper-вариант: быстрый, качественный и хорошо подходит для диктовки.",
    model: "whisper-large-v3-turbo",
    engineLabel: "Whisper",
    runtime: "Talkee Local / transcribe.cpp",
    runtimeKind: "whisper",
    size: "large",
    speed: "быстро",
    accuracy: "высокая",
    languageLabel: "99+",
    initials: "WT",
    accent: "#0f172a",
    runtimeReady: true,
    downloadBytes: 473_992_235,
  },
  {
    id: "whisper-small",
    name: "Whisper Small",
    description: "Баланс скорости и качества для слабых машин и быстрых коротких диктовок.",
    model: "whisper-small",
    engineLabel: "Whisper",
    runtime: "Talkee Local / transcribe.cpp",
    runtimeKind: "whisper",
    size: "small",
    speed: "быстро",
    accuracy: "средняя",
    languageLabel: "99+",
    initials: "WS",
    accent: "#334155",
    runtimeReady: true,
    downloadBytes: 145_458_032,
  },
  {
    id: "whisper-large-v3",
    name: "Whisper Large V3",
    description: "Максимальное качество Whisper, но выше требования к памяти и времени обработки.",
    model: "whisper-large-v3",
    engineLabel: "Whisper",
    runtime: "Talkee Local / transcribe.cpp",
    runtimeKind: "whisper",
    size: "large",
    speed: "средне",
    accuracy: "максимальная",
    languageLabel: "99+",
    initials: "W3",
    accent: "#1e293b",
    runtimeReady: true,
    downloadBytes: 889_340_843,
  },
  {
    id: "whisper-medium",
    name: "Whisper Medium",
    description:
      "Промежуточный вариант между Small и Large: заметно качественнее Small, но тяжелее.",
    model: "whisper-medium",
    engineLabel: "Whisper",
    runtime: "Talkee Local / transcribe.cpp",
    runtimeKind: "whisper",
    size: "medium",
    speed: "средне",
    accuracy: "высокая",
    languageLabel: "99+",
    initials: "WM",
    accent: "#475569",
    runtimeReady: true,
    downloadBytes: 444_493_380,
  },
  {
    id: "whisper-base",
    name: "Whisper Base",
    description: "Быстрая и легкая модель для простых сценариев и слабых машин.",
    model: "whisper-base",
    engineLabel: "Whisper",
    runtime: "Talkee Local / transcribe.cpp",
    runtimeKind: "whisper",
    size: "base",
    speed: "очень быстро",
    accuracy: "базовая",
    languageLabel: "99+",
    initials: "WB",
    accent: "#64748b",
    runtimeReady: true,
    downloadBytes: 46_471_066,
  },
  {
    id: "whisper-tiny",
    name: "Whisper Tiny",
    description:
      "Минимальный размер и максимальная скорость, качество ниже остальных Whisper-моделей.",
    model: "whisper-tiny",
    engineLabel: "Whisper",
    runtime: "Talkee Local / transcribe.cpp",
    runtimeKind: "whisper",
    size: "tiny",
    speed: "очень быстро",
    accuracy: "низкая+",
    languageLabel: "99+",
    initials: "WT",
    accent: "#94a3b8",
    runtimeReady: true,
    downloadBytes: 25_321_834,
  },
  {
    id: "parakeet-tdt-06b-v3",
    name: "NVIDIA Parakeet TDT 0.6B v3",
    description: "Быстрая локальная ASR-модель Parakeet через transcribe.cpp GGUF runtime.",
    model: "nvidia/parakeet-tdt-0.6b-v3",
    engineLabel: "Parakeet",
    runtime: "Talkee Local / transcribe.cpp",
    runtimeKind: "whisper",
    size: "0.6B",
    speed: "быстро",
    accuracy: "высокая",
    languageLabel: "25",
    initials: "P3",
    accent: "#76b900",
    runtimeReady: true,
    downloadBytes: 740_000_000,
  },
  {
    id: "parakeet-tdt-06b-v2",
    name: "NVIDIA Parakeet TDT 0.6B v2",
    description: "Стабильная английская Parakeet TDT-модель через transcribe.cpp GGUF runtime.",
    model: "nvidia/parakeet-tdt-0.6b-v2",
    engineLabel: "Parakeet",
    runtime: "Talkee Local / transcribe.cpp",
    runtimeKind: "whisper",
    size: "0.6B",
    speed: "быстро",
    accuracy: "высокая",
    languageLabel: "English",
    initials: "P2",
    accent: "#5f9f00",
    runtimeReady: true,
    downloadBytes: 730_000_000,
  },
  {
    id: "nemotron-speech-streaming-en-06b",
    name: "NVIDIA Nemotron Speech Streaming EN 0.6B",
    description:
      "Английская streaming ASR-модель Nemotron с минимальной задержкой для live-диктовки.",
    model: "nvidia/nemotron-speech-streaming-en-0.6b",
    engineLabel: "Nemotron",
    runtime: "Talkee Local / transcribe.cpp",
    runtimeKind: "whisper",
    size: "0.6B",
    speed: "очень быстро",
    accuracy: "высокая",
    languageLabel: "English",
    initials: "NS",
    accent: "#5f9f00",
    runtimeReady: true,
    downloadBytes: 696_000_000,
    supportsStreaming: true,
  },
  {
    id: "moonshine-streaming-tiny",
    name: "Moonshine Streaming Tiny",
    description:
      "Очень лёгкая английская streaming-модель для мгновенного локального распознавания.",
    model: "moonshine-streaming-tiny",
    engineLabel: "Moonshine",
    runtime: "Talkee Local / transcribe.cpp",
    runtimeKind: "whisper",
    size: "tiny",
    speed: "очень быстро",
    accuracy: "базовая",
    languageLabel: "English",
    initials: "MT",
    accent: "#8b5cf6",
    runtimeReady: true,
    downloadBytes: 48_000_000,
    supportsStreaming: true,
  },
  {
    id: "moonshine-streaming-small",
    name: "Moonshine Streaming Small",
    description:
      "Лёгкая английская streaming-модель: быстрее Whisper Small и подходит для live-ввода.",
    model: "moonshine-streaming-small",
    engineLabel: "Moonshine",
    runtime: "Talkee Local / transcribe.cpp",
    runtimeKind: "whisper",
    size: "small",
    speed: "очень быстро",
    accuracy: "средняя+",
    languageLabel: "English",
    initials: "MS",
    accent: "#7c3aed",
    runtimeReady: true,
    downloadBytes: 189_000_000,
    supportsStreaming: true,
  },
  {
    id: "qwen3-asr-06b",
    name: "Qwen3-ASR 0.6B",
    description:
      "Компактная ASR-модель Qwen для локального распознавания через transcribe.cpp GGUF runtime.",
    model: "Qwen/Qwen3-ASR-0.6B",
    engineLabel: "Qwen",
    runtime: "Talkee Local / transcribe.cpp",
    runtimeKind: "whisper",
    size: "0.6B",
    speed: "средне",
    accuracy: "высокая",
    languageLabel: "52",
    initials: "Q3",
    accent: "#2563eb",
    runtimeReady: true,
    downloadBytes: 811_000_000,
  },
];

const LOCAL_OTHER_COMPONENTS: LocalOtherComponent[] = [
  {
    id: "nllb-200",
    name: "NLLB-200 Distilled",
    descriptionKey: "models.localOther.nllb-200.description",
    model: "JustFrederik/nllb-200-distilled-600M-ct2-int8",
    engineLabel: "CTranslate2",
    runtime: "Talkee Local / CTranslate2",
    size: "600M INT8",
    speed: "средне",
    accuracy: "средняя+",
    languageLabel: "200+",
    initials: "N2",
    accent: "#2563eb",
    runtimeReady: true,
    downloadBytes: 645_000_000,
  },
  {
    id: "opus-mt-ru-en",
    name: "OPUS-MT RU -> EN",
    descriptionKey: "models.localOther.opus-mt-ru-en.description",
    model: "gaudi/opus-mt-ru-en-ctranslate2",
    engineLabel: "CTranslate2",
    runtime: "Talkee Local / CTranslate2",
    size: "Marian CT2",
    speed: "быстро",
    accuracy: "средняя",
    languageLabel: "RU -> EN",
    initials: "RE",
    accent: "#16a34a",
    runtimeReady: true,
    downloadBytes: 308_000_000,
  },
  {
    id: "opus-mt-en-ru",
    name: "OPUS-MT EN -> RU",
    descriptionKey: "models.localOther.opus-mt-en-ru.description",
    model: "manancode/opus-mt-en-ru-ctranslate2-android",
    engineLabel: "CTranslate2",
    runtime: "Talkee Local / CTranslate2",
    size: "Marian CT2 INT8",
    speed: "быстро",
    accuracy: "средняя",
    languageLabel: "EN -> RU",
    initials: "ER",
    accent: "#0f766e",
    runtimeReady: true,
    downloadBytes: 83_000_000,
  },
];

// Translation keys for the per-adapter / per-model descriptions. The original
// Russian text lives in the i18n dictionary fragment (settingsModels); these maps
// keep the keys statically typed so they satisfy the MsgKey union.
const API_ADAPTER_DESCRIPTION_KEYS: Record<ApiAdapterId, MsgKey> = {
  openai: "models.adapter.openai.description",
  deepgram: "models.adapter.deepgram.description",
  cartesia: "models.adapter.cartesia.description",
  mistral: "models.adapter.mistral.description",
  elevenlabs: "models.adapter.elevenlabs.description",
  fireworks: "models.adapter.fireworks.description",
  groq: "models.adapter.groq.description",
  assemblyai: "models.adapter.assemblyai.description",
  volcengine: "models.adapter.volcengine.description",
  xai: "models.adapter.xai.description",
};

const LOCAL_MODEL_DESCRIPTION_KEYS: Record<string, MsgKey> = {
  "whisper-large-v3-turbo": "models.local.whisper-large-v3-turbo.description",
  "whisper-small": "models.local.whisper-small.description",
  "whisper-large-v3": "models.local.whisper-large-v3.description",
  "whisper-medium": "models.local.whisper-medium.description",
  "whisper-base": "models.local.whisper-base.description",
  "whisper-tiny": "models.local.whisper-tiny.description",
  "parakeet-tdt-06b-v3": "models.local.parakeet-tdt-06b-v3.description",
  "parakeet-tdt-06b-v2": "models.local.parakeet-tdt-06b-v2.description",
  "nemotron-35-asr-streaming-06b": "models.local.nemotron-35-asr-streaming-06b.description",
  "nemotron-speech-streaming-en-06b": "models.local.nemotron-speech-streaming-en-06b.description",
  "moonshine-streaming-tiny": "models.local.moonshine-streaming-tiny.description",
  "moonshine-streaming-small": "models.local.moonshine-streaming-small.description",
  "qwen3-asr-06b": "models.local.qwen3-asr-06b.description",
  "gigaam-v3-e2e-rnnt": "models.local.gigaam-v3-e2e-rnnt.description",
};

export {
  type AdapterTestStatus,
  API_ADAPTER_DESCRIPTION_KEYS,
  API_ADAPTERS,
  type ApiAdapterId,
  type ApiAdapterModelOption,
  type ApiAdapterOption,
  CUSTOM_API_MODEL_VALUE,
  isLocalSttEndpoint,
  LOCAL_MODEL_DESCRIPTION_KEYS,
  LOCAL_MODEL_OPTIONS,
  LOCAL_OTHER_COMPONENTS,
  LOCAL_RUNTIME_ENDPOINTS,
  LOCAL_STT_MODEL_DOWNLOAD_PROGRESS_EVENT,
  LOCAL_STT_PRESET_ENDPOINT,
  LOCAL_STT_PRESET_MODEL,
  type LocalModelActionState,
  type LocalModelDownloadProgressEvent,
  type LocalModelKind,
  type LocalModelOption,
  type LocalOtherComponent,
  type LocalRuntimeKind,
  type LocalTranslatorInfo,
  type ModelMode,
  type PromptPreview,
  type SettingsTabsProps,
  TEXT_MODEL_OPTIONS,
};
