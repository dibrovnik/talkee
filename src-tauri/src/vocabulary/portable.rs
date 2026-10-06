//! Portable vocabulary JSON: strict parsing, evidence-free export, a merge
//! preview against the current state and the atomic reviewed import.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::model::{
    self, match_key, Provenance, Term, TermCategory, TermScope, Variant, VocabularyState, MAX_TERMS,
};
use super::store::{new_id, now_ms, VocabularyError};

pub const PORTABLE_FORMAT: &str = "talkee-personal-vocabulary";
pub const PORTABLE_VERSION: u64 = 1;
pub const MAX_PORTABLE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableVariant {
    pub source: String,
    pub case_sensitive: bool,
    pub context_words: Vec<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableTerm {
    pub canonical: String,
    pub language: String,
    pub category: TermCategory,
    pub scope: TermScope,
    pub enabled: bool,
    pub use_as_hint: bool,
    pub variants: Vec<PortableVariant>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableDocument {
    pub format: String,
    pub version: u64,
    pub terms: Vec<PortableTerm>,
}

fn invalid(message: impl Into<String>) -> VocabularyError {
    VocabularyError::Validation(message.into())
}

fn identity(
    canonical: &str,
    language: &str,
    scope: &TermScope,
) -> (String, String, Option<String>) {
    (match_key(canonical), language.to_owned(), scope.key())
}

fn to_variant(variant: &PortableVariant, provenance: Provenance) -> Variant {
    Variant {
        id: new_id("variant"),
        source: variant.source.clone(),
        enabled: variant.enabled,
        case_sensitive: variant.case_sensitive,
        context_words: variant.context_words.clone(),
        provenance,
    }
}

fn to_term(term: &PortableTerm, variants: Vec<Variant>, provenance: Provenance) -> Term {
    let now = now_ms();
    Term {
        id: new_id("term"),
        canonical: term.canonical.clone(),
        language: term.language.clone(),
        category: term.category,
        scope: term.scope.clone(),
        enabled: term.enabled,
        use_as_hint: term.use_as_hint,
        provenance,
        variants,
        created_at: now,
        updated_at: now,
    }
}

/// Strict parse: size, format and version are checked before field-level
/// validation so the user sees the specific reason.
pub fn parse_portable(text: &str) -> Result<PortableDocument, VocabularyError> {
    if text.len() > MAX_PORTABLE_BYTES {
        return Err(invalid("Файл словаря больше 1 МиБ"));
    }
    let raw: Value = serde_json::from_str(text)
        .map_err(|_| invalid("Файл повреждён: это не корректный JSON"))?;
    if raw.get("format").and_then(Value::as_str) != Some(PORTABLE_FORMAT) {
        return Err(invalid("Это не файл словаря Talkee"));
    }
    match raw.get("version").and_then(Value::as_u64) {
        Some(PORTABLE_VERSION) => {}
        Some(version) => {
            return Err(invalid(format!(
                "Версия файла {version} не поддерживается этой версией Talkee"
            )))
        }
        None => return Err(invalid("В файле не указана версия")),
    }
    let document: PortableDocument = serde_json::from_value(raw)
        .map_err(|e| invalid(format!("Файл не соответствует формату словаря: {e}")))?;
    if document.terms.len() > MAX_TERMS {
        return Err(invalid(format!("В файле больше {MAX_TERMS} терминов")));
    }
    let mut seen = std::collections::HashSet::new();
    for term in &document.terms {
        let variants = term
            .variants
            .iter()
            .map(|variant| to_variant(variant, Provenance::Import))
            .collect();
        model::validate_term(&to_term(term, variants, Provenance::Import))
            .map_err(VocabularyError::Validation)?;
        if !seen.insert(identity(&term.canonical, &term.language, &term.scope)) {
            return Err(invalid(format!(
                "Термин «{}» повторяется в файле",
                term.canonical
            )));
        }
    }
    Ok(document)
}

/// Spellings, scopes and rules only: no evidence, suggestions, config or consent.
pub fn export_portable(state: &VocabularyState) -> PortableDocument {
    PortableDocument {
        format: PORTABLE_FORMAT.to_owned(),
        version: PORTABLE_VERSION,
        terms: state
            .terms
            .iter()
            .map(|term| PortableTerm {
                canonical: term.canonical.clone(),
                language: term.language.clone(),
                category: term.category,
                scope: term.scope.clone(),
                enabled: term.enabled,
                use_as_hint: term.use_as_hint,
                variants: term
                    .variants
                    .iter()
                    .map(|variant| PortableVariant {
                        source: variant.source.clone(),
                        case_sensitive: variant.case_sensitive,
                        context_words: variant.context_words.clone(),
                        enabled: variant.enabled,
                    })
                    .collect(),
            })
            .collect(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemStatus {
    New,
    Same,
    Conflict,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewVariant {
    pub index: usize,
    pub source: String,
    pub case_sensitive: bool,
    pub context_words: Vec<String>,
    pub enabled: bool,
    pub status: ItemStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTerm {
    pub index: usize,
    pub canonical: String,
    pub language: String,
    pub category: TermCategory,
    pub scope: TermScope,
    /// Set when the term already exists; its spelling and settings are kept.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_term_id: Option<String>,
    pub status: ItemStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict: Option<String>,
    pub variants: Vec<PreviewVariant>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub revision: u64,
    pub terms: Vec<PreviewTerm>,
}

fn same_rule(existing: &Variant, incoming: &PortableVariant) -> bool {
    let words = |list: &[String]| list.iter().map(|w| match_key(w)).collect::<Vec<_>>();
    existing.case_sensitive == incoming.case_sensitive
        && existing.enabled == incoming.enabled
        && words(&existing.context_words) == words(&incoming.context_words)
}

/// Classifies every incoming term and variant. Additions are trial-validated
/// cumulatively in file order, so a rule that only conflicts with an earlier
/// row of the same file (for example a cascade) is flagged as well.
pub fn preview_import(state: &VocabularyState, document: &PortableDocument) -> ImportPreview {
    let mut trial = state.terms.clone();
    let mut terms = Vec::with_capacity(document.terms.len());
    for (term_index, incoming) in document.terms.iter().enumerate() {
        let key = identity(&incoming.canonical, &incoming.language, &incoming.scope);
        let existing_position = trial.iter().position(|term| {
            identity(&term.canonical, &term.language, &term.scope) == key
                && state.terms.iter().any(|known| known.id == term.id)
        });
        let mut row = PreviewTerm {
            index: term_index,
            canonical: incoming.canonical.clone(),
            language: incoming.language.clone(),
            category: incoming.category,
            scope: incoming.scope.clone(),
            existing_term_id: existing_position.map(|position| trial[position].id.clone()),
            status: if existing_position.is_some() {
                ItemStatus::Same
            } else {
                ItemStatus::New
            },
            conflict: None,
            variants: Vec::new(),
        };
        let position = match existing_position {
            Some(position) => Some(position),
            None => {
                trial.push(to_term(incoming, Vec::new(), Provenance::Import));
                match model::validate_terms(&trial) {
                    Ok(()) => Some(trial.len() - 1),
                    Err(message) => {
                        trial.pop();
                        row.status = ItemStatus::Conflict;
                        row.conflict = Some(message);
                        None
                    }
                }
            }
        };
        for (variant_index, variant) in incoming.variants.iter().enumerate() {
            let mut item = PreviewVariant {
                index: variant_index,
                source: variant.source.clone(),
                case_sensitive: variant.case_sensitive,
                context_words: variant.context_words.clone(),
                enabled: variant.enabled,
                status: ItemStatus::New,
                conflict: None,
            };
            let Some(position) = position else {
                item.status = ItemStatus::Conflict;
                item.conflict = row.conflict.clone();
                row.variants.push(item);
                continue;
            };
            let matching = trial[position]
                .variants
                .iter()
                .find(|known| match_key(&known.source) == match_key(&variant.source));
            match matching {
                Some(known) if same_rule(known, variant) => item.status = ItemStatus::Same,
                Some(_) => {
                    item.status = ItemStatus::Conflict;
                    item.conflict = Some(format!(
                        "Вариант «{}» уже есть с другими настройками и не будет перезаписан",
                        variant.source
                    ));
                }
                None => {
                    trial[position]
                        .variants
                        .push(to_variant(variant, Provenance::Import));
                    if let Err(message) = model::validate_terms(&trial) {
                        trial[position].variants.pop();
                        item.status = ItemStatus::Conflict;
                        item.conflict = Some(message);
                    }
                }
            }
            row.variants.push(item);
        }
        terms.push(row);
    }
    ImportPreview {
        revision: state.revision,
        terms,
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportSelection {
    pub term_index: usize,
    #[serde(default)]
    pub include_term: bool,
    #[serde(default)]
    pub variant_indexes: Vec<usize>,
}

/// Applies only the selected new terms and additions. Existing spellings,
/// settings and rules are never overwritten; identical rows are no-ops.
/// Returns how many terms and variants were added.
pub fn apply_import(
    state: &mut VocabularyState,
    document: &PortableDocument,
    selection: &[ImportSelection],
    provenance: Provenance,
) -> Result<usize, VocabularyError> {
    let preview = preview_import(state, document);
    let mut added = 0;
    for choice in selection {
        let row = preview
            .terms
            .get(choice.term_index)
            .ok_or_else(|| invalid("Выбрана строка, которой нет в файле"))?;
        let incoming = &document.terms[choice.term_index];
        let mut variants = Vec::new();
        for &variant_index in &choice.variant_indexes {
            let item = row
                .variants
                .get(variant_index)
                .ok_or_else(|| invalid("Выбран вариант, которого нет в файле"))?;
            match item.status {
                ItemStatus::Same => {}
                ItemStatus::Conflict => {
                    return Err(invalid(item.conflict.clone().unwrap_or_else(|| {
                        format!("Вариант «{}» конфликтует", item.source)
                    })))
                }
                ItemStatus::New => {
                    variants.push(to_variant(&incoming.variants[variant_index], provenance))
                }
            }
        }
        match (&row.existing_term_id, row.status) {
            (_, ItemStatus::Conflict) if choice.include_term || !variants.is_empty() => {
                return Err(invalid(row.conflict.clone().unwrap_or_else(|| {
                    format!("Термин «{}» конфликтует", row.canonical)
                })))
            }
            (Some(id), _) => {
                if variants.is_empty() {
                    continue;
                }
                let term = state
                    .terms
                    .iter_mut()
                    .find(|term| &term.id == id)
                    .ok_or_else(|| invalid("Термин изменился, обновите просмотр"))?;
                added += variants.len();
                term.variants.extend(variants);
                term.updated_at = now_ms();
            }
            (None, _) => {
                if !choice.include_term {
                    if variants.is_empty() {
                        continue;
                    }
                    return Err(invalid(format!(
                        "Чтобы добавить варианты, выберите и сам термин «{}»",
                        row.canonical
                    )));
                }
                added += 1 + variants.len();
                state.terms.push(to_term(incoming, variants, provenance));
            }
        }
    }
    Ok(added)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vocabulary::model::tests::{term, variant};

    fn document(terms: Vec<PortableTerm>) -> PortableDocument {
        PortableDocument {
            format: PORTABLE_FORMAT.to_owned(),
            version: PORTABLE_VERSION,
            terms,
        }
    }

    fn portable(canonical: &str, domain: Option<&str>, sources: &[&str]) -> PortableTerm {
        PortableTerm {
            canonical: canonical.to_owned(),
            language: "any".to_owned(),
            category: TermCategory::Service,
            scope: match domain {
                Some(name) => TermScope::domain(name),
                None => TermScope::global(),
            },
            enabled: true,
            use_as_hint: true,
            variants: sources
                .iter()
                .map(|source| PortableVariant {
                    source: (*source).to_owned(),
                    case_sensitive: false,
                    context_words: Vec::new(),
                    enabled: true,
                })
                .collect(),
        }
    }

    fn text(document: &PortableDocument) -> String {
        serde_json::to_string(document).unwrap()
    }

    fn select_all(preview: &ImportPreview) -> Vec<ImportSelection> {
        preview
            .terms
            .iter()
            .map(|row| ImportSelection {
                term_index: row.index,
                include_term: row.status == ItemStatus::New,
                variant_indexes: row
                    .variants
                    .iter()
                    .filter(|item| item.status == ItemStatus::New)
                    .map(|item| item.index)
                    .collect(),
            })
            .collect()
    }

    #[test]
    fn rejects_bad_files_with_specific_reasons() {
        let too_big = "x".repeat(MAX_PORTABLE_BYTES + 1);
        assert!(parse_portable(&too_big)
            .unwrap_err()
            .to_string()
            .contains("1 МиБ"));
        assert!(parse_portable("{")
            .unwrap_err()
            .to_string()
            .contains("JSON"));
        let future = r#"{"format":"talkee-personal-vocabulary","version":2,"terms":[]}"#;
        assert!(parse_portable(future)
            .unwrap_err()
            .to_string()
            .contains("Версия файла 2"));
        let extra =
            r#"{"format":"talkee-personal-vocabulary","version":1,"terms":[],"evidence":[]}"#;
        assert!(parse_portable(extra)
            .unwrap_err()
            .to_string()
            .contains("формату"));
        let mut duplicate = document(vec![portable("PIM", None, &[]), portable("pim", None, &[])]);
        assert!(parse_portable(&text(&duplicate))
            .unwrap_err()
            .to_string()
            .contains("повторяется"));
        duplicate.terms[1] = portable("Dev", None, &["dev/prod"]);
        assert!(parse_portable(&text(&duplicate)).is_err());
    }

    #[test]
    fn export_contains_only_portable_fields() {
        let mut state: VocabularyState =
            serde_json::from_str(include_str!("fixtures/state-v1.json")).unwrap();
        state.config.enabled = true;
        let exported = serde_json::to_string(&export_portable(&state)).unwrap();
        for forbidden in [
            "evidence",
            "suggestion",
            "dismissal",
            "coverage",
            "consent",
            "Consent",
            "schedule",
            "history",
            "sourceId",
            "quote",
            "fingerprint",
            "endpoint",
            "model",
            "provenance",
            "\"id\"",
            "lastJob",
            "revision",
        ] {
            assert!(!exported.contains(forbidden), "export leaked {forbidden}");
        }
        assert!(parse_portable(&exported).is_ok());
    }

    #[test]
    fn export_then_import_into_empty_install_is_equivalent_and_stays_off() {
        let source: VocabularyState =
            serde_json::from_str(include_str!("fixtures/state-v1.json")).unwrap();
        let exported = text(&export_portable(&source));
        let parsed = parse_portable(&exported).unwrap();
        let mut empty = VocabularyState::default();
        let preview = preview_import(&empty, &parsed);
        assert!(preview
            .terms
            .iter()
            .all(|row| row.status == ItemStatus::New));
        apply_import(
            &mut empty,
            &parsed,
            &select_all(&preview),
            Provenance::Import,
        )
        .unwrap();
        model::validate_state(&empty).unwrap();
        assert_eq!(export_portable(&empty), export_portable(&source));
        assert!(!empty.config.enabled);
        assert!(empty.config.manual_api_consent.is_none());
        assert_eq!(empty.config.analysis_schedule, model::AnalysisSchedule::Off);
        assert!(empty
            .terms
            .iter()
            .all(|term| term.provenance == Provenance::Import));
    }

    #[test]
    fn reimport_is_idempotent_and_never_overwrites_manual_terms() {
        let mut state = VocabularyState::default();
        let mut manual = term(
            "pim",
            "PIM",
            TermScope::domain("Разработка"),
            vec![variant("a", "пим")],
        );
        manual.category = TermCategory::Product;
        state.terms.push(manual.clone());
        let incoming = document(vec![PortableTerm {
            category: TermCategory::Tool,
            enabled: false,
            ..portable("PIM", Some("Разработка"), &["пим", "пи ай эм"])
        }]);
        let preview = preview_import(&state, &incoming);
        assert_eq!(preview.terms[0].existing_term_id.as_deref(), Some("pim"));
        let statuses: Vec<_> = preview.terms[0].variants.iter().map(|v| v.status).collect();
        assert_eq!(statuses, vec![ItemStatus::Same, ItemStatus::New]);

        assert_eq!(
            apply_import(
                &mut state,
                &incoming,
                &select_all(&preview),
                Provenance::Starter
            )
            .unwrap(),
            1
        );
        let pim = &state.terms[0];
        assert_eq!(pim.category, TermCategory::Product);
        assert!(pim.enabled);
        assert_eq!(pim.variants[0], manual.variants[0]);
        assert_eq!(pim.variants[1].provenance, Provenance::Starter);

        let again = preview_import(&state, &incoming);
        assert!(again.terms[0]
            .variants
            .iter()
            .all(|v| v.status == ItemStatus::Same));
        let before = state.clone();
        assert_eq!(
            apply_import(
                &mut state,
                &incoming,
                &select_all(&again),
                Provenance::Import
            )
            .unwrap(),
            0
        );
        assert_eq!(state.terms, before.terms);
    }

    #[test]
    fn only_selected_rows_are_imported() {
        let mut state = VocabularyState::default();
        let incoming = document(vec![
            portable("PIM", Some("Разработка"), &["пим", "пи ай эм"]),
            portable("Dev", None, &["дев"]),
        ]);
        let selection = vec![ImportSelection {
            term_index: 0,
            include_term: true,
            variant_indexes: vec![1],
        }];
        apply_import(&mut state, &incoming, &selection, Provenance::Import).unwrap();
        assert_eq!(state.terms.len(), 1);
        let sources: Vec<_> = state.terms[0]
            .variants
            .iter()
            .map(|v| v.source.as_str())
            .collect();
        assert_eq!(sources, vec!["пи ай эм"]);

        let orphan = vec![ImportSelection {
            term_index: 1,
            include_term: false,
            variant_indexes: vec![0],
        }];
        let before = state.clone();
        assert!(apply_import(&mut state, &incoming, &orphan, Provenance::Import).is_err());
        assert_eq!(state.terms.len(), before.terms.len());
    }

    #[test]
    fn conflicts_and_cascades_are_flagged_and_refused() {
        let mut state = VocabularyState::default();
        state.terms.push(term(
            "pim",
            "PIM",
            TermScope::global(),
            vec![variant("a", "пим")],
        ));
        let incoming = document(vec![
            portable("Пимафуцин", None, &["пим"]),
            portable("Product", None, &["PIM"]),
        ]);
        let preview = preview_import(&state, &incoming);
        assert_eq!(preview.terms[0].variants[0].status, ItemStatus::Conflict);
        assert!(preview.terms[0].variants[0]
            .conflict
            .as_deref()
            .unwrap()
            .contains("PIM"));
        assert_eq!(preview.terms[1].variants[0].status, ItemStatus::Conflict);
        assert!(preview.terms[1].variants[0]
            .conflict
            .as_deref()
            .unwrap()
            .contains("Каскад"));

        let forced = vec![ImportSelection {
            term_index: 0,
            include_term: true,
            variant_indexes: vec![0],
        }];
        let before = state.clone();
        assert!(apply_import(&mut state, &incoming, &forced, Provenance::Import).is_err());
        assert_eq!(state, before);
    }

    #[test]
    fn starter_is_valid_and_repeated_runs_keep_a_manual_pim() {
        let starter = include_str!("fixtures/starter-development.json");
        let document = parse_portable(starter).unwrap();
        let empty = VocabularyState::default();
        let preview = preview_import(&empty, &document);
        assert!(preview
            .terms
            .iter()
            .all(|row| row.status == ItemStatus::New));
        assert!(preview
            .terms
            .iter()
            .flat_map(|row| &row.variants)
            .all(|item| item.status == ItemStatus::New));

        let mut state = VocabularyState::default();
        let mut manual = term(
            "manual-pim",
            "PIM",
            TermScope::domain("Разработка"),
            vec![variant("a", "пим")],
        );
        manual.use_as_hint = false;
        state.terms.push(manual.clone());
        let preview = preview_import(&state, &document);
        let pim = &preview.terms[0];
        assert_eq!(pim.existing_term_id.as_deref(), Some("manual-pim"));
        apply_import(
            &mut state,
            &document,
            &select_all(&preview),
            Provenance::Starter,
        )
        .unwrap();
        let kept = state.terms.iter().find(|t| t.id == "manual-pim").unwrap();
        assert_eq!(kept.canonical, manual.canonical);
        assert!(!kept.use_as_hint);
        assert_eq!(kept.variants[0], manual.variants[0]);
        assert!(!state.config.enabled);
    }

    #[test]
    fn changed_settings_of_an_existing_rule_are_a_conflict_not_an_overwrite() {
        let mut state = VocabularyState::default();
        state.terms.push(term(
            "prod",
            "Prod",
            TermScope::global(),
            vec![variant("a", "прод")],
        ));
        let mut incoming = portable("Prod", None, &["прод"]);
        incoming.variants[0].context_words = vec!["деплой".to_owned()];
        let preview = preview_import(&state, &document(vec![incoming]));
        assert_eq!(preview.terms[0].variants[0].status, ItemStatus::Conflict);
    }
}
