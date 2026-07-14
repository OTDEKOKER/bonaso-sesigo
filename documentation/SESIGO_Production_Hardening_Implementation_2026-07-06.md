# SESIGO Production Hardening — Implementation Report
**Date:** 2026-07-06
**Branch:** `production-hardening-2026-07-06` (offline; NOT pushed, merged, or deployed)
**Baseline:** `derived-targets-2026-07-03` @ c4e764c3
**Companion audit:** `docs/SESIGO_Production_Certification_Audit_2026-07-06.md`

> **Workbook contract preserved.** No change was made to the reporting workbook — not its
> layout, formatting, sheets, structure, ordering, parser, template, hidden metadata,
> cell mapping, upload/download format, formulas, or appearance. `aggregates/reporting_workbook.py`
> is **untouched**. All previously distributed workbooks import unchanged (verified: the
> full `aggregates` + `uploads` workbook/import test suites pass).

---

## 1. Issues fixed

| ID | Sev | Issue | Resolution | Migration |
|----|-----|-------|------------|-----------|
| **C1** | Critical | Deleting a project/org cascades and destroys all reporting history | Delete blocked (409) when reporting history exists; safe lifecycle actions added (archive/retire/deactivate) | None |
| **C2** | Critical | Mixed reporting cadences double-count (yearly overlaps 4 quarters; monthly+quarterly both summed) | Write-time period-exclusivity guard rejects a new/edited report that overlaps a different-cadence report for the same indicator/org; new DQ check surfaces pre-existing overlaps | None |
| **H3** | High | Workbook download silently emits full assigned set when no layout exists | Opt-in `WORKBOOK_REQUIRE_LAYOUT` setting makes downloads fail safely (409) when no active layout resolves; default off = 100% backward compatible | None |
| **H4** | High | Uncontrolled hard-delete of indicators with history | Same protection as C1; `retire`/`reactivate` actions added | None |
| **M6** | Medium | Reporting allowed into archived/completed projects | Aggregate write gate rejects submissions to `archived`/`completed` projects (draft/active still writable) | None |
| **H5** | High | No in-app "every reportable indicator has a target" check | Read-only `report_target_completeness` management command (missing/zero/duplicate/orphan) | None |
| **M10** | Medium | (Audit) "no derived-target circular-ref validation" | **Verified already implemented** (`analysis/services/target_dependencies.assert_valid_target_source`, enforced in `ProjectIndicatorSerializer.validate`): self-loops + cycles rejected at config time. Audit finding was a false positive — **no change needed**. | None |

**All changes are additive, backward-compatible, and require ZERO database migrations** (no model/schema changes — confirmed by `makemigrations --check` → "No changes detected").

---

## 2. Files changed

### New files
- `backend/core/lifecycle.py` — reporting-history delete-protection helpers (project/indicator/organisation).
- `backend/projects/management/commands/report_target_completeness.py` — read-only target-completeness report → CSV under `reports/`.
- `backend/aggregates/test_hardening.py` — 12 regression tests (delete-protection, project-status gate, period-overlap guard, retire).

### Modified files
- `backend/aggregates/views.py`
  - `_assert_write_scope`: reject submissions to `archived`/`completed` projects (M6).
  - `_period_overlap_conflict` + `_assert_no_period_overlap`: C2 exclusivity helpers.
  - `_upsert_pending_aggregate`: enforce period exclusivity (covers single/bulk/import writes).
  - `perform_update`: block edits that create an overlapping-cadence duplicate.
  - `import_reporting_workbook`: per-row overlap pre-check → clean per-indicator error (other rows still import).
  - `reporting_workbook` + `coordinator_workbook`: H3 fail-safe when `WORKBOOK_REQUIRE_LAYOUT` is on.
  - Added `ValidationError` import.
- `backend/projects/views.py` — `ProjectViewSet.destroy` guard + `archive`/`unarchive` actions (C1).
- `backend/indicators/views.py` — `IndicatorViewSet.destroy` guard + `retire`/`reactivate` actions (C1/H4).
- `backend/organizations/views.py` — `OrganizationViewSet.destroy` guard (C1).
- `backend/aggregates/data_quality.py` — new `CATEGORY_OVERLAP`.
- `backend/aggregates/data_quality_checks.py` — `run_overlap_checks` + wired into `run_all` (C2 detection).
- `backend/core/settings.py` — `WORKBOOK_REQUIRE_LAYOUT` (env-driven, default `False`).
- `frontend/app/(dashboard)/indicators/page.tsx` — delete handler now surfaces the server's block reason ("Cannot delete indicator: …") so the Phase-2 "clear validation message" reaches the user.

### Untouched (deliberately)
- `backend/aggregates/reporting_workbook.py` — the workbook contract.

---

## 3. Database migrations
**None.** No models changed. `python manage.py makemigrations --check --dry-run` → *No changes detected*. Deployment therefore carries **zero migration risk** and requires no schema change on the production DB.

---

## 4. New API / behaviour surface (backward-compatible)

| Endpoint | Before | After |
|---|---|---|
| `DELETE /api/manage/projects/{id}/` | cascade-deletes everything | **409** + reason when history exists; unchanged for empty projects |
| `DELETE /api/indicators/{id}/` | cascade-deletes | **409** + reason when history exists |
| `DELETE /api/organizations/{id}/` | cascade-deletes | **409** + reason when history exists |
| `POST /api/manage/projects/{id}/archive/` · `…/unarchive/` | — | new safe lifecycle actions |
| `POST /api/indicators/{id}/retire/` · `…/reactivate/` | — | new safe lifecycle actions |
| `POST /api/aggregates/` (+ bulk/import) | accepted overlaps; accepted into closed projects | **400** on overlapping cadence; **403** into archived/completed projects |
| `GET …/reporting-workbook`, `…/coordinator-workbook` | full set if no layout | **409** only when `WORKBOOK_REQUIRE_LAYOUT=true`; identical otherwise |

Existing valid requests behave exactly as before. No response shape of a successful call changed.

---

## 5. Risk assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| C2 guard rejects a *legitimate* second submission | Low | Only fires on genuinely overlapping periods for the **same** indicator/org; identical-period upsert and adjacent months are allowed. Import routes it to a per-row error, so the rest of the file still imports. |
| Existing production data already contains overlaps | Medium (historical) | Guard is write-time only — never mutates or deletes history. `run_overlap_checks` (DQ) surfaces existing overlaps as reviewable flags for data-owner cleanup. Rollup math is **unchanged** (deliberate: "do not alter historical reports"). |
| M6 blocks a workflow that legitimately writes to a closed project | Low | Only `archived`/`completed` are blocked; `draft`/`active` unaffected. Reversible via `unarchive`. |
| H3 fail-safe blocks downloads at go-live | None by default | Ships **off**. Enable only after every reporting coordinator has an active layout. |
| Frontend gets a 409 it didn't handle | Low | Client already maps `detail`→`error.message`; indicators page now displays it; other delete UIs degrade to a generic error toast (no crash). |
| Unmanaged `analysis_coordinatortarget` table absent in test DB | N/A (test infra) | Pre-existing; empty-project delete asserted at unit level instead of full API DELETE. |

**Overall residual risk: LOW.** No schema change, no workbook change, no historical-data mutation.

---

## 6. Remaining known issues (not in this pass)

1. **Read-time rollup dedup for *existing* overlapping data (C2 tail).** Deliberately deferred: silently changing historical displayed totals would violate "do not alter historical reports" and needs data-owner sign-off. Path: run `run_overlap_checks`, review flags, correct source data, then (optionally) enable a rollup-level dedup. New data is already protected.
2. **Delete-reason surfacing on the *project* and *organisation* delete UIs.** Backend returns the message; only the indicators page was updated to display it. Low effort to mirror.
3. **Target locking / carry-forward (M8), submission receipts (M12), reporting-entry discoverability (L16).** Governance/UX items from the audit — out of scope for this safety pass.
4. **Offsite backup activation** — operational, still `not_configured`; it is the only recovery path if a delete is ever forced. Must be actioned before national go-live independently of this branch.

---

## 7. Deployment checklist (for the single controlled deploy — AFTER approval)

Pre-deploy:
- [ ] Review this branch diff; confirm no Codex WIP was swept in (`git diff --stat`; the 8 modified files above are the whole set).
- [ ] Take a predeploy DB dump + tag a rollback image (standard runbook).
- [ ] Confirm `makemigrations --check` still "No changes detected" (no migration step required).

Backend (image rebuild required — logic is baked into the backend image):
- [ ] Build backend image from a **clean worktree** (exclude any concurrent WIP), `up -d --force-recreate backend`.
- [ ] Smoke test: `python manage.py check`; delete a test empty project (204) vs one with history (409); submit an overlapping period (400); submit to an archived project (403).
- [ ] Run `python manage.py report_target_completeness --project 3 --year 2026` and review the CSV before opening reporting.

Frontend (rebuild required for the indicators-page delete message):
- [ ] Build frontend image, `up -d --force-recreate` frontend.

Config (optional, staged):
- [ ] Leave `WORKBOOK_REQUIRE_LAYOUT` unset/`false` at first (backward compatible).
- [ ] After all reporting coordinators have an active layout, set `WORKBOOK_REQUIRE_LAYOUT=true` to enforce workbook-SSoT.

Post-deploy:
- [ ] Run the DQ suite (`aggregates.data_quality_checks.run_all`) to populate overlap flags; triage any existing overlaps with data owners.

---

## 8. Rollback plan

- **Zero migrations** ⇒ rollback is a pure image swap; no DB downgrade, no data reversal.
- Redeploy the previous backend/frontend images (`rollback_*` tags per the standard runbook) and `--force-recreate`.
- Unset `WORKBOOK_REQUIRE_LAYOUT` to instantly restore the old download behaviour without a redeploy.
- Git: `git checkout derived-targets-2026-07-03` (branch is local-only; nothing was pushed).
- No data was created, altered, or deleted by this change, so there is nothing to restore.

---

## 9. Production readiness assessment

| Certification blocker | Status after this pass |
|---|---|
| C1 destructive delete | **Closed** — history-protected; safe lifecycle actions added; tested |
| C2 mixed-cadence double count | **Closed for new data** (write guard + edit guard + import guard) · **detected for existing data** (DQ). Read-time rollup dedup for legacy overlaps deferred pending data-owner review. |
| H3 conditional workbook SSoT | **Closed (opt-in)** — safe-fail available; enable after layouts built |
| H4 indicator hard-delete | **Closed** |
| M6 reporting into closed projects | **Closed** |
| H5 target completeness | **Closed** — read-only report tool delivered |
| M10 circular derived targets | **Already covered** — verified, no change needed |

**Verification:** `manage.py check` clean · `makemigrations --check` clean · new suite 12/12 · `aggregates + indicators + organizations + projects` 279/279 · `analysis + uploads` 104/104 · frontend `tsc --noEmit` clean. (The printed `ProgrammingError: analysis_coordinatortarget` and `RuntimeError: smtp down` are pre-existing intentional test paths for unmanaged-table / SMTP-failure handling — suites report OK.)

**Recommendation:** With C1 and C2 (new-data) closed and H3/H5 delivered, the two certification hard-blockers are resolved offline. The branch is ready for a single controlled deployment after approval. Before national go-live, independently: (a) triage existing overlap DQ flags, (b) activate offsite backups, (c) once layouts are built, flip `WORKBOOK_REQUIRE_LAYOUT=true`.

**Nothing was deployed, merged, or pushed. Production database untouched.**
