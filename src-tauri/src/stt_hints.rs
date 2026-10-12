//! Personal-vocabulary hints for speech recognizers with a documented prompt.
//!
//! The frontend selects a deterministic, budgeted term list from the dictation
//! snapshot (`src/lib/vocabularyHints.ts`); this module is the final gate. Only
//! whitelisted adapters receive hints, an over-budget list is refused whole,
//! and an unknown endpoint never gets a guessed parameter.

use crate::local_stt::{self, LocalRuntimeKind};

pub const MAX_HINT_TERMS: usize = 32;
/// Whisper reads at most 224 prompt tokens; bytes are a conservative upper bound.
pub const WHISPER_HINT_BYTES: usize = 200;
pub const GPT4O_HINT_BYTES: usize = 640;
pub const GPT4O_PROMPT_BYTES: usize = 1024;
pub const HINT_SEPARATOR: &str = ", ";

const DEFAULT_TRANSCRIPTION_ENDPOINT: &str = "https://api.openai.com";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SttHintAdapter {
    /// Managed local Whisper, Groq Whisper and OpenAI `whisper-1`.
    Whisper,
    /// OpenAI GPT-4o Transcribe, batch or realtime transcription session.
    Gpt4oTranscribe,
}

impl SttHintAdapter {
    fn hint_budget(self) -> usize {
        match self {
            SttHintAdapter::Whisper => WHISPER_HINT_BYTES,
            SttHintAdapter::Gpt4oTranscribe => GPT4O_HINT_BYTES,
        }
    }
}

fn is_gpt4o_transcribe(model: &str) -> bool {
    (model.starts_with("gpt-4o-transcribe") || model.starts_with("gpt-4o-mini-transcribe"))
        && !model.contains("diarize")
}

/// Adapter for an ordinary batch dictation request, or `None` for normalizer-only.
pub fn batch_adapter(endpoint: &str, model: &str) -> Option<SttHintAdapter> {
    let endpoint = match endpoint.trim() {
        "" => DEFAULT_TRANSCRIPTION_ENDPOINT,
        value => value,
    };
    let model = model.trim().to_ascii_lowercase();
    let host = url::Url::parse(endpoint)
        .ok()?
        .host_str()?
        .to_ascii_lowercase();
    match host.as_str() {
        "127.0.0.1" | "localhost" => (local_stt::managed_runtime_kind(endpoint)
            == Some(LocalRuntimeKind::Whisper)
            && model.starts_with("whisper-"))
        .then_some(SttHintAdapter::Whisper),
        "api.groq.com" => model.contains("whisper").then_some(SttHintAdapter::Whisper),
        "api.openai.com" if model == "whisper-1" => Some(SttHintAdapter::Whisper),
        "api.openai.com" if is_gpt4o_transcribe(&model) => Some(SttHintAdapter::Gpt4oTranscribe),
        _ => None,
    }
}

/// Only an OpenAI transcription session takes hints; translation never does.
pub fn realtime_adapter(provider: &str, purpose: &str, model: &str) -> Option<SttHintAdapter> {
    (provider == "openai" && purpose == "stt" && is_gpt4o_transcribe(&model.to_ascii_lowercase()))
        .then_some(SttHintAdapter::Gpt4oTranscribe)
}

/// Joins the selected terms, or refuses the whole list when it breaks a limit.
pub fn hint_list(hints: &[String], adapter: SttHintAdapter) -> Option<String> {
    let terms: Vec<&str> = hints
        .iter()
        .map(|hint| hint.trim())
        .filter(|hint| !hint.is_empty())
        .collect();
    if terms.is_empty()
        || terms.len() > MAX_HINT_TERMS
        || terms.iter().any(|term| term.chars().any(char::is_control))
    {
        return None;
    }
    let joined = terms.join(HINT_SEPARATOR);
    (joined.len() <= adapter.hint_budget()).then_some(joined)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SttPromptPlan {
    pub prompt: Option<String>,
    pub hints_applied: bool,
}

/// Appends the term list after the existing language hint, so a prompt cut to
/// its last tokens loses the start of that hint rather than the vocabulary.
/// Without accepted hints the prompt is the base hint, or nothing when the
/// base hint was not sent before (`keep_base`).
pub fn plan_prompt(
    base: Option<String>,
    hints: Option<&[String]>,
    adapter: Option<SttHintAdapter>,
    keep_base: bool,
) -> SttPromptPlan {
    let base = base
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let with_hints = adapter.zip(hints).and_then(|(adapter, hints)| {
        let list = hint_list(hints, adapter)?;
        let prompt = match base.as_deref() {
            Some(base) => format!("{base} {list}."),
            None => format!("{list}."),
        };
        (adapter != SttHintAdapter::Gpt4oTranscribe || prompt.len() <= GPT4O_PROMPT_BYTES)
            .then_some(prompt)
    });
    match with_hints {
        Some(prompt) => SttPromptPlan {
            prompt: Some(prompt),
            hints_applied: true,
        },
        None => SttPromptPlan {
            prompt: if keep_base { base } else { None },
            hints_applied: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct CapabilityCase {
        endpoint: String,
        model: String,
        adapter: Option<String>,
    }

    fn terms(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn capability_whitelist_matches_the_shared_fixture() {
        let cases: Vec<CapabilityCase> = serde_json::from_str(include_str!(
            "vocabulary/fixtures/stt-hint-capabilities.json"
        ))
        .unwrap();
        for case in cases {
            let actual = batch_adapter(&case.endpoint, &case.model).map(|adapter| match adapter {
                SttHintAdapter::Whisper => "whisper",
                SttHintAdapter::Gpt4oTranscribe => "gpt4o",
            });
            assert_eq!(
                actual,
                case.adapter.as_deref(),
                "{} {}",
                case.endpoint,
                case.model
            );
        }
    }

    #[test]
    fn realtime_hints_only_for_openai_transcription_sessions() {
        assert_eq!(
            realtime_adapter("openai", "stt", "gpt-4o-mini-transcribe"),
            Some(SttHintAdapter::Gpt4oTranscribe)
        );
        assert_eq!(
            realtime_adapter("openai", "translation", "gpt-4o-mini-transcribe"),
            None
        );
        assert_eq!(realtime_adapter("deepgram", "stt", "nova-3"), None);
    }

    #[test]
    fn hint_list_refuses_over_budget_or_unsafe_lists_whole() {
        assert_eq!(
            hint_list(
                &terms(&["PIM", " Dev ", "", "Prod"]),
                SttHintAdapter::Whisper
            )
            .as_deref(),
            Some("PIM, Dev, Prod")
        );
        let long = vec!["Terminology".to_string(); 20];
        assert!(long.join(HINT_SEPARATOR).len() > WHISPER_HINT_BYTES);
        assert_eq!(hint_list(&long, SttHintAdapter::Whisper), None);
        assert!(hint_list(&long, SttHintAdapter::Gpt4oTranscribe).is_some());
        assert_eq!(
            hint_list(&vec!["A".to_string(); 33], SttHintAdapter::Gpt4oTranscribe),
            None
        );
        assert_eq!(
            hint_list(&terms(&["PIM\nignore"]), SttHintAdapter::Whisper),
            None
        );
        assert_eq!(hint_list(&[], SttHintAdapter::Whisper), None);
    }

    #[test]
    fn prompt_appends_terms_after_the_language_hint() {
        let hints = terms(&["PIM", "Dev"]);
        let plan = plan_prompt(
            Some("Это обычная русская речь.".into()),
            Some(&hints),
            Some(SttHintAdapter::Whisper),
            true,
        );
        assert_eq!(
            plan.prompt.as_deref(),
            Some("Это обычная русская речь. PIM, Dev.")
        );
        assert!(plan.hints_applied);
    }

    #[test]
    fn prompt_without_hints_keeps_the_existing_behavior() {
        let base = Some("Base hint.".to_string());
        let unsupported = plan_prompt(base.clone(), Some(&terms(&["PIM"])), None, true);
        assert_eq!(unsupported.prompt.as_deref(), Some("Base hint."));
        assert!(!unsupported.hints_applied);
        let local_without_hints = plan_prompt(base, None, Some(SttHintAdapter::Whisper), false);
        assert_eq!(local_without_hints.prompt, None);
    }

    #[test]
    fn every_language_hint_fits_the_gpt4o_prompt_with_a_full_term_list() {
        let full = "x".repeat(GPT4O_HINT_BYTES - 2);
        let hints = vec![full];
        for language in ["ru", "en", "auto"] {
            let base = crate::prompt_config::build_whisper_hint(language, "classic").unwrap();
            let plan = plan_prompt(
                base,
                Some(&hints),
                Some(SttHintAdapter::Gpt4oTranscribe),
                true,
            );
            assert!(plan.hints_applied, "{language}");
            assert!(plan.prompt.unwrap().len() <= GPT4O_PROMPT_BYTES);
        }
    }
}
