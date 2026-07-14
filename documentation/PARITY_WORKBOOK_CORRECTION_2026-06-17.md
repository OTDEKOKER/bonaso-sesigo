# Monthly Payload Parity — APSA Workbook Typo Correction & Comparator Fix (2026-06-17)

## Summary
The System Status board read **"problem"** because the latest monthly payload
parity report flagged **2 `payload_mismatch`es**: org **APSA**, indicator **366**
("Number of target specific demand creation activities conducted"), quarters
**Q3** and **Q4**, in project **NAHPA Social Contracting** (id 2).

Investigation showed **the database data was correct** — Q3 total 45 and Q4
total 33 matched the workbook exactly. The mismatch had two cosmetic causes,
both now fixed. **No production database records were changed.**

## Cause 1 — Source-workbook typos (data hygiene)
The source workbook `imports/End of year CBO Excel 2026/APSA NCD REPORT - APRIL 26.xlsx`
contained two misspelled activity-category labels that split a category into two:

| Sheet / cell | Before | After |
|---|---|---|
| `NOVEMBER!E82` | `Commemmorations` | `Commemorations` |
| `DECEMBER!E80` | `Street Interaction` | `Street Interactions` |

The importer had already consolidated these correctly in the DB
(`Commemorations` = 3+2 = 5; `Street Interactions` = 10+4 = 14), so this was a
source-file correction only.

- **How it was fixed:** surgical edit of the xlsx shared-strings part (full
  `<t>…</t>` element match, so `Street Interactions` was not affected). All 20
  sheets, formatting and charts preserved.
- **Pre-correction backup (durable):**
  `BONASOV1/backups/workbook_corrections/APSA_NCD_REPORT_APRIL26_pretypofix_20260617_002538.xlsx`
  (a temporary copy also exists under `/tmp` from the working session).

## Cause 2 — Parity comparator false positive (the real bug)
Indicator 366 counts **activities by type** and is **not age-disaggregated**.
The importer stores its breakdown under a generic `"Value"` leaf
(`{"Mall Activations": {"All": {"Value": 13}}}`), but the parity verifier
reconstructs the identical count under the organisation's single age band
(`{"Mall Activations": {"All": {"18-24": 13}}}`). That leaf-key difference
produced a false `payload_mismatch`.

- **Fix:** `backend/scripts/verify_monthly_payload_parity.py` —
  `normalize_for_compare` now collapses a **singleton** innermost age-band leaf
  to a sentinel, so `{"Value": n}` compares equal to `{"18-24": n}`. **Multi-band
  leaves (genuine age disaggregation) keep their keys**, so a real age-band
  mismatch still surfaces. Commit `260058eb`.
- **Regression test:** `backend/uploads/tests_parity_normalize.py` (runs in the
  standard suite via `python manage.py test uploads`). Covers the Value↔age-band
  equivalence, a full count-by-category payload, and the guard that multi-band /
  sex / category leaves are not collapsed.

## Verification
- Full parity re-run: **497 payloads compared, 0 mismatches** (was 2), exit 0.
- Fresh report written to the monitored dir: `reports/monthly_parity_checks/parity_20260617_004757.json`.
- Live `SystemStatusView` (as admin) returns `status: ok`, `warnings: []`
  (parity ok / backup ok / db ok).

## Deployment note
The nightly parity check runs from **host cron**
(`30 1 * * * cd .../backend && bash ./scripts/run_monthly_payload_parity_check.sh`)
using the host working copy and `reports/` is bind-mounted into the backend
container, so the fix is operationally live with **no container rebuild**. The
change is committed and pushed on branch `rollout-blockers-remediation-2026-06-05`.
