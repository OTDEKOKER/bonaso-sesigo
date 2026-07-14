# BONASO ⟷ NAHPA — System Development Progress Review
**Meeting:** 15 July 2026, 0900–1300 · Conference Room, NAHPA · Chair: Dr Lekgathane
**Prepared:** 2026-07-13 · Lead for items 3–14: **BONASO**

> This brief maps to each agenda item. Every status line is grounded in the live
> system as of 2026-07-13. Items marked **[CONFIRM]** need a business/organisational
> input from BONASO leadership that is not derivable from the system itself.

---

## Snapshot metrics (say these up front — they anchor the whole meeting)

| Metric | Live value (2026-07-13) |
|---|---|
| Projects live | **4** |
| Organisations onboarded | **96** |
| Active users | **18** of 21 accounts |
| Indicators (catalogue) | **291** (266 active) |
| Aggregate submissions | **18,785** total — **15,802 approved**, ~2,983 pending review |
| Functional modules deployed | **~21** (see item 5) |
| Automated backend tests | **519 passing** (last full verified run); ~382 test functions in tree |
| Nightly backup | **Healthy** — verified restore, 30-day retention, DB + file assets |
| Data integrity | **0 duplicates, 0 orphans** (last audit) |

Two-line headline: *"The reporting system is live and in active use by NAHPA's Social
Contracting coordinators for FY2026/27. It is stable, secure and test-backed. The
remaining work is operational hardening (off-site backups), documentation refresh, and
completing the piloting/rollout plan — not core development."*

---

## Item 3 — System Development Progress

**Completed & live**
- Full reporting stack live in production (Django/DRF + Next.js, PostgreSQL 18, Docker).
- Individual (respondent-level) capture **and** aggregate/numeric reporting workflows.
- Coordinator → sub-grantee hierarchy with rollups (NAHPA SC project = 6 coordinators, 66 sub-orgs).
- Reporting workbook generator + smart importer (Excel round-trip with each CSO's own tool).
- Review/approval workflow (two-tier: M&E Officer → Manager/admin), with audit trail.
- Funder Report Builder — figures + Table 1 compliance matrix, exportable to Word/Excel (live 2026-07-09).
- Offline/PWA capture + Android app; production hardening deployed 2026-07-07.

**In progress**
- FY2026/27 data load: coordinator targets done; ~2,983 aggregate rows (BONEPWA Q1) pending review; some org targets still to load.
- Funder-report figures render only for coordinators whose FY26/27 data is approved.

**Outstanding / near-term**
- Off-site backup activation · user-manual refresh · formal UAT sign-off · piloting & rollout plan (items 8, 10, 11, 12).

**Timeline framing [CONFIRM]:** development is effectively feature-complete for the
NAHPA SC use case; remaining items are operational and can close in **[CONFIRM: weeks]**.

---

## Item 4 — User Requirements

**How requirements were gathered** (evidence in `frontend/docs/` and `docs/`):
- NAHPA reporting **templates** per coordinator (BONELA, TEBELOPELE, MAKGABANENG, Men & Boys/MBGE, BONEPWA, Mopipi).
- Existing CSO **reporting tools** (Excel line-list / aggregate tools) reverse-engineered so the system round-trips their real workbooks.
- **Use-case catalogue** (`BONASODataPortalUseCases.xlsx`) and NAHPA SC assessment mapping.
- Iterative refinement through live use (each deploy below traces to a real reporting need).

**Approved requirements:** individual + aggregate reporting, coordinator hierarchy &
rollups, targets vs achievement, review/approval, funder reporting, offline capture,
role-based access, audit.

**Changed during development:** standardised age-range disaggregation; retired
sub-labels in favour of a single aggregate-config source of truth; indicator
canonicalisation (dedupe without data loss); reporting-period control overlay.

**[CONFIRM]** — BONASO to narrate: which stakeholders were formally consulted, and any
requirements **still outstanding / de-scoped** from NAHPA's side.

---

## Item 5 — Modules Developed

All **deployed & live** unless noted. Purpose of each:

| Module | Purpose |
|---|---|
| Users / Profiles | Accounts, JWT auth, roles, password reset, request-access |
| Organizations | Org registry + coordinator/sub-grantee hierarchy |
| Projects | Projects, project-indicators, targets (coordinator + org), derived/effective targets |
| Indicators | Indicator catalogue, canonicalisation, aliases, disaggregation config |
| Respondents | Individual client records (respondent → interaction → response) |
| Aggregates | Numeric/aggregate reporting, review workflow, reporting-period control |
| Events | Activities + public event check-in |
| Social | Social-media posts / reach |
| Analysis | Dashboards, coordinator rollups, exports |
| Uploads | Reporting-workbook import/export + file validation |
| Funder Reports | Config-driven funder figures + Table 1 compliance (Word/Excel) |
| Flags | Data-quality flags + review |
| System Status | Completeness/parity monitoring + data-quality engine |
| Messaging | In-app notifications |
| Audit | Full audit log of create/update/approve/reject/flag/delete |
| Backups / Recovery | Backup management + supervised disaster recovery |
| Reports | Scheduled reports + per-org home dashboard |
| Idempotency | Offline replay de-duplication |
| Core | Settings, system status, offline bootstrap |

**Under development / roadmap:** external-platform integration (e.g. DHIS2) — see item 7.

---

## Item 6 — System Functionality (LIVE DEMO)

Use the **demo script** in `docs/NAHPA_DEMO_SCRIPT_2026-07-15.md` (separate file).
Covers, in order: login → role-based landing → data entry (workbook + add-entry) →
review/approval → dashboards → funder report export → notifications → offline/mobile →
access controls (show a coordinator sees only their own tree).

**Do a full dry-run Tuesday** on the live or training stack. Have a fallback: screenshots
+ the exported Word funder report, in case of connectivity issues in the room.

---

## Item 7 — System Integration

**Internal integration (how modules connect):**
- Single PostgreSQL database; modules share one domain model.
- Indicators unify via a **canonical id** so duplicate/aliased indicators roll up together.
- **Coordinator rollup engine** is the single source of truth for actual/target/effective across dashboards, funder reports and exports.
- Bidirectional **target sync** (project targets ↔ coordinator targets).
- **Offline bootstrap** feeds the PWA/Android client; queued writes replay idempotently.

**External integration (be honest):** the portal is currently **standalone**. The
integration bridge with CSOs is the **Excel workbook import/export** (their tools →
the portal, round-trip safe). There is **no live API integration with NAHPA/DHIS2 or
other national platforms yet** — that is a candidate roadmap item if NAHPA wants it.
**[CONFIRM]** whether NAHPA requires DHIS2 / other interoperability.

---

## Item 8 — System Testing

**Internal testing (strong):**
- **519 automated backend tests passing** (last full verified run); regression suite covers auth, permissions/IDOR, idempotency, workbook round-trip, rollups, delete-protection, period-overlap guard.
- Frontend lint + type-check clean; Django deploy checks clean; zero unapplied migrations.
- **Continuous automated data checks in production** (cron): nightly consistency check, monthly payload-parity check, daily/weekly/monthly data-quality engine.
- End-to-end reporting flow exercised on the live FY2026/27 project (download → capture → import → approve → rollup) — passed.

**Errors found & corrected (examples):** indicator double-counting removed; stored-XSS
upload vector closed; workbook duplicate-column and count-column fixes; review-queue
visibility fixes; auth hydration/timeout hardening.

**Outstanding testing [CONFIRM]:**
- **Formal User Acceptance Testing (UAT)** with NAHPA/CSO users is **not yet documented with sign-off** — recommend a structured UAT round during the pilot with a signed test log. This is the main testing gap to own honestly.

---

## Item 9 — Data Protection and Security

**Strengths (all live):**
- **Auth:** JWT; login rate-limiting (lockout → HTTP 429); password reset throttled.
- **Access control:** server-side org + project isolation; role-based write authorisation (scope alone never authorises a write); a coordinator M&E officer sees **only their own tree**.
- **Training/live isolation** via a signed, non-client-controllable JWT claim (no cross-contamination of real data).
- **Approval** reserved to Manager/admin, enforced server-side, audit-logged.
- **File uploads:** extension allow-list + size cap + no-sniff (stored-XSS vector closed).
- **Full audit log** on create/update/approve/reject/flag/delete/activate.
- **Independent security audit (2026-06-29):** auth, permissions, IDOR, JWT, CSRF, SSRF verified sound.
- **Backups:** nightly `pg_dump` (DB + file assets), SHA-256 checksum, automated restore-list verification, 30-day retention, admin backup-download reminders, encrypted admin download; **supervised disaster-recovery** restore module + DR runbook + drill checklist.

**The one gap to state plainly — OFF-SITE BACKUP:**
- Nightly backups are **healthy but LOCAL-ONLY on the host** (`offsite_status: not_configured`).
- **Risk:** total host loss = loss of backups. The recovery capability is fully built; it only needs a destination + credentials (S3 / Backblaze / rclone / scp — all supported).
- **Recommendation:** activate before opening reporting to all orgs. *Offer to have this done by Wednesday if BONASO chooses a destination.* **[CONFIRM]**

**Compliance [CONFIRM]:** map to Botswana Data Protection Act obligations (data
controller = NAHPA?/BONASO?, retention, subject rights). Have a one-line position ready.

---

## Item 10 — Piloting Strategy

**Current reality — the pilot is effectively already running:**
- Pilot cohort = **NAHPA Social Contracting project**: 6 coordinators + their sub-grantees, doing **FY2026/27 quarterly reporting** live now.

**To formalise for NAHPA [CONFIRM most of this]:**
- Pilot **sites/cohort**: confirm the coordinator set as the formal pilot group.
- **Duration**: propose a bounded window (e.g. one full quarter with structured feedback).
- **Users**: coordinators' M&E officers + sub-grantee data capturers.
- **Training**: brief onboarding session + user manual (needs refresh — item 12).
- **Support**: named support contact + turnaround SLA; in-app flags for data issues.
- **Exit criteria**: UAT sign-off + a clean quarter of on-time submissions.

---

## Item 11 — Rollout Strategy

**Proposed phased rollout [CONFIRM timelines & phases with BONASO/NAHPA]:**
1. **Phase 0 (now):** NAHPA SC coordinators — live pilot reporting FY26/27.
2. **Phase 1:** stabilise + close operational gaps (off-site backup, UAT, manual, targets load).
3. **Phase 2:** expand to remaining projects/organisations already in the system (96 orgs onboarded).
4. **Phase 3:** full rollout — all reporting through the portal; retire parallel Excel processes.

**Site-readiness criteria:** org onboarded + indicators assigned + workbook layout set +
users trained + connectivity/offline path confirmed.

**Pilot → full-rollout gate:** UAT signed off, off-site backup active, one clean reporting
quarter, and the documentation refreshed.

---

## Item 12 — Training and Documentation

**Exists today:**
- **User manual** (`frontend/docs/user-manual.md` + PDF) — 18 sections covering login, dashboards, each module, offline, workflows, troubleshooting.
- **Admin/technical:** `SYSTEM_HANDOVER.md`, `BACKUP_ADMIN_GUIDE.md`, disaster-recovery runbook + drill checklist, offline/Android guides, rollout-readiness deck.
- **In-system:** a dedicated training mode (isolated from live data) for hands-on practice.

**Gaps to own honestly:**
- **User manual is ~6 weeks stale** (dated 2026-06-01) — predates Funder Reports, Reporting Periods, Workbook Layouts, and recent review-workflow changes. **Recommend refreshing before the pilot.** *Offer: BONASO can regenerate it this week.*
- **No single consolidated Administrator Manual** — the admin knowledge is spread across handover + runbooks; consider consolidating.
- **Training plan** for pilot users **[CONFIRM]** — propose format (in-person + manual + training mode) and schedule.

---

## Item 13 — Hosting and Maintenance

**Current hosting:**
- Single **VPS**, Docker Compose (nginx edge → Next.js frontend + Django backend + PostgreSQL 18). Separate isolated **training stack**. Domain: `sesigo.org.bw`.
- Source in GitHub (`OTDEKOKER/bonaso-sesigo`).

**Maintenance:** ongoing by BONASO (admin/maintainer); continuous deploys; automated
nightly backups + health/consistency/data-quality cron jobs.

**Sustainability risks to raise [CONFIRM ownership/contract]:**
- **Single-host** — no high-availability/failover; host RAM is under pressure (swaps heavily). Consider a resource upgrade and/or a warm standby for full rollout.
- **Off-site backup** (item 9) is the key resilience gap.
- **Ownership / long-term support model [CONFIRM]:** who owns the infrastructure, licensing, and the maintenance/support arrangement post-pilot.

---

## Item 14 — Challenges and Risks (with mitigations)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Off-site backup not configured** — host loss = data loss | High | Activate S3/Backblaze/rclone/scp destination (capability built; ~1 day) |
| R2 | **Single-host, RAM pressure** — no failover, swaps | Medium | Resource upgrade; plan warm standby for full rollout |
| R3 | **User manual stale; no consolidated admin manual** | Medium | Refresh manual this week; consolidate admin docs |
| R4 | **UAT not formally signed off** | Medium | Structured UAT round during pilot with signed log |
| R5 | **FY26/27 targets partially unset; ~2,983 rows pending review** | Medium | Finish target load + clear review backlog |
| R6 | **No external (DHIS2) integration yet** | Low/roadmap | Scope with NAHPA if required |
| R7 | Connectivity at CSO sites | Low | Offline PWA/Android already supported |

---

## Item 15 — Action Items (proposed — fill owners/dates in the room)

1. Activate **off-site backup** — *BONASO* — before pilot open.
2. **Refresh user manual** + agree training plan — *BONASO* — this week.
3. Agree **formal pilot** cohort, duration, UAT plan & sign-off — *BONASO + NAHPA*.
4. Finish **FY26/27 target load** + clear **review backlog** — *BONASO + coordinators*.
5. Confirm **hosting ownership / support model** & resource upgrade — *BONASO + NAHPA*.
6. Decision on **DHIS2 / external integration** requirement — *NAHPA*.
7. Set **date of next progress review**.

---

## Pre-meeting checklist for BONASO (do Mon–Tue)

- [ ] **Dry-run the live demo** end-to-end (item 6 script) on a real account.
- [ ] Decide: **activate off-site backup before Wednesday?** (strong "yes" — turns R1 from open risk into "done").
- [ ] **Refresh the user manual** (or at least acknowledge the date + commit to a refresh date).
- [ ] Fill every **[CONFIRM]**: requirements/stakeholders (4), integration needs (7), pilot terms (10), rollout timeline (11), hosting ownership + compliance/DPA position (9,13).
- [ ] Print/export the **funder Word report** as a leave-behind.
- [ ] Have fallback screenshots in case of room connectivity issues.
