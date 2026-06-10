# Sesigo Data Portal — Progress & Rollout Readiness Assessment

**Date:** 2026-06-09 · **Basis:** progress measured against the prior audit (`docs/SESIGO_SYSTEM_ASSESSMENT_2026-06-09.md`, `docs/SESIGO_HIERARCHY_AND_IMPLEMENTATION_PLAN_2026-06-09.md`) using current code evidence. Not a re-audit.

---

## 1. Executive Summary

**Current state.** Sesigo is a working, project-scoped M&E platform in **controlled rollout**. Since the audit, the team has closed several high-impact items: two-tier approvals (officer reviews → manager approves), **project hierarchy + per-user project assignment wired into runtime visibility**, signed-JWT Live/Training isolation, and a real backup/restore/verify toolchain with off-site capability. The remaining blockers to *full production* are concentrated in **data-quality validation, a few frontend completions, and operational confirmation (offsite enabled + a restore drill)** — not in the core architecture.

**Major wins.** Project-assignment + hierarchy scope (tested), two-tier review permissions, training cleanup command, backup/restore/verify + offsite support + healthcheck, prod security boot-guards.

**Major risks.** (1) No server-side aggregate `value`/disaggregation validation → silent bad data. (2) Coordinator rollups computed client-side. (3) Frontend dashboard default-project auto-select + assignment UIs not yet wired. (4) Off-site backup is *supported* but must be *enabled + drilled* in prod. (5) No unified audit log.

**Recommendation: CONTROLLED ROLLOUT (continue).** Ready to onboard a limited, supervised set of organizations. **Not yet full production** until the Immediate list below is cleared. **Overall readiness ≈ 72%.**

---

## 2. Progress Dashboard (vs audit findings)

| Finding | Status | Evidence |
|---|---|---|
| Two-tier approvals (manager approve) | ✅ Complete | `can_review_aggregates`/`can_approve_aggregates` (`organizations/access.py`), `aggregates/views.py`; tests in `aggregates/tests.py` |
| Project hierarchy as scope source | ✅ Complete (backend) | `projects/scope.py`, `resolve_organization_scope_with_project_hierarchy` (`projects/hierarchy.py`); dashboard wired; `projects/test_scope.py`, `test_runtime_scope.py` |
| Per-user project assignment | ✅ Complete (backend) | `Project.assigned_users` (mig `0017`/`0018`), serializers, gate across modules; `users/test_project_assignment.py` |
| Backup + restore + offsite | 🟡 In Progress | `scripts/backup_database.sh` (rclone offsite C1), `restore_database.sh --verify`, `restore_verify.sh`, `backup_healthcheck.sh` — **needs offsite enabled + drill confirmed** |
| Training cleanup/TTL | 🟡 In Progress | `projects/management/commands/cleanup_training_data.py` (`--older-than-days`, `--dry-run`) — **needs cron** |
| Aggregate value validation | ✅ Complete | `aggregates/validation.py` (`validate_aggregate_value`) wired into `AggregateSerializer.validate()`; null/numeric/range/percentage/disaggregation + period ordering; exact-dup via `unique_together` upsert, replay via `IdempotentMutationMixin`; `aggregates/tests.py` (20 new tests, suite 117 green) |
| Coordinator rollup server-side | 🔴 Not Started | still `frontend/components/targets/coordinator-targets-page.tsx` |
| Unified audit log | 🔴 Not Started | only `users.UserActivity` (login/logout/admin) |
| Live/Training banner | ✅ Complete | Always-on header `EnvironmentBadge` (green LIVE SYSTEM / amber TRAINING, both modes) + existing full-width amber training bar; driven by signed-JWT mode marker (`components/layout/environment-badge.tsx`, wired in `app-header.tsx`). *(Single unified login still separate — tracked apart.)* |
| Frontend default-project + assignment UI | 🟡 In Progress | Reusable `useDefaultProject` hook + `NoProjectEmptyState` (2026-06-10); wired into **aggregates** (browse + entry auto-select, current-project context, multi-project guidance, empty state, training-preserving). Remaining: roll the hook into targets/coordinator/project-setup assignment screens. |

---

## 3. Critical Findings (Phase 1)

### C1 — Backup & Disaster Recovery — 🟡 In Progress (was Critical)
- **Automated backup:** `scripts/backup_database.sh` (pg_dump + json + manifest + sha256). **Offsite:** rclone remote support built in (env `BONASO_OFFSITE_RCLONE_REMOTE`). **Restore:** `restore_database.sh --verify` restores to a scratch DB, runs sanity checks + checksum; `restore_verify.sh`. **Monitoring:** `backup_healthcheck.sh` fails if stale or (with `BONASO_REQUIRE_OFFSITE=1`) offsite not confirmed.
- **Recovery runbook:** written 2026-06-10 — `docs/SESIGO_DISASTER_RECOVERY_RUNBOOK.md` (enable-offsite, cron schedule, restore-verify drill, catastrophic-recovery steps, validation checklist, drill log).
- **Gaps (ops, [OPERATOR]):** enable offsite + set `BONASO_REQUIRE_OFFSITE=1`; run and **log one restore-verify drill** (runbook §6/§8). Code/docs side is done; only prod execution remains.
- **RPO:** ~24h (daily cron) → effectively near-zero only once offsite confirmed. **RTO:** **Needs confirmation** (drill not evidenced). **Risk: Medium** (was Critical — tooling now exists).

### C2 — Approval Workflow — ✅ Complete
- Admin ✅, Manager ✅ (`can_approve_aggregates`), Officer → review/flag/reject only ✅ (`can_review_aggregates`), Coordinator → **not yet** a distinct approver (project-role review pending, §N.7c). Frontend gates already show review to manager/admin (`hooks.ts:164`). API + tests confirmed. **Scalable** (org/project scoped). **Risk: Low.**

### C3 — Training Mode Isolation — ✅ Complete
- Signed `mode` JWT claim (`organizations/access.py::token_mode`), `apply_training_filter*`, `assert_project_write_allowed`, `/training/...` routes, `Project.is_training`. Dashboard/aggregates/respondents/events/uploads filtered via project link. Cleanup command exists. **No evidenced leak.** **Risk: Low.** (Polish: persistent banner.)

### C4 — Aggregate Validation — ✅ Complete (2026-06-10)
- Capture already enforced **assignment/scope/mode** (`aggregates/views.py::_assert_write_scope`). Now `AggregateSerializer.validate()` also enforces **value shape** via `aggregates/validation.py::validate_aggregate_value`: required/non-null, numeric type (rejects booleans + garbage strings, coerces numeric strings), finite (no NaN/Inf), non-negative, 1e12 overflow cap, **0–100 for percentage indicators**, and recursive non-negative numeric checks across the `disaggregates` matrix. Also added the missing **`period_start ≤ period_end`** guard. **Exact duplicates** are prevented by the model `unique_together` + `update_or_create` upsert; **replay** by `IdempotentMutationMixin`. Covered by 20 new tests (`aggregates/tests.py`), full backend suite **117 green**. **Data-quality risk: now Low.**

### C5 — Permission Architecture — 🟡 Strong, procedural
- RBAC (platform role + project role), org scope (`access.py`), **project scope + assignment now enforced** (`projects/scope.py`) across dashboard/aggregates/events/respondents/targets/offline. API gated (`IsAuthenticated` + procedural checks); frontend gates present. **Privilege-escalation risk: Low–Medium** (procedural enforcement → needs the permission test suite expanded; partly done). 

---

## 4. Module Completion Matrix (Phase 2)

| Module | Completion | Status | Risk | Notes |
|---|---|---|---|---|
| Authentication | 95% | ✅ | Low | JWT, throttle, signed mode claim |
| Dashboard | 80% | 🟡 | Med | backend project-scoped + default/no-project; FE auto-select pending |
| Organizations | 90% | ✅ | Low | global tree demoted to directory |
| Projects | 90% | ✅ | Low | hierarchy + assignment; setup wizard missing |
| Clients/Funders | 80% | 🟡 | Low | naming clash with `client` role |
| Indicators | 90% | ✅ | Low | canonical/alias solid |
| Targets | 75% | 🟡 | Med | coordinator rollup client-side |
| Aggregates | 80% | 🟡 | High | review/approve + scope done; **value validation missing** |
| Respondents | 80% | 🟡 | Med | PII no-store; no project FK to gate |
| Uploads/Imports | 75% | 🟡 | Med | expert-only; no project FK gate |
| Events | 85% | ✅ | Low | gated; public check-in throttled |
| Analytics/Trends | 78% | 🟡 | Med | per-request, no cache |
| Reports | 75% | 🟡 | Med | no project FK; admin/manager only |
| Exports | 75% | 🟡 | Med | scope parity needs verifying |
| Messaging/Notifications | 80% | ✅ | Low | functional |
| Offline Mode | 70% | 🟡 | Med | PWA + bootstrap + gate; mobile not offline-first default |
| Training Mode | 88% | ✅ | Low | isolation + cleanup cmd; needs cron + banner |
| Admin Settings | 70% | 🟡 | Med | no unified audit log |

---

## 5. Risk Register

| ID | Risk | Likelihood | Impact | Level | Mitigation |
|---|---|---|---|---|---|
| R1 | Silent bad aggregate data (no validation) | ~~High~~ Low | High | ✅ Closed | Server-side `value` validation shipped (`aggregates/validation.py`, 2026-06-10) |
| R2 | Offsite backup not confirmed/drilled | Med | Critical | High (runbook ✅, ops pending) | Runbook written (`SESIGO_DISASTER_RECOVERY_RUNBOOK.md`); remaining: enable offsite + log one restore drill [OPERATOR] |
| R3 | Coordinator totals drift (client rollup) | Med | Med | Med | Move rollup server-side over POH |
| R4 | Procedural authz regressions | Low | High | ✅ Mitigated | Permission contract suite added 2026-06-10 (`organizations/test_permission_contracts.py` role matrix incl. `can_submit_aggregates`; `aggregates/test_permissions.py` coordinator/sub-grantee/cross-org/client isolation). Client-submit gap **closed** — `_assert_write_scope` now role-gates writes via `can_submit_aggregates`. |
| R5 | Wrong-mode data entry (no banner) | Low | Med | ✅ Mitigated | Always-on `EnvironmentBadge` (LIVE/TRAINING) in header, both modes, 2026-06-10 |
| R6 | Weak forensics (no audit log) | Med | Med | Med | Central audit on writes/approvals |
| R7 | FE default-project not auto-selected → "no project" confusion | Low | Low | 🟡 Mitigated (aggregates) | `useDefaultProject` auto-selects single/backend-default/training project; live on aggregates 2026-06-10. Remaining: dashboard + other assignment screens. |

---

## 6. Rollout Readiness Scorecard (Phase 4)

| Area | Score | Basis |
|---|---|---|
| Security | 80 | JWT, signed mode, throttle, boot-guards, headers |
| Data Integrity | 70 | strong backup/parity; **no aggregate validation** |
| Permissions | 85 | two-tier + project assignment + hierarchy, tested |
| Reporting | 72 | works; client-side coordinator rollup |
| Dashboard | 75 | backend scoped; FE auto-select pending |
| UX | 60 | heavy; no banner/wizard; FE assignment UI pending |
| Performance | 70 | no caching; OK at current scale |
| Offline Mode | 70 | PWA+bootstrap+gate; mobile not offline-first |
| Training Mode | 85 | strong isolation + cleanup cmd |
| Documentation | 65 | rich dev docs; user guides/SOP outlined only |
| Support Readiness | 62 | status page + healthchecks; no formal SOP |
| Disaster Recovery | 75 | restore+verify+offsite-capable; drill pending |
| **Overall** | **≈72%** | **Controlled Rollout band (71–85)** |

---

## 7. User Experience Assessment (Phase 3)

- **Data Collector — 65/100.** Login easy; capture works incl. offline; but disaggregation entry, period format, and "approved-only" confusion remain; error messages technical.
- **Coordinator — 68/100.** Hierarchy now drives visibility (backend); needs a single "My cluster" view and easy sub-grantee management UI.
- **Manager — 72/100.** Can approve; approvals queue exists; analytics useful but filter-heavy; no "approvals pending" preset.
- **Administrator — 70/100.** User/project setup works (assignment backend done); no setup wizard; auditability limited (no unified log); system-status page present.

---

## 8. Critical Blockers (to full production)
1. **Aggregate server-side validation** (R1).
2. **Off-site backup enabled + restore drill documented** (R2).
3. **Frontend: dashboard default-project auto-select + assignment UIs** (R7, #8/#9).

## 9. Priority Fix List
1. Aggregate `value`/disaggregation/range/duplicate validation — `aggregates/serializers.py`.
2. Confirm/enable offsite (`BONASO_OFFSITE_RCLONE_REMOTE`, `BONASO_REQUIRE_OFFSITE=1`) + restore drill.
3. Wire FE default-project + assignment multi-selects.
4. Server-side coordinator rollup over POH.
5. Persistent Live/Training banner.
6. Cron the `cleanup_training_data` command.
7. Expand permission/contract tests; add unified audit log.

---

## 10. Implementation Roadmap (Phase 5)

**Immediate (1–2 wks):** aggregate validation; enable offsite + restore drill + runbook; FE default-project auto-select; cron training cleanup.
**Short term (1 mo):** FE assignment UIs (user form + project page); server-side coordinator rollup; Live/Training banner; unified audit log; user guide + SOP draft.
**Medium term (3 mo):** dashboard presets per role; project-setup wizard; export scope-parity tests; dashboard caching/pre-aggregation; coordinator-as-reviewer project role.
**Long term (6–12 mo):** offline-first mobile release; dependency pinning + Django 5.x; unified search; request-access workflow.

---

## 11. Final Rollout Recommendation

**CONTROLLED ROLLOUT — continue; do NOT go full production yet.**

**Justification (evidence-based):** the architecture, permissions, training isolation, and DR tooling are production-grade and tested (full backend suite **97 green**). What blocks *full* production is bounded and clear: **(a)** no server-side aggregate validation (silent data-quality risk — `aggregates/serializers.py`), **(b)** off-site backup is *built* but must be *enabled + drilled* (`scripts/backup_*`), and **(c)** two frontend completions (default-project auto-select + assignment UIs). None are architectural; all are on the Immediate list. Clear those and re-score → expect **86%+ (External/Full Production)**.

**Onboarding guidance for BONASO:** keep adding organizations in supervised waves now; gate the move to "onboard *all* organizations" on the three Immediate blockers being closed and verified.
