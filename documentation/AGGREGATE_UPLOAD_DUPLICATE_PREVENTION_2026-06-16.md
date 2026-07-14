# Aggregate Upload — Duplicate Prevention & Data Integrity (IMP-1)

**Date:** 2026-06-16
**Scope:** Aggregated data upload pipeline (reporting workbook import, bulk
create, single create, interaction-derived aggregates).
**Status:** Implemented + tested (`aggregates.test_reporting_workbook`).

---

## 1. Root-cause analysis

The aggregate model and write paths were already well-defended on paper:

- `Aggregate` has a **DB-level unique constraint** on its natural key
  `(indicator, project, organization, period_start, period_end)`
  (`unique_together`, migration `aggregates.0001`).
- Every server write path routes through `_upsert_pending_aggregate`, which
  calls `update_or_create` on that natural key.
- The analytics substrate (`AggregateFact`) is **fully derived** from
  `Aggregate` via a `post_save` rebuild (delete + recreate), so duplicate fact
  rows cannot exist independently and rollups cannot be double-counted.
- The offline sync queue is protected by `IdempotencyKey` / `X-Idempotency-Key`
  so a lost-ACK replay of the single-create endpoint returns the original
  response instead of creating a second row.

So **duplicate aggregate _rows_ were already structurally impossible.** The real
defects were in *idempotency* and *feedback*:

1. **Re-uploads failed validation and imported nothing (primary bug).**
   DRF auto-generates a `UniqueTogetherValidator` on `AggregateSerializer` from
   the model's `unique_together`. The import/bulk paths call
   `AggregateSerializer(data=…).is_valid()` per row. On a **second upload of a
   workbook**, every row whose natural key already existed was rejected at
   `is_valid()` with *"must make a unique set"*, pushed into `errors`, and
   **never reached the `update_or_create` upsert.** Net effect: the importer
   could only ever *create*; correcting/re-submitting data returned
   `400 No rows could be imported`. The intended idempotent "update in place"
   never ran.

2. **Identical re-uploads churned review state and spammed notifications.**
   `_upsert_pending_aggregate` unconditionally set `status='pending'`,
   `reviewed_at=None`, `reviewed_by=None` and re-fired the
   "submitted for review" notification — even when the incoming value was
   byte-identical to the stored one. A reviewed/approved record could be
   silently knocked back to `pending` by a duplicate submission, discarding the
   reviewer's decision.

3. **No created / updated / skipped / rejected feedback.**
   The import summary only reported `indicators_found / valid / failed`. Users
   had no way to see, before or after import, how many records would be
   created vs. overwritten — including whether an import would re-open an
   already-approved record.

4. **No file fingerprint.** Re-uploading the same file produced a fresh
   `Upload` + `ImportJob` with no signal that the file had been processed
   before — no audit linkage, no "you already uploaded this" warning.

5. **Intra-payload duplicates swallowed silently.** In `bulk_create`, the same
   indicator listed twice in one payload silently let the last row win with no
   trace.

---

## 1a. Permanent rule — approved programme data lifecycle

**Any real change to approved data automatically returns the record to
`Pending`, regardless of who makes it (including admins).** A prior approval
applies to the prior value only — never to a corrected value. There is
deliberately **no approval-preserving override.**

```
Pending → Reviewed → Approved → (value changed) → Pending → Re-reviewed/Re-approved
```

- "Real change" = the `value` changed, or any natural-key field
  (indicator / project / organization / period) changed.
- A *no-op* edit (notes only, identical value) preserves the existing status so
  an approved record is not pointlessly bounced.
- This rule is enforced **identically** across every write path — single create,
  direct edit (`perform_update`), `bulk_create`, workbook import, and the
  interaction-recompute path — because they all derive the reset/no-op decision
  from the same `_values_equal` comparison (`perform_update` inline; all others
  via `_upsert_pending_aggregate`).

## 2. Prevention strategy

Make the **DB unique constraint + the `update_or_create` upsert the single
source of truth** for uniqueness, and make every write path *idempotent and
self-reporting* on top of it:

- Remove the redundant, idempotency-breaking serializer-level
  `UniqueTogetherValidator`.
- Treat an identical re-submission as a **no-op** (preserve review state, no
  notification, no fact churn).
- Classify and report every row as **created / updated / unchanged /
  reset_from_review / rejected**, in both dry-run preview and real import.
- Fingerprint uploads (SHA-256) to detect and flag repeated files.

---

## 3. Database & application changes

### Database
- **`uploads.Upload.file_hash`** — `CharField(max_length=64, db_index=True)`,
  SHA-256 of file contents, populated in `Upload.save()` (streamed in chunks).
  Migration `uploads.0006_upload_file_hash`. *(No change to the aggregate
  schema; the existing `unique_together` DB constraint is retained as the hard
  backstop.)*

### Application
- **`AggregateSerializer.Meta.validators = []`** — drops the auto
  `UniqueTogetherValidator` so re-submissions reach the upsert. The DB
  constraint + upsert still guarantee no duplicate rows.
- **`_upsert_pending_aggregate`** now returns `(aggregate, outcome)` where
  `outcome ∈ {created, updated, unchanged, reset_from_review}` and **skips the
  write entirely when the payload is unchanged** (`skip_unchanged=True`). An
  unchanged identical re-upload therefore preserves `approved`/`reviewed`
  status and fires no notification. A *changed* re-upload of a reviewed/approved
  record still resets it to `pending` (correct M&E semantics) but is reported
  as `reset_from_review`.
- **`classify_upsert`** predicts the outcome without writing — powers dry-run.
- **`import_reporting_workbook`** dry-run returns
  `summary.to_create / to_update / unchanged / to_reset_from_review` plus a
  per-indicator `preview`; the real run returns
  `created / updated / unchanged / reset_from_review` +
  `reset_from_review_indicators`.
- **`bulk_create`** returns `created / updated / unchanged / reset_from_review`
  and `duplicate_indicators_in_payload`.
- **`Upload.prior_imported_upload()`** + the smart-import response flags
  `duplicate_file / previous_upload_id / previous_upload_name` when a file with
  the same fingerprint already completed an import.
- **`perform_update` (direct edit)** now applies the same lifecycle rule: it
  resets to `pending` only when the value or a key field actually changed
  (preserving approval on a no-op edit), instead of resetting unconditionally.

### Audit trail (centralised)
- **`_record_aggregate_change`** is the single audit hook for programme-data
  writes. `_upsert_pending_aggregate` and `perform_update` both call it, so
  **every** write path emits one `AuditEvent` per real change (no row for a
  no-op `unchanged` write) carrying:
  `action` (create/update) · actor (user) · `created_at` (timestamp) ·
  organization · project · and `metadata = { source, outcome, previous_status,
  new_status, old_value, new_value, indicator_id }`.
- `source ∈ { single_create, direct_edit, bulk_create, workbook_import,
  interaction_recompute }`. Previously only single-create and the review
  actions were audited; `bulk_create`, workbook import and direct edit had **no
  per-record audit row** — now they all do, with full before/after values.

---

## 4. Interrupted uploads, retries & concurrency

- **Concurrent / replayed single create:** `IdempotencyKey` claims `(user, key)`
  atomically (unique constraint) before the write, so concurrent replays cannot
  both create a row; the second returns the original response.
- **All upsert paths** are wrapped in `transaction.atomic()`; a failed batch
  rolls back wholesale, and a retry re-runs the idempotent upsert (created→
  unchanged on the second pass).
- **Background import worker** (`process_import_job`) and the
  `ImportJob.retry` action re-run the same idempotent import; re-running a
  completed import yields all-`unchanged` and writes nothing new.
- The DB unique constraint is the final guard against any race that slips past
  the application layer.

---

## 5. User-experience improvements

- **Dry-run preview** ("validate without writing") now answers *"what will this
  do?"*: counts of create / update / unchanged / **records that will be
  re-opened from a reviewed-or-approved state**, with a per-indicator list.
- **Post-import summary** reports the same breakdown, so an all-`unchanged`
  result is the explicit signal that "this file was already imported".
- **Duplicate-file warning** (`duplicate_file` + reference to the prior upload)
  when the identical file is uploaded again.

---

## 6. Automated test coverage

`aggregates/test_reporting_workbook.py`:
- `WorkbookDuplicatePreventionTests`
  - re-upload is idempotent — no duplicate rows, all `unchanged`;
  - re-upload preserves an `approved` status;
  - a *changed* re-upload resets a reviewed record and reports it
    (`reset_from_review`);
  - dry-run preview classifies each indicator and writes nothing.
- `BulkCreateDuplicateTests` — intra-payload duplicate reporting + identical
  resubmit counts as `unchanged`.
- `UploadFingerprintTests` — `file_hash` is populated; a re-uploaded identical
  file is flagged `duplicate_file` with `previous_upload_id`.
- `ApprovedDataLifecycleTests` — admin value-change resets approved→pending with
  a full `direct_edit` audit row (old/new value, prev/new status, actor); a
  no-op edit preserves approval; admin can re-approve after a correction;
  workbook import writes one `workbook_import` audit row per created record.

Full `aggregates` + `audit` + `uploads` suites pass (91 tests).

---

## 7. Operational guidelines

- **Correcting submitted data:** re-download the workbook (or use
  *Download Existing Data*), edit, and re-upload. The importer updates in place
  — it no longer errors on "duplicate" rows.
- **Reviewers:** watch the `reset_from_review` count/list in an import summary —
  it lists previously signed-off records re-opened by a corrected upload.
- **Updating approved data (any user, incl. admin):** edit the value (direct
  edit or re-upload corrected numbers) → the record returns to `Pending` →
  re-approve it. This is by design; there is no approval-preserving override.
  The change is fully captured in the audit stream (old/new value, prev/new
  status, user, time, source).
- **Backfilling `file_hash`:** existing `Upload` rows have an empty hash until
  next save; duplicate detection is forward-looking. Backfill is optional and
  can be scripted (`re-save` each Upload) if historical dedup is needed.
- **Rollback:** the only schema change is the additive, nullable/blank
  `file_hash` column (`uploads.0006`); reverting the migration and the code is
  safe and non-destructive.
