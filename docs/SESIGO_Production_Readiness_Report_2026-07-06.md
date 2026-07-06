# SESIGO — Production Readiness Report (Final Pre-Deployment Verification)
**Date:** 2026-07-06
**Branch under verification:** `production-hardening-2026-07-06` (offline; NOT deployed)
**Verified against:** live production database (read-only) + full test suite

---

## 1. Executive Summary

SESIGO is **functionally, structurally and security-wise ready** for organisations to begin reporting. The full regression suite passes (519 backend tests, frontend lint + type-check clean), the live data is clean (zero duplicates/orphans), and the complete reporting workflow was exercised end-to-end against the live 2026/27 project (download → capture → import → approve → data-filled re-download → rollup) and passed.

**Verdict: GO — conditional on two operational actions**, neither of which is a code defect:
1. **Deploy the hardening branch** (backend + frontend image rebuild) — all the hardening/fix work is committed but not yet live.
2. **Activate offsite backups** before opening to all orgs — the only recovery path against accidental data loss.

There are **no unresolved Critical or High severity defects** affecting reporting, data integrity, security, or stability.

---

## 2. Issues Found

| # | Sev | Finding |
|---|-----|---------|
| F1 | Medium | **2026/27 targets largely unset:** 218 of 369 placed indicators (across 6 coordinators) have no real target (148 no row, 70 zero). Achievement % reads "no target" until values are loaded. Operational, not a code bug. |
| F2 | Low | 4 workbook-layout items point at deprecated/inactive indicators (auto-filtered from downloads, so harmless). |
| F3 | Low | 1 indicator has `canonical_indicator` set but `is_deprecated=False` (model-invariant drift; cosmetic). |
| F4 | High* | The entire hardening branch (delete-protection, mixed-cadence guard, coordinator scoping, upload notification, version gate) is **committed but not deployed** — so live still lacks these protections. *Severity is about deployment state, not a code defect. |
| F5 | Medium | Offsite backup still `not_configured`. |

---

## 3. Issues Fixed (this verification pass)

- **2 inactive placed indicators activated** (MBGE social-media reach + impressions) so they appear on MBGE's workbook — the only genuine "placed but not showing" cases. Live DB change, backed up (`activate_placed_indicators_backup_*.json`), audit-logged. Deprecated placed indicator deliberately left alone.
- **NAHPA 2025/26 double-counting removed earlier this session** (88 duplicate MAKGABANENG quarterly rows superseded by monthly; overlaps 37 → 0; reversible backup retained).
- **Upload confirmation** added: durable in-app "Report uploaded" notification to the submitter + an explicit OK-button acknowledgement dialog (branch).
- **L13 workbook version gate** (branch): a newer breaking workbook format is now rejected on import instead of mis-parsed.

---

## 4. Remaining Risks

| Risk | Sev | Root cause | Business impact | Technical impact | Recommended action |
|---|---|---|---|---|---|
| Hardening not live (F4) | High (state) | Branch not deployed | Live still allows cascade-delete + mixed-cadence double-count | Needs backend+frontend rebuild | Deploy the branch (single controlled release) |
| 2026/27 targets unset (F1) | Medium | Target values not yet loaded | Achievement tracking blank for 59% of placed indicators | None (data-only) | Load real target values from the source workbook before opening reporting |
| Offsite backup off (F5) | Medium | Not configured | No recovery if a delete is forced | None | Activate offsite backup (runbook exists) |
| Deprecated/flag drift (F2/F3) | Low | Legacy data | None (auto-filtered) | Cosmetic | Optional cleanup post-launch |

---

## 5. Test Results

| Suite | Result |
|---|---|
| Backend full suite | **519 passed** (421s), 0 failures |
| Frontend ESLint | **clean** (exit 0) |
| Frontend `tsc --noEmit` | **clean** |
| Django `manage.py check` | **0 issues** |
| Django `check --deploy` | **0 issues** (SSL/secure headers configured) |
| `makemigrations --check` | **No changes** (zero migrations to deploy) |
| Unapplied migrations on prod | **0** |
| Hardening regression suite | 14/14 (delete-protection, overlap guard, project-status, M7) |
| End-to-end reporting flow (2026/27, live) | **PASS** — round-trip verified, test data removed |

*(Benign known test noise: an intentional `DatabaseError` path for the unmanaged `analysis_coordinatortarget` table and an `smtp down` mock — suites report OK.)*

---

## 6. Performance Summary

- **Coordinator rollups** are batched (one scope resolution + one aggregate query per batch — O(1), not N+1).
- Handles the current live volume comfortably: **15,593 aggregates** (15,531 approved), 4,920 targets, 96 orgs.
- Aggregate suite (133 tests incl. heavy workbook gen/parse) runs in ~78s; full suite 7 min.
- Watch item (non-blocking): the rollup loads overlapping approved aggregates into memory — fine now, monitor as multi-year volume grows.

---

## 7. Security Summary

- **Org + project isolation** enforced server-side (`get_queryset` gates non-admins by assigned projects + org scope; verified an admin sees all, a coordinator user is scoped to their subtree).
- **Write authorisation** requires role + training/live boundary + org-in-project + indicator-assignment before any write (`_assert_write_scope`); scope alone never authorises a write.
- **Training/Live isolation** via signed JWT `mode` claim (not client-controllable).
- **Approval** reserved to manager/admin, enforced server-side, audit-logged.
- **File upload** allow-list + size cap + nosniff.
- **Coordinator dropdown leak fixed** (branch): a coordinator M&E officer now sees only their own coordinator, not all — matching what the backend already enforced.
- **Audit logging** on create/update/approve/reject/flag/delete/activate.

No auth bypass, no cross-org data leak found.

---

## 8. Data Integrity Summary

Live audit (read-only):
- **Duplicates: 0** — ProjectIndicator, ProjectOrganization, Assignment, CoordinatorTarget, Aggregate natural key all unique.
- **Orphans: 0** — 0 aggregates without a ProjectIndicator link, 0 orphan AggregateFact rows, 0 non-admin users without an org, 0 projects without organisations.
- **Referential health:** 0 deprecated-without-canonical; 6 active coordinators ↔ 6 active live layouts (consistent).
- Minor: F2 (4 layout→deprecated/inactive, auto-filtered) and F3 (1 canonical flag drift). Non-blocking.

---

## 9. Deployment Checklist

- [x] Tests passed (519 backend / lint / tsc / e2e)
- [x] Django + deploy checks clean
- [x] Zero migrations to apply (verified)
- [x] Data integrity verified (no dup/orphan)
- [x] End-to-end reporting flow verified on live 2026/27
- [ ] **Predeploy DB dump + rollback image tags** (do at deploy time)
- [ ] **Build backend image from a clean worktree** → `up -d --force-recreate backend`
- [ ] **Build frontend image** → `up -d --force-recreate frontend`
- [ ] Post-deploy smoke: delete-with-history → 409; overlapping-period submit → 400; archived-project submit → 403; upload → OK dialog + notification
- [ ] **Activate offsite backup**
- [ ] (Optional, staged) set `WORKBOOK_REQUIRE_LAYOUT=true` once all coordinators have layouts (all 6 already do)
- [ ] Load 2026/27 target values before opening reporting

---

## 10. Rollback Checklist

- **Zero migrations** ⇒ rollback = pure image swap; no DB downgrade, no data reversal.
- Redeploy previous `rollback_*` backend/frontend images + `--force-recreate`.
- `WORKBOOK_REQUIRE_LAYOUT` can be unset instantly (no redeploy) to restore old download behaviour.
- Git: `git checkout derived-targets-2026-07-03` (branch is local-only; nothing pushed).
- Live data changes made this session are individually reversible from JSON backups (NAHPA overlap rows; activated-indicator state).

---

## 11. Go / No-Go Recommendation

**GO for deployment**, conditional on the two operational steps below — there are **no unresolved Critical/High code defects**.

Before opening 2026/27 to all organisations:
1. **Deploy the hardening branch** (backend + frontend rebuild; zero migrations).
2. **Activate offsite backups.**
3. **Load 2026/27 target values** (so achievement tracking is meaningful).

The system is stable, secure, internally consistent, and the reporting workflow is verified working end-to-end. Certified production-ready pending the operational actions above.
