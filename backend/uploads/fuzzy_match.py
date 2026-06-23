"""Confidence-scored fuzzy matching for the legacy / non-SESIGO importer.

The SESIGO reporting workbook maps every numeric cell to an ``indicator_id`` via
its hidden ``_cellmap`` sheet and NEVER uses this module — that path stays
deterministic. Legacy partner workbooks carry no machine sheet, so the importer
must resolve **organizations from sheet names** and **indicators from row labels**
by name similarity. Silent best-guess matching is the core mis-mapping risk.

This module makes every such match carry an explicit **confidence score** and
**refuses** (returns no match) when:

  * the best candidate scores below ``accept_threshold`` (low confidence), or
  * a different runner-up scores within ``ambiguity_margin`` of the winner
    (ambiguous — two organizations / indicators look equally plausible).

A refused match is reported, never written: the importer treats it like an
unresolved row, so the user must supply an explicit override (their confirmation)
before any aggregate is written. This is what prevents a wrong organization or
wrong indicator mapping from happening silently.

Everything here is pure and dependency-free so it is trivially unit-testable.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# Conservative defaults. Below ACCEPT_THRESHOLD → unresolved; a different
# runner-up within AMBIGUITY_MARGIN of the winner → ambiguous (also unresolved).
ACCEPT_THRESHOLD = 0.60
AMBIGUITY_MARGIN = 0.10

# Tokens that carry no discriminating signal for org/indicator names.
_STOPWORDS = {
    "the", "of", "for", "and", "org", "organization", "organisation",
    "a", "an", "to", "in", "by", "with",
}


def normalize(value) -> str:
    """Lower-case, strip punctuation, collapse whitespace."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())).strip()


def tokens(value) -> set[str]:
    return {t for t in normalize(value).split() if t and t not in _STOPWORDS}


def similarity(a, b) -> float:
    """Return a 0..1 similarity between two labels.

    ``1.0`` only for an exact normalized match. Otherwise a blend of token
    Jaccard overlap and small-set coverage, with a containment floor. Purely
    deterministic — no randomness, no external libraries.
    """
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0

    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        # Everything was a stopword/number — fall back to raw containment.
        return 0.85 if (na in nb or nb in na) else 0.0

    inter = len(ta & tb)
    if inter == 0:
        return 0.0
    union = len(ta | tb)
    jaccard = inter / union if union else 0.0
    coverage = inter / min(len(ta), len(tb))  # how much of the smaller set is covered
    score = 0.5 * jaccard + 0.5 * coverage
    if na in nb or nb in na:
        score = max(score, 0.8)  # strong (but not exact) containment
    return round(min(score, 0.999), 4)


@dataclass
class Candidate:
    obj: object
    label: str
    score: float


@dataclass
class MatchResult:
    """Outcome of a confidence-scored match.

    ``reason`` is one of: ``exact``, ``matched``, ``low_confidence``,
    ``ambiguous``, ``no_candidates``. A match is only *resolved* (safe to write)
    when ``matched`` is not ``None``.
    """

    matched: object | None
    confidence: float
    ambiguous: bool
    reason: str
    candidates: list[Candidate] = field(default_factory=list)

    @property
    def resolved(self) -> bool:
        return self.matched is not None

    def alternatives(self, n: int = 3) -> list[dict]:
        return [{"label": c.label, "score": c.score} for c in self.candidates[:n]]

    def as_report(self, n: int = 3) -> dict:
        return {
            "resolved": self.resolved,
            "reason": self.reason,
            "confidence": round(self.confidence, 4),
            "ambiguous": self.ambiguous,
            "candidates": self.alternatives(n),
        }


def best_match(query, choices, *, label_of, accept_threshold: float = ACCEPT_THRESHOLD,
               ambiguity_margin: float = AMBIGUITY_MARGIN) -> MatchResult:
    """Score ``query`` against ``choices`` and decide whether it is safe to match.

    ``label_of(choice)`` yields the comparable label for a choice. Returns a
    :class:`MatchResult`; ``matched`` is ``None`` for low-confidence, ambiguous,
    or no-candidate cases (the caller must NOT write those).
    """
    scored: list[Candidate] = []
    for choice in choices:
        label = label_of(choice)
        s = similarity(query, label)
        if s > 0:
            scored.append(Candidate(obj=choice, label=label, score=s))
    scored.sort(key=lambda c: (-c.score, str(c.label).lower()))

    if not scored:
        return MatchResult(None, 0.0, False, "no_candidates", [])

    top = scored[0]
    if top.score >= 0.999:
        return MatchResult(top.obj, top.score, False, "exact", scored)
    if top.score < accept_threshold:
        return MatchResult(None, top.score, False, "low_confidence", scored)

    runner = next((c for c in scored[1:] if c.obj is not top.obj), None)
    if runner is not None and (top.score - runner.score) < ambiguity_margin:
        return MatchResult(None, top.score, True, "ambiguous", scored)

    return MatchResult(top.obj, top.score, False, "matched", scored)
