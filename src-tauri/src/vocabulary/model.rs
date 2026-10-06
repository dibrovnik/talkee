//! Personal vocabulary contract v1 (mirrored by `src/lib/vocabulary.ts`) and the
//! whole-state validation that every durable mutation must pass.

use std::collections::{HashMap, HashSet};

use objc2_foundation::NSString;
use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_TERMS: usize = 1000;
pub const MAX_VARIANTS_PER_TERM: usize = 20;
pub const MAX_SUGGESTIONS: usize = 500;
pub const MAX_EVIDENCE: usize = 1000;
pub const MAX_DISMISSALS: usize = 2000;
pub const MAX_COVERAGE: usize = 2000;
pub const MAX_QUOTE_CHARS: usize = 300;
pub const MAX_CONTEXT_WORDS: usize = 5;
pub const MAX_TEXT_CHARS: usize = 64;
pub const MIN_VARIANT_CHARS: usize = 2;
pub const MAX_STATE_BYTES: usize = 5 * 1024 * 1024;
/// Longest target sub-phrase checked against other sources for cascades.
const MAX_CASCADE_TOKENS: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TermCategory {
    Acronym,
    Service,
    Environment,
    Tool,
    Product,
    Person,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Provenance {
    Manual,
    Starter,
    Import,
    HumanCorrection,
    HistoryAnalysis,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EvidenceOrigin {
    HumanCorrection,
    CleanupDiff,
    SttHypothesis,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SuggestionStatus {
    Collecting,
    Ready,
    Approved,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnalysisSchedule {
    #[default]
    Off,
    Daily,
    Weekly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobMode {
    Full,
    New,
    Resume,
    Periodic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobStatus {
    Idle,
    Preparing,
    Running,
    Completed,
    Paused,
    Cancelled,
    Failed,
    NeedsAttention,
}

/// Exactly one of `{"global": true}` or `{"domain": "…"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TermScope {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub global: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
}

impl TermScope {
    #[cfg(test)]
    pub fn global() -> Self {
        Self {
            global: Some(true),
            domain: None,
        }
    }

    #[cfg(test)]
    pub fn domain(name: &str) -> Self {
        Self {
            global: None,
            domain: Some(name.to_owned()),
        }
    }

    /// Comparison key: `None` for global, the folded domain name otherwise.
    pub fn key(&self) -> Option<String> {
        self.domain.as_deref().map(match_key)
    }

    fn compatible_with(&self, other: &TermScope) -> bool {
        match (self.key(), other.key()) {
            (Some(a), Some(b)) => a == b,
            _ => true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Variant {
    pub id: String,
    pub source: String,
    pub enabled: bool,
    pub case_sensitive: bool,
    pub context_words: Vec<String>,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Term {
    pub id: String,
    pub canonical: String,
    pub language: String,
    pub category: TermCategory,
    pub scope: TermScope,
    pub enabled: bool,
    pub use_as_hint: bool,
    pub provenance: Provenance,
    pub variants: Vec<Variant>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SuggestionVariant {
    pub source: String,
    pub case_sensitive: bool,
    pub context_words: Vec<String>,
    pub selected: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Suggestion {
    pub id: String,
    pub canonical: String,
    pub language: String,
    pub category: TermCategory,
    pub scope: TermScope,
    pub variants: Vec<SuggestionVariant>,
    pub status: SuggestionStatus,
    pub origin: EvidenceOrigin,
    pub source_count: u32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence {
    pub id: String,
    pub suggestion_id: String,
    pub origin: EvidenceOrigin,
    pub source_id: String,
    pub source_fingerprint: String,
    pub quote: String,
    pub source_variant: String,
    pub range_start: u32,
    pub range_end: u32,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Dismissal {
    pub key: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Coverage {
    pub source_id: String,
    pub fingerprint: String,
    /// Processed `[start, end)` character ranges of this source version.
    pub ranges: Vec<[u32; 2]>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobRecord {
    pub mode: JobMode,
    pub status: JobStatus,
    pub backend_fingerprint: Option<String>,
    pub requests: u32,
    pub processed_sources: u32,
    pub remaining_sources: u32,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiConsent {
    /// Local hash of backend kind + normalized endpoint + model; never the key.
    pub fingerprint: String,
    pub endpoint_label: String,
    pub model: String,
    pub granted_at: i64,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VocabularyConfig {
    pub enabled: bool,
    pub active_domain: Option<String>,
    pub analysis_schedule: AnalysisSchedule,
    pub last_scheduled_attempt_at: Option<i64>,
    /// History created before this moment is only analyzed by an explicit full run.
    pub learning_cleared_at: Option<i64>,
    pub manual_api_consent: Option<ApiConsent>,
    pub periodic_api_consent: Option<ApiConsent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VocabularyState {
    pub schema_version: u32,
    /// Bumped by every durable mutation (CAS token).
    pub revision: u64,
    /// Bumped only when the applied lexicon (terms, domain, enabled) changes.
    pub lexicon_revision: u64,
    /// Bumped by learning resets; invalidates in-flight analysis.
    pub data_epoch: u64,
    pub config: VocabularyConfig,
    pub terms: Vec<Term>,
    pub suggestions: Vec<Suggestion>,
    pub evidence: Vec<Evidence>,
    pub dismissals: Vec<Dismissal>,
    pub coverage: Vec<Coverage>,
    pub last_job: Option<JobRecord>,
}

impl Default for VocabularyState {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            revision: 0,
            lexicon_revision: 0,
            data_epoch: 0,
            config: VocabularyConfig::default(),
            terms: Vec::new(),
            suggestions: Vec::new(),
            evidence: Vec::new(),
            dismissals: Vec::new(),
            coverage: Vec::new(),
            last_job: None,
        }
    }
}

impl VocabularyState {
    /// The part of the state that changes dictation output.
    pub fn lexicon_fingerprint(&self) -> String {
        serde_json::to_string(&(
            &self.config.enabled,
            &self.config.active_domain,
            &self.terms,
        ))
        .unwrap_or_default()
    }
}

/// NFC without touching letter case; used for exact (case-sensitive) comparison.
pub fn nfc(value: &str) -> String {
    if value.is_ascii() {
        return value.to_owned();
    }
    NSString::from_str(value)
        .precomposedStringWithCanonicalMapping()
        .to_string()
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Case-folded comparison key, recomputed locally and never trusted from input.
pub fn match_key(value: &str) -> String {
    collapse_whitespace(&nfc(value).to_lowercase())
}

fn exact_key(value: &str) -> String {
    collapse_whitespace(&nfc(value))
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

fn word_tokens(value: &str) -> Vec<&str> {
    value
        .split(|c: char| !is_word_char(c))
        .filter(|token| !token.is_empty())
        .collect()
}

fn char_count(value: &str) -> usize {
    value.chars().count()
}

fn invalid(message: impl Into<String>) -> String {
    message.into()
}

fn validate_text(label: &str, value: &str, min: usize, max: usize) -> Result<(), String> {
    if value.trim() != value {
        return Err(invalid(format!("{label}: уберите пробелы по краям")));
    }
    let count = char_count(value);
    if count < min || count > max {
        return Err(invalid(format!("{label}: от {min} до {max} символов")));
    }
    if value
        .chars()
        .any(|c| c.is_control() || c == '\u{2028}' || c == '\u{2029}')
    {
        return Err(invalid(format!(
            "{label}: управляющие символы и переносы строк недопустимы"
        )));
    }
    if value.contains("<|") || value.contains("|>") {
        return Err(invalid(format!("{label}: служебные токены недопустимы")));
    }
    Ok(())
}

fn validate_id(label: &str, value: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'));
    if valid {
        Ok(())
    } else {
        Err(invalid(format!("{label}: некорректный идентификатор")))
    }
}

pub fn validate_language(value: &str) -> Result<(), String> {
    if value == "any" {
        return Ok(());
    }
    let mut parts = value.splitn(2, '-');
    let primary = parts.next().unwrap_or_default();
    let primary_ok =
        (2..=3).contains(&primary.len()) && primary.chars().all(|c| c.is_ascii_lowercase());
    let region_ok = parts.next().is_none_or(|region| {
        (2..=8).contains(&region.len()) && region.chars().all(|c| c.is_ascii_alphanumeric())
    });
    if primary_ok && region_ok {
        Ok(())
    } else {
        Err(invalid("Язык: укажите «any» или код языка"))
    }
}

pub fn validate_domain(value: &str) -> Result<(), String> {
    validate_text("Область", value, 1, MAX_TEXT_CHARS)
}

fn validate_scope(scope: &TermScope) -> Result<(), String> {
    match (&scope.global, &scope.domain) {
        (Some(true), None) => Ok(()),
        (None, Some(domain)) => validate_domain(domain),
        _ => Err(invalid(
            "Область: укажите либо общий словарь, либо одну область",
        )),
    }
}

/// URL, path and code fragments are never replaceable aliases.
fn looks_technical(value: &str) -> bool {
    const TECHNICAL: &[char] = &[
        '/', '\\', '`', '@', '_', '{', '}', '<', '>', '=', '|', '#', '$', '%', '^', '*', '~', '[',
        ']',
    ];
    let lower = value.to_lowercase();
    value.contains(TECHNICAL) || lower.contains("://") || lower.starts_with("www.")
}

fn validate_context_words(words: &[String]) -> Result<(), String> {
    if words.len() > MAX_CONTEXT_WORDS {
        return Err(invalid(format!(
            "Контекст: не больше {MAX_CONTEXT_WORDS} слов"
        )));
    }
    let mut seen = HashSet::new();
    for word in words {
        validate_text("Слово контекста", word, 1, MAX_TEXT_CHARS)?;
        if word.chars().any(|c| !is_word_char(c)) {
            return Err(invalid("Слово контекста: только одно целое слово"));
        }
        if !seen.insert(match_key(word)) {
            return Err(invalid("Контекст: слова повторяются"));
        }
    }
    Ok(())
}

pub fn validate_variant(canonical: &str, variant: &Variant) -> Result<(), String> {
    validate_id("Вариант", &variant.id)?;
    validate_text(
        "Вариант замены",
        &variant.source,
        MIN_VARIANT_CHARS,
        MAX_TEXT_CHARS,
    )?;
    if !variant.source.chars().any(char::is_alphabetic) {
        return Err(invalid("Вариант замены: нужна хотя бы одна буква"));
    }
    if looks_technical(&variant.source) {
        return Err(invalid(
            "Вариант замены: адреса, пути и фрагменты кода не заменяются",
        ));
    }
    if exact_key(&variant.source) == exact_key(canonical) {
        return Err(invalid("Вариант замены совпадает с написанием"));
    }
    if match_key(&variant.source) == match_key(canonical) && !variant.case_sensitive {
        return Err(invalid(
            "Вариант, отличающийся только регистром, должен учитывать регистр",
        ));
    }
    validate_context_words(&variant.context_words)
}

pub fn validate_term(term: &Term) -> Result<(), String> {
    validate_id("Термин", &term.id)?;
    validate_text("Написание", &term.canonical, 1, MAX_TEXT_CHARS)?;
    validate_language(&term.language)?;
    validate_scope(&term.scope)?;
    if term.variants.len() > MAX_VARIANTS_PER_TERM {
        return Err(invalid(format!(
            "«{}»: не больше {MAX_VARIANTS_PER_TERM} вариантов",
            term.canonical
        )));
    }
    let mut ids = HashSet::new();
    let mut sources = HashSet::new();
    for variant in &term.variants {
        validate_variant(&term.canonical, variant)?;
        if !ids.insert(variant.id.as_str()) {
            return Err(invalid("Вариант: повторяющийся идентификатор"));
        }
        let key = if variant.case_sensitive {
            exact_key(&variant.source)
        } else {
            match_key(&variant.source)
        };
        if !sources.insert(key) {
            return Err(invalid(format!(
                "«{}»: вариант «{}» повторяется",
                term.canonical, variant.source
            )));
        }
    }
    Ok(())
}

struct ActiveRule<'a> {
    term: &'a Term,
    variant: &'a Variant,
}

impl ActiveRule<'_> {
    /// Whether this rule's source matches `phrase` under its own case policy.
    fn source_matches(&self, phrase_exact: &str) -> bool {
        if self.variant.case_sensitive {
            exact_key(&self.variant.source) == phrase_exact
        } else {
            match_key(&self.variant.source) == phrase_exact.to_lowercase()
        }
    }

    fn sources_overlap(&self, other: &ActiveRule) -> bool {
        if self.variant.case_sensitive && other.variant.case_sensitive {
            exact_key(&self.variant.source) == exact_key(&other.variant.source)
        } else {
            match_key(&self.variant.source) == match_key(&other.variant.source)
        }
    }

    fn compatible_with(&self, other: &ActiveRule) -> bool {
        // Auto language makes every language of the selected scope co-active,
        // so language never separates two rules.
        self.term.scope.compatible_with(&other.term.scope)
    }

    fn same_target(&self, other: &ActiveRule) -> bool {
        nfc(&self.term.canonical) == nfc(&other.term.canonical)
    }
}

fn describe_scope(scope: &TermScope) -> String {
    match &scope.domain {
        Some(domain) => format!("область «{domain}»"),
        None => "общий словарь".to_owned(),
    }
}

/// Rejects co-active rules that send one source to different targets, and
/// targets that another co-active rule would rewrite again.
pub fn validate_rule_conflicts(terms: &[Term]) -> Result<(), String> {
    let rules: Vec<ActiveRule> = terms
        .iter()
        .filter(|term| term.enabled)
        .flat_map(|term| {
            term.variants
                .iter()
                .filter(|variant| variant.enabled)
                .map(move |variant| ActiveRule { term, variant })
        })
        .collect();

    let mut by_source: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, rule) in rules.iter().enumerate() {
        by_source
            .entry(match_key(&rule.variant.source))
            .or_default()
            .push(index);
    }

    for bucket in by_source.values() {
        for (i, &a) in bucket.iter().enumerate() {
            for &b in &bucket[i + 1..] {
                let (left, right) = (&rules[a], &rules[b]);
                if left.sources_overlap(right)
                    && left.compatible_with(right)
                    && !left.same_target(right)
                {
                    return Err(invalid(format!(
                        "Конфликт: «{}» уже заменяется на «{}» ({}), нельзя одновременно заменять на «{}»",
                        left.variant.source,
                        left.term.canonical,
                        describe_scope(&left.term.scope),
                        right.term.canonical
                    )));
                }
            }
        }
    }

    for rule in &rules {
        let tokens = word_tokens(&rule.term.canonical);
        for start in 0..tokens.len() {
            for end in start + 1..=tokens.len().min(start + MAX_CASCADE_TOKENS) {
                let phrase = exact_key(&tokens[start..end].join(" "));
                let Some(bucket) = by_source.get(&phrase.to_lowercase()) else {
                    continue;
                };
                for &other_index in bucket {
                    let other = &rules[other_index];
                    if other.source_matches(&phrase)
                        && other.compatible_with(rule)
                        && !other.same_target(rule)
                    {
                        return Err(invalid(format!(
                            "Каскад: результат «{}» снова заменился бы правилом «{}» → «{}»",
                            rule.term.canonical, other.variant.source, other.term.canonical
                        )));
                    }
                }
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_terms(terms: &[Term]) -> Result<(), String> {
    if terms.len() > MAX_TERMS {
        return Err(invalid(format!(
            "Достигнут предел {MAX_TERMS} терминов: удалите или экспортируйте лишние"
        )));
    }
    let mut ids = HashSet::new();
    let mut identities = HashSet::new();
    let mut variant_ids = HashSet::new();
    for term in terms {
        validate_term(term)?;
        if !ids.insert(term.id.as_str()) {
            return Err(invalid("Термин: повторяющийся идентификатор"));
        }
        let identity = (
            match_key(&term.canonical),
            term.language.clone(),
            term.scope.key(),
        );
        if !identities.insert(identity) {
            return Err(invalid(format!(
                "Термин «{}» уже есть в этой области",
                term.canonical
            )));
        }
        for variant in &term.variants {
            if !variant_ids.insert(variant.id.as_str()) {
                return Err(invalid("Вариант: повторяющийся идентификатор"));
            }
        }
    }
    validate_rule_conflicts(terms)
}

fn validate_learning(state: &VocabularyState) -> Result<(), String> {
    if state.suggestions.len() > MAX_SUGGESTIONS {
        return Err(invalid(format!(
            "Достигнут предел {MAX_SUGGESTIONS} предложений"
        )));
    }
    if state.evidence.len() > MAX_EVIDENCE {
        return Err(invalid(format!("Достигнут предел {MAX_EVIDENCE} примеров")));
    }
    if state.dismissals.len() > MAX_DISMISSALS {
        return Err(invalid(format!(
            "Достигнут предел {MAX_DISMISSALS} отклонений"
        )));
    }
    if state.coverage.len() > MAX_COVERAGE {
        return Err(invalid("Слишком много записей прогресса анализа"));
    }
    let mut suggestion_ids = HashSet::new();
    for suggestion in &state.suggestions {
        validate_id("Предложение", &suggestion.id)?;
        if !suggestion_ids.insert(suggestion.id.as_str()) {
            return Err(invalid("Предложение: повторяющийся идентификатор"));
        }
        validate_text("Написание", &suggestion.canonical, 1, MAX_TEXT_CHARS)?;
        validate_language(&suggestion.language)?;
        validate_scope(&suggestion.scope)?;
        if suggestion.variants.len() > MAX_VARIANTS_PER_TERM {
            return Err(invalid("Предложение: слишком много вариантов"));
        }
        for variant in &suggestion.variants {
            validate_text(
                "Вариант замены",
                &variant.source,
                MIN_VARIANT_CHARS,
                MAX_TEXT_CHARS,
            )?;
            validate_context_words(&variant.context_words)?;
        }
    }
    let mut evidence_ids = HashSet::new();
    for item in &state.evidence {
        validate_id("Пример", &item.id)?;
        if !evidence_ids.insert(item.id.as_str()) {
            return Err(invalid("Пример: повторяющийся идентификатор"));
        }
        if !suggestion_ids.contains(item.suggestion_id.as_str()) {
            return Err(invalid("Пример ссылается на отсутствующее предложение"));
        }
        validate_text("Источник", &item.source_id, 1, 128)?;
        if char_count(&item.quote) > MAX_QUOTE_CHARS || item.quote.trim().is_empty() {
            return Err(invalid(format!(
                "Цитата: от 1 до {MAX_QUOTE_CHARS} символов"
            )));
        }
        if item.range_end < item.range_start {
            return Err(invalid("Пример: некорректный диапазон"));
        }
    }
    for coverage in &state.coverage {
        if coverage.ranges.iter().any(|[start, end]| end < start) {
            return Err(invalid("Прогресс анализа: некорректный диапазон"));
        }
    }
    Ok(())
}

/// Full validation of a candidate state before it can be persisted.
pub fn validate_state(state: &VocabularyState) -> Result<(), String> {
    if state.schema_version != SCHEMA_VERSION {
        return Err(invalid(format!(
            "Неподдерживаемая версия словаря: {}",
            state.schema_version
        )));
    }
    if let Some(domain) = &state.config.active_domain {
        validate_domain(domain)?;
    }
    validate_terms(&state.terms)?;
    validate_learning(state)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn variant(id: &str, source: &str) -> Variant {
        Variant {
            id: id.to_owned(),
            source: source.to_owned(),
            enabled: true,
            case_sensitive: false,
            context_words: Vec::new(),
            provenance: Provenance::Manual,
        }
    }

    pub(crate) fn term(
        id: &str,
        canonical: &str,
        scope: TermScope,
        variants: Vec<Variant>,
    ) -> Term {
        Term {
            id: id.to_owned(),
            canonical: canonical.to_owned(),
            language: "any".to_owned(),
            category: TermCategory::Service,
            scope,
            enabled: true,
            use_as_hint: true,
            provenance: Provenance::Manual,
            variants,
            created_at: 1,
            updated_at: 1,
        }
    }

    fn state_with(terms: Vec<Term>) -> VocabularyState {
        VocabularyState {
            terms,
            ..VocabularyState::default()
        }
    }

    #[test]
    fn defaults_keep_application_and_schedule_off() {
        let state = VocabularyState::default();
        assert!(!state.config.enabled);
        assert_eq!(state.config.analysis_schedule, AnalysisSchedule::Off);
        assert_eq!(state.config.active_domain, None);
        assert!(validate_state(&state).is_ok());
    }

    #[test]
    fn contract_fixture_round_trips_unchanged() {
        let raw = include_str!("fixtures/state-v1.json");
        let expected: serde_json::Value = serde_json::from_str(raw).unwrap();
        let state: VocabularyState = serde_json::from_value(expected.clone()).unwrap();
        assert!(validate_state(&state).is_ok());
        assert_eq!(serde_json::to_value(&state).unwrap(), expected);
    }

    #[test]
    fn rejects_global_and_domain_collision() {
        let state = state_with(vec![
            term("t1", "PIM", TermScope::global(), vec![variant("v1", "пим")]),
            term(
                "t2",
                "Пимс",
                TermScope::domain("Разработка"),
                vec![variant("v2", "пим")],
            ),
        ]);
        let error = validate_state(&state).unwrap_err();
        assert!(error.contains("Конфликт"), "{error}");
        assert!(error.contains("PIM"), "{error}");
    }

    #[test]
    fn separate_domains_may_reuse_a_source() {
        let state = state_with(vec![
            term(
                "t1",
                "PIM",
                TermScope::domain("Разработка"),
                vec![variant("v1", "пим")],
            ),
            term(
                "t2",
                "Пимафуцин",
                TermScope::domain("Медицина"),
                vec![variant("v2", "пим")],
            ),
        ]);
        assert!(validate_state(&state).is_ok());
    }

    #[test]
    fn rejects_collision_across_languages_because_auto_language_is_co_active() {
        let mut ru = term("t1", "PIM", TermScope::global(), vec![variant("v1", "пим")]);
        ru.language = "ru".to_owned();
        let mut en = term("t2", "Pym", TermScope::global(), vec![variant("v2", "пим")]);
        en.language = "en".to_owned();
        assert!(validate_state(&state_with(vec![ru, en])).is_err());
    }

    #[test]
    fn rejects_cascade_through_target() {
        let state = state_with(vec![
            term("t1", "PIM", TermScope::global(), vec![variant("v1", "пим")]),
            term(
                "t2",
                "Product Info",
                TermScope::global(),
                vec![variant("v2", "pim")],
            ),
        ]);
        let error = validate_state(&state).unwrap_err();
        assert!(error.contains("Каскад"), "{error}");
    }

    #[test]
    fn disabled_rules_do_not_conflict() {
        let mut second = term(
            "t2",
            "Пимс",
            TermScope::global(),
            vec![variant("v2", "пим")],
        );
        second.variants[0].enabled = false;
        let state = state_with(vec![
            term("t1", "PIM", TermScope::global(), vec![variant("v1", "пим")]),
            second,
        ]);
        assert!(validate_state(&state).is_ok());
    }

    #[test]
    fn rejects_control_characters_and_service_tokens() {
        let bad = term("t1", "PI\u{0007}M", TermScope::global(), vec![]);
        assert!(validate_state(&state_with(vec![bad])).is_err());
        let token = term("t1", "<|endoftext|>", TermScope::global(), vec![]);
        assert!(validate_state(&state_with(vec![token])).is_err());
        let newline = term(
            "t1",
            "PIM",
            TermScope::global(),
            vec![variant("v1", "пи\nм")],
        );
        assert!(validate_state(&state_with(vec![newline])).is_err());
    }

    #[test]
    fn rejects_url_path_and_code_aliases() {
        for source in [
            "https://pim.dev",
            "src/pim",
            "pim_service",
            "`pim`",
            "a@b.ru",
        ] {
            let bad = term(
                "t1",
                "PIM",
                TermScope::global(),
                vec![variant("v1", source)],
            );
            assert!(
                validate_state(&state_with(vec![bad])).is_err(),
                "{source} must be rejected"
            );
        }
    }

    #[test]
    fn case_only_rule_requires_case_sensitivity() {
        let insensitive = term("t1", "PIM", TermScope::global(), vec![variant("v1", "pim")]);
        assert!(validate_state(&state_with(vec![insensitive])).is_err());

        let mut sensitive = variant("v1", "pim");
        sensitive.case_sensitive = true;
        let ok = term("t1", "PIM", TermScope::global(), vec![sensitive]);
        assert!(validate_state(&state_with(vec![ok])).is_ok());

        let mut identical = variant("v1", "PIM");
        identical.case_sensitive = true;
        let same = term("t1", "PIM", TermScope::global(), vec![identical]);
        assert!(validate_state(&state_with(vec![same])).is_err());
    }

    #[test]
    fn keys_fold_unicode_composition_and_case() {
        assert_eq!(match_key("Е\u{0308}ж"), match_key("ёж"));
        assert_eq!(match_key("  Пи   Ай  "), "пи ай");
        let duplicate = state_with(vec![
            term("t1", "Ёж", TermScope::global(), vec![]),
            term("t2", "Е\u{0308}ж", TermScope::global(), vec![]),
        ]);
        assert!(validate_state(&duplicate).is_err());
    }

    #[test]
    fn enforces_term_and_variant_limits() {
        let terms: Vec<Term> = (0..=MAX_TERMS)
            .map(|index| {
                term(
                    &format!("t{index}"),
                    &format!("T{index}"),
                    TermScope::global(),
                    vec![],
                )
            })
            .collect();
        let error = validate_state(&state_with(terms)).unwrap_err();
        assert!(error.contains("предел"), "{error}");

        let variants: Vec<Variant> = (0..=MAX_VARIANTS_PER_TERM)
            .map(|index| variant(&format!("v{index}"), &format!("вариант{index}")))
            .collect();
        let many = term("t1", "PIM", TermScope::global(), variants);
        assert!(validate_state(&state_with(vec![many])).is_err());
    }

    #[test]
    fn scope_requires_exactly_one_field() {
        let both = TermScope {
            global: Some(true),
            domain: Some("Dev".to_owned()),
        };
        assert!(validate_state(&state_with(vec![term("t1", "PIM", both, vec![])])).is_err());
        let none = TermScope {
            global: None,
            domain: None,
        };
        assert!(validate_state(&state_with(vec![term("t1", "PIM", none, vec![])])).is_err());
    }
}
