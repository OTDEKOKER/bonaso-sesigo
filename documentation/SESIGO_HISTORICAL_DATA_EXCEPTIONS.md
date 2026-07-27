# SESIGO Historical-Data Exception Handling (WS2)

How to inspect and (only when approved) remediate historical aggregate records
that predate current workflow rules — **safely, reversibly, and without ever
rewriting approved values or fabricating reviewer identities.**

## Principle
Historical production data is protected. We **classify and report** first; we do
not silently alter approved values, reviewer identities, project assignments or
organisation ownership. Any remediation is a separate, explicit, audited,
dry-run-by-default command.

## Step 1 — Classify (read-only, safe anytime)
```bash
cd backend
python manage.py audit_historical_exceptions                     # summary to stdout
python manage.py audit_historical_exceptions --json /tmp/x.json  # full per-row detail
python manage.py audit_historical_exceptions --csv  /tmp/x.csv
python manage.py audit_historical_exceptions --project 3         # scope to one project
```
This command **never writes** — no row changes, no audit events. It classifies
every aggregate into: `valid_current`, `valid_legacy`, `in_workflow`,
`missing_reviewer_metadata`, `missing_project_membership`,
`historical_hierarchy_exception`, `duplicate_candidate`, `requires_manual_review`,
`confirmed_invalid` (the last is never auto-assigned — reserved for a human).

### Current production findings (2026-07-27, read-only run)
| Classification | Count |
|---|---|
| valid_current | 755 |
| valid_legacy (bulk-migrated, benign) | 17,013 |
| **missing_reviewer_metadata** | **839** (803 NAHPA P2, 36 NSC P3) |
| missing_project_membership | 0 |
| historical_hierarchy_exception | 0 |
| duplicate_candidate | 0 |
| requires_manual_review | 0 |

**Interpretation:** the only exception is 839 approved rows that were loaded by
import/migration scripts and therefore lack a captured `reviewed_by`/`reviewed_at`
(and most lack `created_by`). The **values are correct** (reconciled against the
end-of-year source workbooks); what's missing is the *provenance trail*.

## Step 2 — Remediate provenance (only with sign-off; reversible; audited)
The existing W1 command stamps a provenance marker onto bulk-migrated rows —
**it changes no value, status, period, indicator, org or project**, only appends
a clearly-worded note and records ONE audit event. It is dry-run by default and
idempotent.
```bash
python manage.py backfill_migrated_provenance            # DRY RUN (report only)
python manage.py backfill_migrated_provenance --apply    # writes notes + 1 audit event
```
> We deliberately do **not** invent a human reviewer for these rows — fabricating
> a `reviewed_by` identity would be worse than an honest "migrated" marker. If a
> named sign-off is ever required for certification, an authorised Manager should
> re-approve the affected rows through the normal UI, which stamps their identity.

## Safety guarantees for any future remediation command
Dry-run default · clear record counts + identifiers · before/after values ·
transaction-safe · idempotent · JSON/CSV output · one audit event per run ·
never rewrites approved values, reviewer identities, assignments or ownership.

## Tests
`backend/aggregates/tests_historical_exceptions.py` proves each classification, the
read-only guarantee (no row mutation, no audit event), and that legacy exceptions
do **not** let a new record bypass the duplicate-prevention unique constraint.
