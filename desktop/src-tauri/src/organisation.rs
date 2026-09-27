//! Explicit label aliases and ordered reading plans; no inferred author merges.
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Default, Debug, Serialize, Deserialize)]
pub struct Organisation {
    pub authors: BTreeMap<String, String>,
    pub topics: BTreeMap<String, String>,
    pub roadmaps: Vec<Roadmap>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Roadmap {
    pub id: String,
    pub title: String,
    pub description: String,
    pub steps: Vec<Step>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Step {
    pub profile_id: String,
    pub note: String,
}

pub fn key(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub fn label(value: &str, aliases: &BTreeMap<String, String>) -> Result<String> {
    let mut current = value.trim().to_owned();
    let mut seen = HashSet::new();
    while let Some(next) = aliases.get(&key(&current)) {
        if key(next) == key(&current) {
            return Ok(next.clone()); // A preferred spelling/capitalization.
        }
        ensure!(seen.insert(key(&current)), "label aliases contain a cycle");
        current = next.clone();
    }
    Ok(current)
}

pub fn topics(value: Option<&str>, aliases: &BTreeMap<String, String>) -> Result<Option<String>> {
    let mut seen = HashSet::new();
    let mut labels = Vec::new();
    for topic in value
        .unwrap_or("")
        .split(',')
        .filter(|s| !s.trim().is_empty())
    {
        let canonical = label(topic, aliases)?;
        if seen.insert(key(&canonical)) {
            labels.push(canonical);
        }
    }
    Ok((!labels.is_empty()).then(|| labels.join(", ")))
}

pub fn validate(value: &Organisation) -> Result<()> {
    for aliases in [&value.authors, &value.topics] {
        ensure!(aliases.len() <= 10000, "too many label aliases");
        for (from, to) in aliases {
            ensure!(
                !from.is_empty()
                    && from == &key(from)
                    && from.len() <= 500
                    && !to.trim().is_empty()
                    && to.len() <= 500,
                "labels must be nonempty and at most 500 bytes"
            );
            label(from, aliases)?;
        }
    }
    for (from, to) in &value.topics {
        ensure!(
            !from.contains(',') && !to.contains(','),
            "enter one topic per alias"
        );
    }
    ensure!(value.roadmaps.len() <= 200, "too many roadmaps");
    let mut ids = HashSet::new();
    for roadmap in &value.roadmaps {
        ensure!(
            !roadmap.id.is_empty() && roadmap.id.len() <= 100 && ids.insert(&roadmap.id),
            "duplicate or invalid roadmap ID"
        );
        ensure!(
            !roadmap.title.trim().is_empty()
                && roadmap.title.len() <= 500
                && roadmap.description.len() <= 10000,
            "enter a roadmap title (up to 500 bytes)"
        );
        ensure!(roadmap.steps.len() <= 1000, "too many roadmap steps");
        let mut profiles = HashSet::new();
        for step in &roadmap.steps {
            ensure!(
                !step.profile_id.is_empty()
                    && step.profile_id.len() <= 100
                    && profiles.insert(&step.profile_id)
                    && step.note.len() <= 10000,
                "duplicate or invalid roadmap step"
            );
        }
    }
    Ok(())
}
