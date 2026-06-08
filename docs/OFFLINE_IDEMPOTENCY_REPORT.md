# OFFLINE IDEMPOTENCY REPORT (P4 / audit OFF-1)

## Problem
The offline client stamps every queueable mutation with an `X-Idempotency-Key`
and replays it until it receives a success. The backend **ignored** the header,
so a replay following a *lost ACK* (server committed, response lost on the
network) created a duplicate respondent / interaction / response.

> Note: `Aggregate` create was already largely duplicate-safe via an
> `update_or_create` natural key (indicator/project/org/period). The real
> exposure was the respondent flow, which inserts new rows on every POST.

## Fix — server-side idempotency
New app **`idempotency`** (`backend/idempotency/`):

- **`models.IdempotencyKey`** — `(user, key)` unique, stores `method, path,
  request_hash, status_code, response_body, completed`. Migration
  `0001_initial`.
- **`mixins.IdempotentMutationMixin`** — wraps `create()`:
  1. Reads `X-Idempotency-Key`; absent ⇒ behaves exactly as before (online path).
  2. **Atomically claims** `(user, key)` (unique constraint makes the claim safe
     across gunicorn workers; concurrent replays cannot both create the object).
  3. **Replay** of a completed key ⇒ returns the **original** status + body,
     no new write.
  4. Same key with a **different payload** ⇒ `422` (prevents wrong-response replay).
  5. In-flight duplicate (another worker still processing) ⇒ `409`.
  6. Only **successful (2xx)** responses are recorded; 4xx/5xx leave the key
     replayable so a corrected retry can still succeed.

### Applied to
`RespondentViewSet`, `InteractionViewSet`, `ResponseViewSet`
(`backend/respondents/views.py`) and `AggregateViewSet`
(`backend/aggregates/views.py`).

The frontend already sends `X-Idempotency-Key` and replays it
(`lib/api/client.ts`), so no client change is required — the header is now
honoured end-to-end.

## Validation — simulating success → lost ACK → replay
`backend/idempotency/tests.py`:

| Test | Asserts |
|---|---|
| `test_replayed_post_creates_single_record` | two identical POSTs (same key) ⇒ **one** Respondent row; replay returns the original id |
| `test_no_key_still_allows_creation` | online POST without a key works, no key row |
| `test_same_key_different_payload_is_rejected` | reused key + changed body ⇒ **422**, no second row |
| `test_failed_write_does_not_persist_key` | 400 leaves key replayable; corrected retry then creates exactly one row |
| `test_key_is_scoped_per_user` | same key value from two users does not collide / leak |

**Result:** `Ran 5 tests ... OK`.

## Risk
Before: **High** (latent duplicate records once offline field capture is enabled).
After: **Resolved** — a replayed mutation creates at most one record and returns
the original response.
