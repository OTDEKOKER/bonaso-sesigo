# RESPONSE WRITE SECURITY REPORT (P5 / audit SEC-2)

## Problem
`ResponseViewSet.perform_create()` validated that the indicator was assigned to
the respondent's organisation, but did **not** validate that the target
`interaction` belongs to an organisation the caller may access. Because object
ids are sequential and guessable, a non-admin could `POST /api/record/responses/`
with another organisation's `interaction` id and inject a response across the
org boundary (write-IDOR / cross-org data injection).

## Fix
`backend/respondents/views.py` — `ResponseViewSet.perform_create()` now mirrors
`InteractionViewSet.perform_create()`:

- Non-admins must have `interaction.respondent.organization_id` within their
  `get_user_organization_ids()` scope, else `403 PermissionDenied`.
- The Sesigo Training/Live boundary is enforced on the interaction's project via
  `assert_project_write_allowed`.
- Admins are unaffected (full scope).

```python
if not is_organization_admin(self.request.user):
    allowed_org_ids = set(get_user_organization_ids(self.request.user) or [])
    interaction_org_id = interaction.respondent.organization_id if interaction and interaction.respondent_id else None
    if interaction_org_id is None or interaction_org_id not in allowed_org_ids:
        raise PermissionDenied('You do not have permission to add responses to this interaction.')
if interaction is not None:
    assert_project_write_allowed(self.request, interaction.project)
```

## Tests (`backend/respondents/tests.py`)
| Test | Asserts |
|---|---|
| `test_officer_cannot_create_response_for_foreign_org_interaction` | 403 + 0 rows created |
| `test_officer_can_create_response_for_own_org_interaction` | 201, response created |
| `test_admin_can_create_response_for_any_interaction` | 201 (admin unaffected) |

**Result:** `Ran 3 tests ... OK`.

## Risk
Before: **Medium** (cross-org write; low live impact today — 0 responses in prod).
After: **Resolved** — cross-org response writes are rejected with 403.
