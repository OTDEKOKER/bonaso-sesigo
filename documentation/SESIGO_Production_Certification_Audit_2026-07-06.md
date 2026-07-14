# SESIGO Data Portal — Pre-Production Certification Audit
**Date:** 2026-07-06
**Scope:** Complete end-to-end workflow audit for national rollout (85 reporting organisations)
**Method:** Source-grounded. Every finding cites the responsible file/line. No behaviour assumed from module existence.
**Verdict (summary):** **CONDITIONAL NO-GO** — the reporting/approval/analytics core is genuinely strong and production-grade, but a small number of **data-integrity and destructive-operation gaps** must be closed before 85 orgs submit real data. None require redesign; all are contained fixes.

---

## PHASE 1 — SYSTEM UNDERSTANDING (Workflow Map)

### Stack
- **Backend:** Django + DRF, JWT (SimpleJWT) with a signed `mode` claim; 18 domain apps (`core/settings.py:60-76`).
- **Frontend:** Next.js App Router (`app/(dashboard)/…`), mirror `app/(dashboard)/training/…` tree for Training Mode.
- **Isolation model:** JWT `mode` claim (`live`/`training`) is the sole source of truth (`organizations/access.py:88-166`). The legacy `?training_only` param is dead. Safe default = live.

### Modules (apps)
`users, organizations, indicators, projects, respondents, aggregates, events, social, flags, analysis, profiles, uploads, messaging, idempotency, audit, recovery, system_status` + `backups`.

### Roles / permissions
- **Org-admin bypass** (`is_organization_admin`) sees everything.
- **Non-admins** gated by (a) **project assignment** (`Project.assigned_users`, `filter_queryset_by_assigned_projects`) and (b) **org scope** (`get_user_organization_ids`).
- **Module permissions:** explicit-deny model (`users/permissions.py` — `HasModulePermission`). A module the admin never restricted is never locked; only explicit denies bite. Action-level grants inside granted modules.
- **Aggregate roles:** `can_submit_aggregates` (write), `can_review_aggregates` (review/flag/reject), `can_approve_aggregates` (final sign-off). Enforced server-side in `_mark_review_state` (`aggregates/views.py:497-504`).

### Organisation & project hierarchy
- Global org tree (`organizations` MPTT-style `get_descendants`).
- **Project-scoped** hierarchy via `ProjectOrganizationHierarchy` (parent→child edges, cycle-guarded by CheckConstraint `projects/models.py:396-401`).
- `ProjectOrganization` = membership + role (`coordinator`, `sub_grantee`, …), one row per (project, org).

### Reporting workflow (the spine)
1. Coordinator/org opens **Aggregates page → ReportingWorkbookDialog**.
2. **Download** blank/data workbook: `GET aggregates/reporting-workbook` → `_build_indicator_plans` (assigned, active, non-deprecated indicators) → `order_plans_by_layout` (WorkbookLayout gates content + order) → `reporting_workbook.generate_workbook`.
3. Org fills numeric cells; hidden `_cellmap` sheet holds the exact JSON path per cell.
4. **Upload**: `POST aggregates/import-reporting-workbook` → `parse_workbook` → per-indicator scope check → `AggregateSerializer` → `_upsert_pending_aggregate` (writes **status=pending**, idempotent).
5. **Review/Approve**: officer reviews; manager/admin approves → `sync_project_indicator_total`.
6. **Aggregation/Analysis**: `analysis/views.py` + coordinator rollup engine read **approved** rows only.

### Workbook / Target / Approval / Analytics — SSoT chain
- **WorkbookLayout is the content gate**: only indicators *placed* in the coordinator's active layout are downloadable/reportable (`projects/workbook_layout.py:103-155`). Fallback: **no layout ⇒ all assigned indicators** (see Phase 4 gap).
- **Coordinator rollups** are computed by ONE engine: `analysis/services/coordinator_rollups.py`. FE is display-only.
- **Audit logging:** `record_audit_event` on create/update/approve/reject/flag/delete.
- **Scheduled jobs / async:** `uploads` ExportJob workers (`job_type`: upload_import, aggregate_export, coordinator_workbook); host-cron parity/DQ; nightly backups.

---

## PHASE 2 — PROJECT CREATION LIFECYCLE

| Capability | Status | Evidence |
|---|---|---|
| Create / configure project | ✅ | `ProjectViewSet` (ModelViewSet), `projects/views.py:57` |
| Assign orgs / coordinators / sub-recipients | ✅ | `ProjectOrganization`, roles, `is_coordinator` |
| Reporting period / years / quarters | ⚠️ Implicit | Periods are supplied at **download time**, not stored on Project. `start_date`/`end_date` only. No enforced reporting calendar. |
| Switch Live/Training | ✅ | `Project.is_training` + JWT mode claim |
| Archive | ⚠️ Field only | `status='archived'` choice exists but **no archive action/guard**; archived projects are not systematically excluded from writes. |
| **Clone / Duplicate** | ❌ **Missing** | No `clone`/`duplicate` action on `ProjectViewSet`. Audit prompt expects it; not implemented. |
| Deactivate | ⚠️ | Only via `status`; no cascade to hide from reporting. |
| **Delete safely** | ❌ **UNSAFE** | No delete guard. `Aggregate.project` = **CASCADE** (`aggregates/models.py:21-24`). Deleting a project silently destroys **all reported data, targets, assignments, layouts**. See Critical #1. |

**Orphan/soft-state risks:** archived/completed projects still accept writes (no `assert_project_write_allowed` status check — it only checks training/live, `aggregates/views.py:286`).

---

## PHASE 3 — INDICATOR WORKFLOW

- **Canonical/deprecated model is sound:** `is_deprecated` ⇔ `canonical_indicator` set; historical data stays on the deprecated row; `.canonical` resolves to the live indicator (`indicators/models.py:88-156`). Rollups match on `canonical_id`, so alias/deprecated aggregates roll to canonical correctly (`coordinator_rollups.py:127,148`).
- **Aliases:** `IndicatorAlias` unique-constrained.
- **Derived / percentage / dependent indicators:** `ProjectIndicator.target_source_type` (`fixed`/`derived`/`percentage`) + `target_source_indicator` + per-coordinator override on `ProjectIndicatorOrganizationTarget`. Computed at read-time (`coordinator_rollups.py:194-264`).
- **Workbook exclusion:** `_build_indicator_plans` filters `is_active=True` and **excludes deprecated** (`.exclude(canonical_indicator__isnull=False)`, `aggregates/views.py:1538-1539`). ✅ deprecated indicators never appear on new workbooks.

**Gaps / risks:**
- **No circular-reference guard on derived targets.** `target_source_indicator` could point (directly or transitively) at an indicator whose own target derives back → the engine reads *achieved values* (not targets) so it won't infinite-loop, but A→B→A **percentage chains** produce silently meaningless targets. No validation at config time. (Medium)
- **Hard delete uncontrolled:** `indicators/views.py` has no custom `destroy`; default DELETE cascades to `Aggregate`, `WorkbookLayoutItem`, `ProjectIndicator`. Delete **is reachable in the UI** (`app/(dashboard)/indicators/page.tsx`). See High #4.

---

## PHASE 4 — WORKBOOK WORKFLOW (most critical)

**Strengths (verified):**
- **Deterministic round-trip.** Every numeric cell carries a `_cellmap` JSON-path entry; the importer reconstructs the canonical `value` payload regardless of disaggregation shape (`reporting_workbook.py:1-27, 1167-1209`). This is the single best-engineered part of the system.
- **Layout is the content gate.** `order_plans_by_layout` **excludes** any assigned-but-unplaced indicator — "not arranged = not reported" (`workbook_layout.py:141-155`).
- **No cache leakage.** Downloads set `Cache-Control: no-store`; coordinator workbook regenerated from live layout each time (`aggregates/views.py:1661,1730-1733`).
- **Import writes to `pending`**, never auto-approves; per-indicator scope re-checked (`aggregates/views.py:1779-1792`).
- **Duplicate uploads are idempotent** — `classify_upsert`/`_values_equal` make identical re-uploads no-ops and don't re-notify reviewers (`aggregates/views.py:308-336, 1850-1852`).

**Gaps / risks:**
1. **SSoT is conditional, not absolute.** When a coordinator has **no active layout** (or a headings-only layout), `order_plans_by_layout` returns **all assigned indicators** (`workbook_layout.py:123-130`). For 85 orgs at go-live, many coordinators will not yet have built a layout → their workbooks silently contain the full assigned set in name-order, contradicting "only workbook indicators are reportable." **This is the top workbook risk** — behaviour differs org-to-org depending on whether an admin happened to build a layout. See High #3.
2. **Coordinator workbook org set = GLOBAL tree, not project hierarchy.** `coordinator_workbook` iterates `coordinator.get_descendants()` (`aggregates/views.py:1692`) whereas `resolve_layout_for_org` walks the *project* hierarchy. A coordinator that is a parent in the global tree but not in this project's hierarchy can pull sub-sheets for orgs outside the project scope. (Medium)
3. **No workbook-version gate on import.** `WORKBOOK_VERSION` is embedded but the importer doesn't reject a mismatched major version; a future schema bump could import garbage. (Low now, Medium later.)
4. **Import trusts embedded project/org/period metadata**, not the caller's selection. Scope is re-checked (safe against privilege escalation) but a user can upload a workbook for the *wrong quarter* and it will import to that quarter with only a scope check, no "this isn't the period you're reporting" confirmation. (Medium UX/integrity)

---

## PHASE 5 — TARGET WORKFLOW

- Targets exist at **project level** (`ProjectIndicator.q1..q4_target`) and **org/coordinator level** (`ProjectIndicatorOrganizationTarget`), unique per (project_indicator, org).
- **Derived/percentage/pending** targets computed by the rollup engine; a derived target whose source isn't yet reported returns `target_value=None` / `status='pending'` (`coordinator_rollups.py:260-267`) — good, distinguishes "0 reported" from "not reported".
- Achievement/rollup/own-vs-subgrantee split all in one engine. `own + subgrantee == actual` by construction.

**Gaps / risks:**
- **No enforced link "every workbook indicator has a target".** A placed layout indicator with no target row simply reports `no_target`. For a national target-tracking system this means silent target gaps that only surface as blank achievement. No pre-rollout completeness report exists in-app (there is an offline CSV `coordinator_quarter_gaps_by_project_indicator.csv`). See High #5.
- **Targets can exist for indicators no longer on the workbook** (assignment ≠ placement). Harmless to reporting but pollutes target exports. (Low)
- **No target locking / carry-forward.** Prompt asks for both; neither exists. Targets are freely editable after reports exist with no lock. (Medium — governance)

---

## PHASE 6 — REPORTING WORKFLOW (per role)

Walked download→capture→upload→validate→review→approve→aggregate for each role:

- **Organisation / Sub-recipient:** ✅ complete path via ReportingWorkbookDialog; errors + preview + success all surfaced (`ReportingWorkbookDialog.tsx:298-652`).
- **Coordinator:** ✅ can download consolidated coordinator workbook (async ExportJob, no 502) and see rollups.
- **Reviewer (M&E Officer):** ✅ review/flag/reject within scope.
- **Manager/Admin:** ✅ bulk approve (`bulk_approve` permission-gated, audited, syncs totals).

**Dead-end / friction risks:**
- **Discoverability:** the entire reporting entry is a dialog **inside the Aggregates page**. A first-time coordinator has no "Submit your report" landing/CTA. See Usability (Phase 10).
- **No submission receipt.** After import the user gets a toast + counts, but there is no persistent "you have submitted Q3 for these indicators" status the org can revisit. (Medium UX)

---

## PHASE 7 — DATA VALIDATION

- **Required project/org/period metadata** validated on import (`aggregates/views.py:1760-1766`).
- **Per-indicator scope** validated (`_assert_write_scope`).
- **Serializer validation** per row; failures collected, not fatal unless all fail.
- **Idempotency / duplicate** handled (Phase 4).
- **Approved-data protection:** re-uploading a value that differs from an approved row **knocks it back to pending** (`OUTCOME_RESET_FROM_REVIEW`) and alerts reviewers — good lifecycle rule (`aggregates/views.py:1848-1859`).

**Gaps:**
- **No cross-period double-submission validation** (monthly + quarterly for same window — see Critical #2).
- **No project-status validation** (can report to archived/completed projects).
- **Formula validation** for derived targets is absent (Phase 3 circular-ref).

---

## PHASE 8 — ANALYTICS WORKFLOW

- Executive/coordinator/org dashboards, trend, target-vs-achievement, exports all read **approved** aggregates and route coordinator totals through the single rollup engine → totals match by construction.
- Deprecated indicators fold into canonical (`canonical_id` match) → no deprecated rows shown, no split counts.
- Trend axis buckets a period into its `period_start` month (`analysis/views.py:681-684`).

**Gaps / risks:**
- **Double-counting on mixed reporting cadences (systemic).** Both the rollup engine and dashboards select aggregates by **period overlap** (`period_start<=end AND period_end>=start`, `coordinator_rollups.py:220,239`). A **yearly** aggregate (Apr–Mar) overlaps **all four quarters**; a quarterly + its three monthly submissions all overlap the same quarter. All overlapping rows are **summed** → inflated actuals. See Critical #2.
- **Trend distortion:** a quarterly total lands entirely in its first month on the monthly trend (cosmetic, not double-count).

---

## PHASE 9 — ORGANISATION HIERARCHY

- Project-scoped parent/child edges, cycle-guarded; coordinator subtree resolved via `resolve_organization_scope_with_project_hierarchy`.
- **Inconsistency (from Phase 4):** layout inheritance walks the **project** hierarchy; coordinator-workbook descendant enumeration walks the **global** tree. These two notions of "who is under this coordinator" can diverge. (Medium)

---

## PHASE 10 — USER EXPERIENCE (usability audit)

**A first-time coordinator can, but not obviously:**
| Question | Finding |
|---|---|
| What do I do next? | ❌ No guided "report now" landing; must know to open Aggregates. |
| How to download/upload? | ✅ Clear once in ReportingWorkbookDialog (Download/Upload buttons, icons). |
| Where do validation errors appear? | ✅ Inline in dialog, first 8 rows listed, destructive toast. |
| Did my submission succeed? | ⚠️ Toast + counts only; no durable submission record/receipt. |
| Where are targets/reports viewed? | ✅ Targets → Coordinators page; Analysis pages. |

**Issues:** reporting buried in Aggregates; "aggregate" is jargon for field orgs; no explicit period-confirmation on import; no dashboard prompt "you have N indicators unreported this quarter."

---

## PHASE 11 — SECURITY (verified sound)

- **Org isolation:** `get_queryset` filters non-admins by assigned projects + org scope (`aggregates/views.py:251-270`). ✅
- **Training/Live isolation:** JWT `mode` claim, not client-controllable; training-bound token can't escalate (`organizations/access.py:119-144`). ✅
- **Write authorization:** role gate + training boundary + org-in-project + indicator-assignment, all before any write (`_assert_write_scope`). ✅ Scope alone never authorises a write.
- **Approval authority** reserved to manager/admin, enforced server-side. ✅
- **File upload:** extension allowlist + size cap + `nosniff` (per prior audit, commit 9a7b624f). ✅
- **Audit logs:** create/update/approve/reject/flag/delete recorded. ✅
- **Residual:** destructive DELETE endpoints are authorised only by module permission, with **no data-loss confirmation** (Phase 2/3). This is the main security-of-data gap, not an auth bypass.

---

## PHASE 12 — PERFORMANCE

- Rollup engine is **batched**: one scope resolution per (coordinator, project), one aggregate query per batch — O(1) queries, not N+1 (`coordinator_rollups.py:97-152`). ✅
- `/me` query reductions + client-perm cache + parallel aggregate paging (prior perf work). ✅
- **Watch items at 85-org scale:**
  - Rollup loads **all overlapping approved aggregates into Python** and loops in memory (`agg_rows` list). Fine for current volume; at hundreds of thousands of rows across a full FY this becomes memory/CPU-bound. (Medium — monitor)
  - Workbook generation is synchronous for single-org download (coordinator is async). A very large single-org layout is CPU-bound on the web worker. (Low)
  - No caching layer on dashboard aggregate reads; every load recomputes. (Low/Medium)

---

## PHASE 13 — EDGE CASES

| Case | Behaviour | Risk |
|---|---|---|
| Empty project / no assignments | Download returns 400 "no indicators" | ✅ clean |
| No layout | Full assigned set downloads | ⚠️ SSoT inconsistency (High #3) |
| Missing targets | Reports fine, shows `no_target` | ⚠️ silent gap (High #5) |
| Duplicate upload | Idempotent no-op | ✅ |
| Change workbook layout after targets | Next download reflects new layout immediately | ✅ (layout is live-read) |
| **Delete project/indicator/org after reports** | **CASCADE wipes reported data, no guard** | 🔴 Critical #1 |
| Mixed monthly+quarterly+yearly for same indicator | **Summed via overlap → inflated** | 🔴 Critical #2 |
| Report to archived/completed project | Allowed | ⚠️ Medium |
| Session timeout | 30-min idle logout + warning modal, cross-tab | ✅ |
| Browser refresh mid-capture | Local Excel file; no server draft lost | ✅ |
| Concurrent approvers | `bulk_approve` in transaction, status filter, idempotent | ✅ |

---

## PHASE 14 — GO / NO-GO ASSESSMENT

### Workflow scores (0–100)
| Workflow | Score | Note |
|---|---|---|
| Project Management | **62** | No clone/archive action; unsafe delete; no reporting-calendar/status gate |
| Indicator Management | **74** | Canonical model strong; uncontrolled hard-delete; no derived circular-ref guard |
| Workbook Management | **80** | Excellent round-trip; SSoT conditional on layout existing |
| Target Management | **72** | Engine strong; no completeness enforcement, no locking/carry-forward |
| Reporting Workflow | **82** | Complete & idempotent; discoverability + receipts weak |
| Approval Workflow | **90** | Permission-gated, audited, lifecycle-correct |
| Analysis | **70** | Correct single-source rollups; **mixed-cadence double-count** drags it down |
| Dashboards | **74** | Match underlying data; same overlap risk |
| Security | **88** | Isolation/auth/audit sound; data-loss confirmations missing |
| Performance | **80** | Batched & cached where it matters; in-memory rollup to monitor |
| Usability | **66** | Functional but no guided reporting entry / receipt |
| Data Integrity | **58** | Cascade deletes + overlap double-count are the two real threats |
| Workflow Completeness | **75** | Core complete; project lifecycle + target completeness gaps |
| Operational Readiness | **70** | Backups/audit good; offsite backup still not activated; delete safety missing |

### FINAL VERDICT: **CONDITIONAL NO-GO**
The reporting → approval → analytics spine is production-grade and safe against privilege escalation and training/live leakage. **Do not open to 85 orgs until Critical #1 and #2 are closed** and High #3/#5 are decided, because both Criticals corrupt the national numbers or destroy data irrecoverably, and neither is currently guarded.

---

## RANKED ISSUE REGISTER

### 🔴 CRITICAL

**C1 — Deleting a project/indicator/organisation cascades and destroys all reported data with no guard or confirmation.**
- **Root cause:** `Aggregate.{project,indicator,organization}` are all `on_delete=CASCADE` (`aggregates/models.py:16-28`); no custom `destroy`/protection on `ProjectViewSet`, `IndicatorViewSet`, `OrganizationViewSet`. Indicator delete is reachable in the UI (`app/(dashboard)/indicators/page.tsx`).
- **Business impact:** One mis-click by an admin permanently erases an org's or project's entire reporting history mid-cycle. Unrecoverable except from last nightly backup.
- **Technical impact:** Silent cascade through `ProjectIndicator`, `ProjectIndicatorOrganizationTarget`, `ProjectOrganization`, `WorkbookLayoutItem`, `Aggregate`, `AggregateFact`.
- **Files:** `aggregates/models.py`, `projects/views.py`, `indicators/views.py`, `organizations/views.py`.
- **Fix:** Add `destroy` guards that refuse deletion when dependent `Aggregate`/target rows exist (return 409 with count), OR switch to soft-delete/`status` + `on_delete=PROTECT` for `Aggregate` FKs. Prefer soft-delete + "deactivate" UI; reserve hard delete for empty objects only.
- **Effort:** ~1 day (guards) / 2–3 days (soft-delete + migration).

**C2 — Mixed reporting cadences double-count actuals (yearly overlaps all quarters; monthly + quarterly both summed).**
- **Root cause:** aggregates are selected by **period overlap** and summed with no period-type dedup (`coordinator_rollups.py:220,239-245`; dashboards `analysis/views.py`). `unique_together` only prevents identical (period_start, period_end) rows, so a monthly, a quarterly, and a yearly submission for the same window all coexist and all count.
- **Business impact:** National totals and achievement % inflated by 2–4× for any org that reports at more than one cadence — exactly the kind of mixed practice 85 orgs will produce.
- **Technical impact:** Every coordinator rollup, executive dashboard, target-vs-achievement and export is affected.
- **Files:** `analysis/services/coordinator_rollups.py`, `analysis/views.py`, `aggregates/models.py`, `aggregates/reporting_workbook.py` (period selector).
- **Fix (choose one):** (a) Constrain each project to a single `period_type` and enforce it at import (reject a monthly upload for a quarterly project). (b) On import, reject/replace overlapping-period rows for the same (indicator, project, org). (c) In the rollup, prefer the finest granularity and skip coarser rows that fully contain already-counted finer rows. Option (a) is simplest and safest for rollout.
- **Effort:** ~1–2 days (option a) / 3–4 days (option c).

### 🟠 HIGH

**H3 — Workbook SSoT is conditional: orgs whose coordinator has no active layout download the full assigned indicator set.**
- **Root cause:** `order_plans_by_layout` returns all plans unchanged when `layout is None` or has no indicator items (`workbook_layout.py:123-130`).
- **Impact:** At go-live most coordinators won't have built a layout → the "only workbook indicators are reportable" guarantee silently doesn't hold; inconsistent workbooks across orgs.
- **Files:** `projects/workbook_layout.py`, `aggregates/views.py:1642-1644`.
- **Fix:** Decide policy explicitly. Either (a) require an active layout before a project can report (block download with a clear message), or (b) treat "no layout" as an admin-visible warning surfaced in System Status. Do **not** leave it silent.
- **Effort:** ~0.5 day.

**H4 — Uncontrolled hard-delete of indicators (and orgs) reachable in UI.** Same root/fix family as C1 but specifically indicators, which cascade-wipe aggregates. Deprecation (`is_deprecated`) is the intended lifecycle and already works — hard delete should be blocked when aggregates exist.
- **Files:** `indicators/views.py`, `app/(dashboard)/indicators/page.tsx`.
- **Fix:** Block `destroy` when `Aggregate.objects.filter(indicator=...)` exists; steer admins to deprecate.
- **Effort:** ~0.5 day.

**H5 — No in-app "every reportable indicator has a target" completeness gate.**
- **Root cause:** targets are optional rows; missing target → `no_target`, silently. Completeness only exists as an offline CSV.
- **Impact:** Coordinators can report against indicators with no target for the whole FY and no one is alerted; achievement tracking is blank.
- **Files:** `projects/`, System Status app.
- **Fix:** Add a "target completeness" panel to System Status (placed-but-untargeted indicators per coordinator/quarter). Reuse existing parity/DQ plumbing.
- **Effort:** ~1 day.

### 🟡 MEDIUM

- **M6 — Reporting to archived/completed projects is allowed** (`assert_project_write_allowed` checks only training/live). Add a project-status write gate. `aggregates/views.py:286`. ~0.5 day.
- **M7 — Coordinator-workbook descendants use the global org tree, not the project hierarchy**, diverging from layout inheritance and potentially pulling out-of-project orgs. `aggregates/views.py:1692`. ~0.5 day.
- **M8 — No target locking / carry-forward.** Governance gap for a national system; targets editable after reporting with no lock/audit-of-change beyond generic audit. ~1–2 days.
- **M9 — Import trusts embedded quarter with no period-confirmation.** A user can import into the wrong quarter silently. Add a confirm step showing the parsed period. ~0.5 day.
- **M10 — No derived-target circular-reference validation** at config time. Add a validator on `ProjectIndicator.save`/serializer. ~0.5 day.
- **M11 — In-memory rollup will not scale indefinitely.** Monitor; move to DB aggregation if volume grows. Watch, not block.
- **M12 — No durable submission receipt / "unreported indicators" prompt.** UX + accountability. ~1–2 days.

### 🟢 LOW
- **L13** — No workbook major-version gate on import (`reporting_workbook.py`).
- **L14** — Targets can persist for unplaced indicators (export noise).
- **L15** — Quarterly totals distort the monthly trend axis (cosmetic).
- **L16** — Reporting entry buried in Aggregates page (discoverability).

---

## "If 85 organisations begin reporting today, what fails first?"
Ranked by likelihood × impact:

1. **Inflated national numbers (C2).** As soon as any orgs report monthly while others report quarterly/yearly, coordinator rollups and the executive dashboard overcount. **Most likely to actually happen**, and it corrupts the headline figures the rollout exists to produce.
2. **Inconsistent workbooks (H3).** Coordinators without a built layout hand their orgs the full assigned set; "the workbook is the form" breaks unevenly across the 85.
3. **Accidental data loss (C1/H4).** With delete reachable and unguarded, a single admin action during a busy cycle can wipe an org/indicator's history — low frequency, catastrophic when it lands.
4. **Silent target gaps (H5).** Achievement shows blank/`no_target` for untargeted indicators; discovered late, mid-reporting.
5. **Reports to closed projects (M6)** and **wrong-quarter imports (M9).** Steady trickle of dirty data needing manual cleanup.
6. **Support load from discoverability/receipts (L16/M12).** Not a failure, but the highest help-desk volume.

**Recommendation:** Fix **C1 + C2** (hard blockers) and decide **H3 + H5** before opening to all 85. M6/M9/M10 are fast follow-ups that materially reduce dirty-data cleanup. Everything else can ship post-launch. Also confirm **offsite backup is finally activated** (still `not_configured` per the last rollout audit) before national go-live — it is the only recovery path against C1 today.
