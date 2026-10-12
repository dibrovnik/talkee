//! Source-checked learning. Inference output is data, never a ready-made store.
use super::model::*;
use super::store::{new_id, now_ms, upsert_term, TermInput, VariantInput, VocabularyError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

pub fn source_text(entry: &Value) -> Option<(String, String)> {
    if entry
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or("voice")
        != "voice"
        || entry
            .get("status")
            .and_then(Value::as_str)
            .is_some_and(|s| s != "completed")
        || entry
            .get("dictationTranslation")
            .is_some_and(|v| !v.is_null())
        || entry
            .get("errorMessage")
            .and_then(Value::as_str)
            .is_some_and(|s| !s.is_empty())
    {
        return None;
    }
    let cleaned = entry.get("cleaned").and_then(Value::as_str).unwrap_or("");
    let raw = entry
        .get("raw")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or(cleaned);
    if raw.trim().is_empty() {
        return None;
    }
    let before = entry
        .get("preVocabularyText")
        .and_then(Value::as_str)
        .or_else(|| (entry.get("personalization").is_none() && cleaned != raw).then_some(cleaned))
        .unwrap_or("");
    Some((raw.to_owned(), before.to_owned()))
}

pub fn source_fingerprint(raw: &str, before: &str) -> String {
    let bytes = serde_json::to_vec(&(raw, before)).unwrap_or_default();
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CorrectionInput {
    pub source_id: String,
    pub source_fingerprint: String,
    pub source_variant: String,
    pub canonical: String,
    pub language: String,
    pub category: TermCategory,
    pub scope: TermScope,
    pub case_sensitive: bool,
    pub context_words: Vec<String>,
    pub add_rule: bool,
}

pub fn recount(state: &mut VocabularyState) {
    for suggestion in &mut state.suggestions {
        let evidence: Vec<_> = state
            .evidence
            .iter()
            .filter(|e| e.suggestion_id == suggestion.id)
            .collect();
        suggestion.source_count = evidence
            .iter()
            .map(|e| &e.source_id)
            .collect::<HashSet<_>>()
            .len() as u32;
        if let Some(origin) = evidence.iter().map(|e| e.origin).min() {
            suggestion.origin = origin;
        }
        if matches!(
            suggestion.status,
            SuggestionStatus::Collecting | SuggestionStatus::Ready
        ) {
            suggestion.status = if evidence
                .iter()
                .any(|e| e.origin == EvidenceOrigin::HumanCorrection)
                || suggestion.source_count >= 3
            {
                SuggestionStatus::Ready
            } else {
                SuggestionStatus::Collecting
            };
        }
    }
    state.suggestions.retain(|s| {
        s.source_count > 0
            || matches!(
                s.status,
                SuggestionStatus::Approved | SuggestionStatus::Rejected
            )
    });
}

pub fn pair_key(canonical: &str, source: &str, language: &str, scope: &TermScope) -> String {
    serde_json::to_string(&(
        match_key(canonical),
        match_key(source),
        language,
        scope.key(),
    ))
    .unwrap_or_default()
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Fragment {
    pub id: String,
    pub source_id: String,
    pub fingerprint: String,
    pub origin: EvidenceOrigin,
    pub start: u32,
    pub end: u32,
    pub text: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Citation {
    pub fragment_id: String,
    pub quote: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Candidate {
    pub canonical: String,
    pub variant: String,
    pub language: String,
    pub category: TermCategory,
    pub scope: TermScope,
    pub case_sensitive: bool,
    pub context_words: Vec<String>,
    pub citations: Vec<Citation>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisBatch {
    pub fragments: Vec<Fragment>,
    pub candidates: Vec<Candidate>,
}

pub fn validate_fragment(fragment: &Fragment, entry: &Value) -> Result<(), VocabularyError> {
    let (raw, before) = source_text(entry)
        .ok_or_else(|| VocabularyError::Validation("Исходная запись недоступна".into()))?;
    let raw_len = raw.chars().count() as u32;
    let valid_origin = match fragment.origin {
        EvidenceOrigin::SttHypothesis => fragment.end <= raw_len,
        EvidenceOrigin::CleanupDiff => fragment.start > raw_len,
        EvidenceOrigin::HumanCorrection => false,
    };
    let combined = format!("{raw}\n{before}");
    let text: String = combined
        .chars()
        .skip(fragment.start as usize)
        .take(fragment.end.saturating_sub(fragment.start) as usize)
        .collect();
    if !valid_origin
        || fragment.end <= fragment.start
        || text != fragment.text
        || source_fingerprint(&raw, &before) != fragment.fingerprint
    {
        return Err(VocabularyError::Validation(
            "Исходная запись изменилась".into(),
        ));
    }
    Ok(())
}

pub fn commit_batch(
    state: &mut VocabularyState,
    batch: AnalysisBatch,
) -> Result<(), VocabularyError> {
    if batch.fragments.is_empty()
        || batch.fragments.len() > 20
        || batch.candidates.len() > 5
        || serde_json::to_vec(&batch).map_or(true, |v| v.len() > 64 * 1024)
    {
        return Err(VocabularyError::Validation(
            "Пакет анализа превышает лимиты".into(),
        ));
    }
    for candidate in batch.candidates {
        validate_term(&Term {
            id: "validation".into(),
            canonical: candidate.canonical.clone(),
            language: candidate.language.clone(),
            category: candidate.category,
            scope: candidate.scope.clone(),
            enabled: true,
            use_as_hint: true,
            provenance: Provenance::HistoryAnalysis,
            created_at: 0,
            updated_at: 0,
            variants: vec![Variant {
                id: "validation-rule".into(),
                source: candidate.variant.clone(),
                enabled: true,
                case_sensitive: candidate.case_sensitive,
                context_words: candidate.context_words.clone(),
                provenance: Provenance::HistoryAnalysis,
            }],
        })
        .map_err(VocabularyError::Validation)?;
        if candidate.citations.is_empty() || candidate.citations.len() > 3 {
            return Err(VocabularyError::Validation("Недостаточно цитат".into()));
        }
        let key = pair_key(
            &candidate.canonical,
            &candidate.variant,
            &candidate.language,
            &candidate.scope,
        );
        let suppressed = state.dismissals.iter().any(|d| d.key == key)
            || state.terms.iter().any(|t| {
                match_key(&t.canonical) == match_key(&candidate.canonical)
                    && t.language == candidate.language
                    && t.scope.key() == candidate.scope.key()
                    && t.variants
                        .iter()
                        .any(|v| match_key(&v.source) == match_key(&candidate.variant))
            });
        // Validate citations even for dismissed pairs; invalid output never checkpoints.
        for citation in &candidate.citations {
            let fragment = batch
                .fragments
                .iter()
                .find(|f| f.id == citation.fragment_id)
                .ok_or_else(|| VocabularyError::Validation("Неизвестная цитата".into()))?;
            if citation.quote.chars().count() > MAX_QUOTE_CHARS
                || !fragment.text.contains(&citation.quote)
                || !citation.quote.contains(&candidate.variant)
            {
                return Err(VocabularyError::Validation(
                    "Цитата не подтверждается исходником".into(),
                ));
            }
        }
        if suppressed {
            continue;
        }
        let now = now_ms();
        let existing = state.suggestions.iter().position(|s| {
            match_key(&s.canonical) == match_key(&candidate.canonical)
                && s.language == candidate.language
                && s.scope.key() == candidate.scope.key()
        });
        let id = if let Some(index) = existing {
            let suggestion = &mut state.suggestions[index];
            if matches!(
                suggestion.status,
                SuggestionStatus::Rejected | SuggestionStatus::Approved
            ) {
                continue;
            }
            if !suggestion
                .variants
                .iter()
                .any(|v| match_key(&v.source) == match_key(&candidate.variant))
            {
                suggestion.variants.push(SuggestionVariant {
                    source: candidate.variant.clone(),
                    case_sensitive: candidate.case_sensitive,
                    context_words: candidate.context_words.clone(),
                    selected: false,
                });
            }
            suggestion.updated_at = now;
            suggestion.id.clone()
        } else {
            let id = new_id("suggestion");
            state.suggestions.push(Suggestion {
                id: id.clone(),
                canonical: candidate.canonical.clone(),
                language: candidate.language.clone(),
                category: candidate.category,
                scope: candidate.scope.clone(),
                variants: vec![SuggestionVariant {
                    source: candidate.variant.clone(),
                    case_sensitive: candidate.case_sensitive,
                    context_words: candidate.context_words.clone(),
                    selected: false,
                }],
                status: SuggestionStatus::Collecting,
                origin: EvidenceOrigin::SttHypothesis,
                source_count: 0,
                created_at: now,
                updated_at: now,
            });
            id
        };
        for citation in candidate.citations {
            let fragment = batch
                .fragments
                .iter()
                .find(|f| f.id == citation.fragment_id)
                .expect("checked above");
            if state.evidence.iter().any(|e| {
                e.suggestion_id == id
                    && e.source_id == fragment.source_id
                    && e.source_variant == candidate.variant
            }) {
                continue;
            }
            let relative = fragment
                .text
                .find(&candidate.variant)
                .expect("citation checked");
            let start = fragment.start + fragment.text[..relative].chars().count() as u32;
            state.evidence.push(Evidence {
                id: new_id("evidence"),
                suggestion_id: id.clone(),
                origin: fragment.origin,
                source_id: fragment.source_id.clone(),
                source_fingerprint: fragment.fingerprint.clone(),
                quote: citation.quote,
                source_variant: candidate.variant.clone(),
                range_start: start,
                range_end: start + candidate.variant.chars().count() as u32,
                created_at: now,
            });
        }
    }
    for fragment in batch.fragments {
        let index = state
            .coverage
            .iter()
            .position(|c| c.source_id == fragment.source_id);
        if let Some(index) = index {
            let coverage = &mut state.coverage[index];
            if coverage.fingerprint != fragment.fingerprint {
                coverage.fingerprint = fragment.fingerprint;
                coverage.ranges.clear();
            }
            coverage.ranges.push([fragment.start, fragment.end]);
            coverage.ranges.sort_unstable();
            let mut merged: Vec<[u32; 2]> = vec![];
            for range in &coverage.ranges {
                if let Some(last) = merged.last_mut().filter(|last| last[1] >= range[0]) {
                    last[1] = last[1].max(range[1]);
                } else {
                    merged.push(*range);
                }
            }
            coverage.ranges = merged;
        } else {
            state.coverage.push(Coverage {
                source_id: fragment.source_id,
                fingerprint: fragment.fingerprint,
                ranges: vec![[fragment.start, fragment.end]],
            });
        }
    }
    recount(state);
    Ok(())
}

pub fn invalidate_sources(state: &mut VocabularyState, ids: &HashSet<String>) {
    state.data_epoch += 1;
    state.evidence.retain(|e| !ids.contains(&e.source_id));
    state.coverage.retain(|c| !ids.contains(&c.source_id));
    recount(state);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewInput {
    pub suggestion_id: String,
    pub action: String,
    pub canonical: String,
    pub scope: TermScope,
    pub category: TermCategory,
    pub variants: Vec<VariantInput>,
}
pub fn review(state: &mut VocabularyState, input: ReviewInput) -> Result<(), VocabularyError> {
    let index = state
        .suggestions
        .iter()
        .position(|s| s.id == input.suggestion_id)
        .ok_or_else(|| VocabularyError::NotFound("Предложение не найдено".into()))?;
    let suggestion = state.suggestions[index].clone();
    let keys: Vec<_> = suggestion
        .variants
        .iter()
        .map(|v| {
            pair_key(
                &suggestion.canonical,
                &v.source,
                &suggestion.language,
                &suggestion.scope,
            )
        })
        .collect();
    match input.action.as_str() {
        "reject" => {
            for key in keys {
                if !state.dismissals.iter().any(|d| d.key == key) {
                    state.dismissals.push(Dismissal {
                        key,
                        created_at: now_ms(),
                    });
                }
            }
            state.suggestions[index].status = SuggestionStatus::Rejected;
        }
        "restore" => {
            state.dismissals.retain(|d| !keys.contains(&d.key));
            state.suggestions[index].status = SuggestionStatus::Collecting;
            recount(state);
        }
        "accept" => {
            if suggestion.status == SuggestionStatus::Approved {
                return Ok(());
            }
            if suggestion.status != SuggestionStatus::Ready {
                return Err(VocabularyError::Validation(
                    "Недостаточно подтверждённых примеров".into(),
                ));
            }
            let existing = state
                .terms
                .iter()
                .find(|t| {
                    match_key(&t.canonical) == match_key(&input.canonical)
                        && t.language == suggestion.language
                        && t.scope.key() == input.scope.key()
                })
                .cloned();
            let mut variants: Vec<_> = existing
                .as_ref()
                .map(|t| {
                    t.variants
                        .iter()
                        .map(|v| VariantInput {
                            id: Some(v.id.clone()),
                            source: v.source.clone(),
                            enabled: v.enabled,
                            case_sensitive: v.case_sensitive,
                            context_words: v.context_words.clone(),
                        })
                        .collect()
                })
                .unwrap_or_default();
            for variant in input.variants {
                if !suggestion
                    .variants
                    .iter()
                    .any(|v| match_key(&v.source) == match_key(&variant.source))
                {
                    return Err(VocabularyError::Validation(
                        "Вариант отсутствует в предложении".into(),
                    ));
                }
                if !variants
                    .iter()
                    .any(|v| match_key(&v.source) == match_key(&variant.source))
                {
                    variants.push(variant);
                }
            }
            upsert_term(
                state,
                TermInput {
                    id: existing.as_ref().map(|t| t.id.clone()),
                    canonical: input.canonical,
                    language: suggestion.language,
                    category: input.category,
                    scope: input.scope,
                    enabled: true,
                    use_as_hint: true,
                    provenance: Some(Provenance::HistoryAnalysis),
                    variants,
                },
            )?;
            state.suggestions[index].status = SuggestionStatus::Approved;
            state.suggestions[index].updated_at = now_ms();
        }
        _ => return Err(VocabularyError::Validation("Неизвестное действие".into())),
    }
    Ok(())
}

pub fn save_correction(
    state: &mut VocabularyState,
    input: CorrectionInput,
    entry: &Value,
) -> Result<(), VocabularyError> {
    validate_term(&Term {
        id: "validation".into(),
        canonical: input.canonical.clone(),
        language: input.language.clone(),
        category: input.category,
        scope: input.scope.clone(),
        enabled: true,
        use_as_hint: true,
        provenance: Provenance::HumanCorrection,
        created_at: 0,
        updated_at: 0,
        variants: vec![Variant {
            id: "validation-rule".into(),
            source: input.source_variant.clone(),
            enabled: true,
            case_sensitive: input.case_sensitive,
            context_words: input.context_words.clone(),
            provenance: Provenance::HumanCorrection,
        }],
    })
    .map_err(VocabularyError::Validation)?;
    let (raw, before) = source_text(entry).ok_or_else(|| {
        VocabularyError::Validation("Выберите завершённую обычную диктовку".into())
    })?;
    if source_fingerprint(&raw, &before) != input.source_fingerprint {
        return Err(VocabularyError::Validation(
            "Исходная запись изменилась. Выберите её заново".into(),
        ));
    }
    let text = if raw.contains(&input.source_variant) {
        &raw
    } else {
        &before
    };
    let byte_start = text.find(&input.source_variant).ok_or_else(|| {
        VocabularyError::Validation("Ошибочный фрагмент отсутствует в исходнике".into())
    })?;
    let start = text[..byte_start].chars().count();
    let now = now_ms();
    let key = pair_key(
        &input.canonical,
        &input.source_variant,
        &input.language,
        &input.scope,
    );
    state.dismissals.retain(|d| d.key != key);
    let found = state.suggestions.iter().position(|s| {
        s.canonical == input.canonical
            && s.language == input.language
            && s.scope.key() == input.scope.key()
            && s.variants.iter().any(|v| v.source == input.source_variant)
    });
    let id = if let Some(index) = found {
        let s = &mut state.suggestions[index];
        s.status = SuggestionStatus::Ready;
        s.origin = EvidenceOrigin::HumanCorrection;
        s.updated_at = now;
        s.id.clone()
    } else {
        let id = new_id("suggestion");
        state.suggestions.push(Suggestion {
            id: id.clone(),
            canonical: input.canonical.clone(),
            language: input.language.clone(),
            category: input.category,
            scope: input.scope.clone(),
            status: SuggestionStatus::Ready,
            variants: vec![SuggestionVariant {
                source: input.source_variant.clone(),
                case_sensitive: input.case_sensitive,
                context_words: input.context_words.clone(),
                selected: false,
            }],
            origin: EvidenceOrigin::HumanCorrection,
            source_count: 1,
            created_at: now,
            updated_at: now,
        });
        id
    };
    // Repeated confirmation is one source, not another independent example.
    if !state.evidence.iter().any(|e| {
        e.suggestion_id == id
            && e.source_id == input.source_id
            && e.origin == EvidenceOrigin::HumanCorrection
    }) {
        let quote_start = start.saturating_sub(80);
        let quote: String = text
            .chars()
            .skip(quote_start)
            .take(MAX_QUOTE_CHARS)
            .collect();
        state.evidence.push(Evidence {
            id: new_id("evidence"),
            suggestion_id: id.clone(),
            origin: EvidenceOrigin::HumanCorrection,
            source_id: input.source_id,
            source_fingerprint: input.source_fingerprint,
            quote,
            source_variant: input.source_variant.clone(),
            range_start: start as u32,
            range_end: (start + input.source_variant.chars().count()) as u32,
            created_at: now,
        });
    }
    if input.add_rule {
        let existing = state
            .terms
            .iter()
            .find(|t| {
                match_key(&t.canonical) == match_key(&input.canonical)
                    && t.language == input.language
                    && t.scope.key() == input.scope.key()
            })
            .cloned();
        let mut variants: Vec<VariantInput> = existing
            .as_ref()
            .map(|t| {
                t.variants
                    .iter()
                    .map(|v| VariantInput {
                        id: Some(v.id.clone()),
                        source: v.source.clone(),
                        enabled: v.enabled,
                        case_sensitive: v.case_sensitive,
                        context_words: v.context_words.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        if !variants.iter().any(|v| v.source == input.source_variant) {
            variants.push(VariantInput {
                id: None,
                source: input.source_variant,
                enabled: true,
                case_sensitive: input.case_sensitive,
                context_words: input.context_words,
            });
        }
        upsert_term(
            state,
            TermInput {
                id: existing.as_ref().map(|t| t.id.clone()),
                canonical: input.canonical,
                language: input.language,
                category: input.category,
                scope: input.scope,
                enabled: existing.as_ref().is_none_or(|t| t.enabled),
                use_as_hint: existing.as_ref().is_none_or(|t| t.use_as_hint),
                provenance: Some(Provenance::HumanCorrection),
                variants,
            },
        )?;
        if let Some(s) = state.suggestions.iter_mut().find(|s| s.id == id) {
            s.status = SuggestionStatus::Approved;
        }
    }
    recount(state);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn correction(entry: &Value, add_rule: bool) -> CorrectionInput {
        let (raw, before) = source_text(entry).unwrap();
        CorrectionInput {
            source_id: "source-1".into(),
            source_fingerprint: source_fingerprint(&raw, &before),
            source_variant: "пи ай эм".into(),
            canonical: "PIM".into(),
            language: "any".into(),
            category: TermCategory::Other,
            scope: TermScope::global(),
            case_sensitive: false,
            context_words: vec![],
            add_rule,
        }
    }

    #[test]
    fn human_confirmation_is_ready_but_only_separate_approval_adds_rule() {
        let entry = json!({"raw":"Открой пи ай эм.", "cleaned":"Открой пи ай эм.", "source":"voice", "status":"completed"});
        let mut state = VocabularyState::default();
        save_correction(&mut state, correction(&entry, false), &entry).unwrap();
        save_correction(&mut state, correction(&entry, false), &entry).unwrap();
        assert!(state.terms.is_empty());
        assert_eq!(state.evidence.len(), 1);
        assert_eq!(state.suggestions[0].status, SuggestionStatus::Ready);
        assert_eq!(state.suggestions[0].source_count, 1);
        save_correction(&mut state, correction(&entry, true), &entry).unwrap();
        assert_eq!(state.terms[0].variants.len(), 1);
        assert_eq!(state.suggestions[0].status, SuggestionStatus::Approved);
        assert_eq!(entry["raw"], "Открой пи ай эм.");
    }

    #[test]
    fn changed_source_and_unsafe_pair_are_rejected_before_evidence() {
        let entry = json!({"raw":"пи ай эм", "cleaned":"пи ай эм"});
        let mut state = VocabularyState::default();
        let mut input = correction(&entry, false);
        input.source_fingerprint = "stale".into();
        assert!(save_correction(&mut state, input, &entry).is_err());
        let mut input = correction(&entry, false);
        input.source_variant = "".into();
        assert!(save_correction(&mut state, input, &entry).is_err());
        assert!(state.evidence.is_empty());
        assert!(source_text(&json!({"raw":"x","source":"file"})).is_none());
        assert!(source_text(&json!({"raw":"x","dictationTranslation":{"text":"y"}})).is_none());
    }
}
