# Fuzzy Import Threshold Calibration — 2026-06-23

Read-only calibration of the legacy importer's organization-match confidence
gates against **real partner workbooks** (BONELA, BONEPWA, Tebelopele, Mopipi)
scored against the **live Organization list**. No data was written.

```
ACCEPT_THRESHOLD = 0.60
AMBIGUITY_MARGIN = 0.10
```

## Method
`uploads.fuzzy_match.best_match(sheet_name, organizations)` was run for every org
sheet in each workbook; reason + confidence + nearest candidates were recorded.

## Results (50 org sheets)
| reason | count | meaning |
|---|---|---|
| `exact` | 29 | exact org-name match (1.0) |
| `matched` | 5 | confident fuzzy match (0.675–0.875) — **all correct** |
| `low_confidence` | 8 | refused (< 0.60) |
| `no_candidates` | 8 | non-org sheets ("Indicators", "Narrative Template", "Reporting Form"…) — correctly no match |

**`matched` bucket (all verified correct):** "Botswana Society for the Disabled" (0.8),
"Mwatumwaya Rehabilitation Centre" (0.8), "Baikamogedi Support Group" → "…/POT" (0.875),
"Guardian Angels Orphans Soci" → "Guardian Angel Orphans Society" (0.675),
"Men for Health & Gender Just…" (0.999). **No false positives.**

**`low_confidence` bucket — the decisive evidence.** Two kinds of name land at the
**same ~0.58 score**:
- *Correct typo-variants:* "Matlhogonolo" vs **Mathogonolo** Charitable Society (0.5833);
  "Leitlho" vs **Leitho** la Sechaba (0.5833); "Ditsheganwe" vs **Ditshegwane** Support Group (0.5833);
  "Tozwimilidizha" vs **Tozwimilidzha** … (0.5).
- *Wrong matches:* "Thabologo Support Group" → Ditshegwane/Ghantsi/Jwaneng Support Group (all 0.5833).

Because a correct typo-variant and a genuinely-wrong "… Support Group" match score
**identically (0.5833)**, the importer **cannot tell them apart by score**.

## Assessment

| Question | Verdict | Evidence |
|---|---|---|
| Too loose? | **No** | Every `matched` (≥0.60) result was correct; zero wrong auto-matches. |
| Too strict? | **No (do not lower)** | The 0.58 band mixes correct + wrong matches at one score; lowering to catch typos (e.g. "Ditsheganwe") would simultaneously auto-write the **wrong** org for "Thabologo". |
| Correct? | **Yes — keep 0.60 / 0.10** | Refusing the ambiguous band is the safe choice; refused sheets are written **nowhere** and are surfaced for a one-click override. |

## Decision
**Keep `ACCEPT_THRESHOLD = 0.60` and `AMBIGUITY_MARGIN = 0.10` unchanged.** Evidence
does not support lowering them; doing so would trade reviewer effort for silent
mis-mapping — the exact risk this hardening eliminated.

Typo-variant sheets (≈8% here) are now refused **safely** and shown in the new
import-review panel with their nearest candidates + confidence, so the reviewer
confirms them via a `sheet_org_overrides` entry (the override resolves at
confidence 1.0).

## Future option (not implemented — would be a new capability, not a threshold change)
Add **per-token character similarity** (e.g. Levenshtein on near-identical tokens)
so "ditsheganwe"≈"ditshegwane" scores higher *without* lifting "thabologo"≈"ditshegwane".
This would reduce override effort for typo-heavy partners while preserving the
ambiguity guard. Out of scope for this readiness pass; revisit if override volume
proves burdensome.
