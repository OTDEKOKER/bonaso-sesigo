# BONASO ⟷ NAHPA — System Progress Update
**Prepared:** 2026-08-17 · **Period covered:** since the 15 July 2026 progress review · **Lead:** BONASO

> Follow-up to the 15 July 2026 System Development Progress Review. Every status line is
> grounded in the live production system as of 2026-08-17. Metrics are pulled live from the
> production database (read-only). Items needing a business/organisational input from BONASO
> or NAHPA are marked **[CONFIRM]**.

---

## Snapshot metrics (live, 2026-08-17)

| Metric | 15 Jul 2026 | Now (2026-08-17) | Movement |
|---|---|---|---|
| Projects live | 4 | **4** | — |
| Organisations onboarded | 96 | **101** | +5 |
| User accounts (active) | 18 of 21 | **23 of 26** | +5 active |
| Indicator catalogue | 291 | **293** | +2 |
| Aggregate submissions | 18,785 | **18,970** | +185 |
| — approved / pending | 15,802 / ~2,983 | **18,969 / 1** | **review backlog cleared** |
| Disaggregated fact rows | ~890k | **947,641** | +~57k |
| Real CSO grant records (financial) | — | **87** | new module |
| Nightly backup | Healthy | **Healthy + restore drill-verified (36 s)** | ✅ |
| TLS certificate | (renewal risk) | **Valid to Oct 2026, auto-renews** | ✅ resolved |

**Two-line headline:** *"Since the July review the platform has moved from 'feature-complete
for reporting' to a broader decision-support and accountability platform: executive dashboards,
self-service analytics, a localised CSO mapping survey, and per-grant financial accounting are
now live. The July review backlog is cleared, recovery is drill-tested, and the certificate risk
is closed. The remaining work is the same operational item as before — activating off-site backup
— plus formal UAT sign-off and a data-protection (DPO) confirmation."*

---

## 1. Decision-support & executive visibility (new since July)

The biggest shift this period: the system now answers *"how are we doing against target"* at a
glance, not just *"what was reported."*

- **Executive Dashboard** (`/executive`) — hierarchy-level KPIs, target-vs-achieved, trend and
  top-organisation views, CSV export. Lands directly on the current project and loads fast
  (project-detail payload reduced from ~10.4 MB to ~0.64 MB).
- **RAG (Red/Amber/Green) status** across all dashboards — every target-vs-achieved figure is now
  colour-coded against a **single, documented performance standard** (met / on-track / at-risk /
  off-track), so the same metric reads the same everywhere.
- **Config-driven funder figures** — the executive Programme Figures panel renders funder-report
  figures from the live reporting engine with **nothing hardcoded**; when the underlying data
  changes, the figures change. No manual chart maintenance.
- **Self-service analytics workbench** (`/explore`) — a build-any-visualisation canvas with
  drill-down and dimension pivoting, so M&E staff can interrogate the data without a developer.

**Why it matters to NAHPA:** progress reporting is now visual and current, and the funder figures
are reproducible from source rather than assembled by hand.

---

## 2. Reporting & data operations

- **Review backlog cleared** — the ~2,983 aggregate rows pending at the July review are approved;
  the queue is effectively empty (1 item in-flight). Submissions rose to **18,970**.
- **FY2026/27 load** — coordinator targets and sub-grantee data loaded across the NAHPA Social
  Contracting coordinators; historical line-lists reconciled (BONEPWA Q1 imports merged).
- **Targets + achieved Excel export** — one download gives every workbook indicator's target
  **and** computed achievement, for offline funder review.
- **Workbook robustness fixes** — resolved the Excel "Repaired" prompt (stray 1×1 merges),
  auto-calculated no-disaggregation totals, and corrected duplicate/count-column layouts.
- **Data-integrity corrections** (all reversible, audit-logged): FY25/26 parity correction on the
  NCD cluster; General-Population/KP indicator ordering fix so general-population data lands in the
  right place; canonical merge of duplicate GBV-eligibility indicators; mental-health
  disaggregation ordering aligned to template.

---

## 3. New capability — CSO Mapping (localised survey)

A standalone national CSO-mapping instrument, previously an embedded third-party (Kobo) form, is
now a **fully localised, in-house questionnaire** running on the on-premises Botswana database:

- Native questionnaire (31-district + structured multiple-choice sections), **GPS location
  capture**, and a **map view** (`/cso-mapping-map`) of respondent locations.
- Public intro page for distribution; no third-party data processor in the loop.

**[CONFIRM] — Data-protection sign-off (DPO)** is the gate before wide distribution of the survey
link.

---

## 4. New capability — Grants / financial accounting

A per-organisation **grant and expenditure accounting module** is deployed:

- Tracks grant award, budget lines, disbursements and quarterly expenditure per CSO, with a
  single rollup engine as the source of truth for burn/utilisation.
- **87 real CSO grant records** loaded from the quarterly expenditure workbook (page burn computed
  correctly as quarter ÷ annual value).
- Ships **dark / deny-by-default** — invisible until the `grants` module is explicitly enabled per
  organisation — so it does not affect current users until NAHPA/BONASO decide to switch it on.

**[CONFIRM]** whether/when to enable financial visibility, and for which roles.

---

## 5. Data protection, privacy & security

- **Training/Live isolation gap closed** — identified and fixed a case where a Training-Mode login
  could surface live data; login mode and respondent/flag isolation are now enforced end-to-end,
  and any leaked figures were removed. Training/live separation rides on a signed,
  non-client-controllable token claim.
- **Password expiry & admin-approved reset** — 90-day expiry aligned to Data Protection Act
  expectations, with a controlled reset path.
- **Versioned confidentiality acknowledgement gate** — protected pages require an up-to-date
  confidentiality acknowledgement.
- **Access-scope hardening** — additional server-side project/organisation isolation on tasks,
  deadlines, activities and narrative reports; a data-entry role gate on respondent/PII surfaces;
  an org-tree data-leak path closed.
- **Infrastructure security headers** version-controlled (HSTS + X-Frame-Options), staged to apply
  in a maintenance window.

**Framing for NAHPA:** the July review named training/live isolation and DPA alignment as the
sensitive areas; both were actively hardened this period.

---

## 6. Resilience & operations

- **Recovery is now drill-tested** — the nightly dump was restored into a throwaway database on the
  live cluster in **36 seconds**, row counts matching live exactly. The backup is proven complete
  and restorable (re-run quarterly).
- **TLS certificate risk resolved** — `sesigo.org.bw` valid to October 2026 and auto-renewing;
  the July renewal concern is closed.
- **Support & health** — in-app help-desk/support path and an `/api/health` endpoint for
  monitoring.
- **Host resource management** — backend footprint trimmed to keep the single host within memory;
  heavy jobs are serialised deliberately.

---

## Open items / risks (honest status)

| # | Item | Severity | Status / plan |
|---|---|---|---|
| R1 | **Off-site backup not yet active** — nightly backups are healthy but **local to the host**; total host loss = loss of backups | **High** | Capability built + recovery drill-verified. On-prem "pull-over-SSH + Borg" design chosen; **Pentium (on-prem) side pending**. Activate before full rollout. **[CONFIRM]** |
| R2 | **Single-host / RAM pressure** — no failover; host swaps under load | Medium | Keep heavy jobs serialised; resource upgrade / warm standby for full rollout. **[CONFIRM ownership]** |
| R3 | **Formal UAT not yet signed off** | Medium | Run a structured UAT round during the pilot with a signed test log. **[CONFIRM]** |
| R4 | **CSO-mapping DPO sign-off** before wide survey distribution | Medium | Gate distribution on DPO confirmation. **[CONFIRM]** |
| R5 | **User manual refresh** — predates several new modules (Executive, Explore, CSO Mapping, Grants) | Low/Med | Regenerate before pilot open. |

---

## Recommended next actions

1. **Activate off-site backup** (complete the on-prem Pentium pull) — *BONASO* — before full rollout.
2. **DPO confirmation** for the localised CSO-mapping survey — *BONASO/NAHPA* — before distributing the link.
3. **Schedule a formal UAT round** with sign-off during the pilot — *BONASO + NAHPA*.
4. **Decide on enabling the Grants module** and financial visibility scope — *NAHPA + BONASO*.
5. **Refresh the user manual** to cover the new modules — *BONASO*.
6. Set the **date of the next progress review**.

---

*Prepared by BONASO. Figures are live as of 2026-08-17 and reproducible from the production
database. This update is the counterpart to `NAHPA_MEETING_BRIEF_2026-07-15.md`; risk numbering
(R1–R5) is scoped to this update and does not map 1:1 to the July brief's table.*
