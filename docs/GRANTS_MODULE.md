# Grants (financial accounting) module

Per-organization grant/money accounting: coordinators receive grants and share
them with sub-grantees; every org records its own expenditure, and a coordinator
figure is the **subtree rollup** (its own grant + all its sub-grantees).

Deployed and **dark by default** (deny-by-default): nobody sees `/grants` until an
admin enables the `grants` module for them.

## Data model (`backend/grants/models.py`)
- **Grant** — one award to ONE org under ONE project: `project`, `organization`,
  optional `coordinator`/`funder`, `code`, `title`, `currency` (default BWP),
  `total_amount`, `start/end_date`, `status` (draft/active/suspended/closed).
- **GrantBudgetLine** — `category`, `budgeted_amount`.
- **GrantDisbursement** — money paid TO the org: `date`, `tranche`, `amount`.
- **GrantExpenditure** — money the org SPENT: `date`, `category`, `amount`,
  optional `supporting_document`.

Money is never stored aggregated — budget/disbursed/spent/burn are computed at
read time in `backend/grants/rollups.py` (single source of truth).

## Access (deny-by-default) — `backend/grants/permissions.py`
The `grants` module is NOT in any role default, so it is invisible until granted.
Tiers (once enabled): **admin** = full; **`grants` grant with `edit`** = finance
(read + write); **`grants` grant with `view`** = coordinator (read-only, narrowed
to their own project subtree).

### Enable it for a user
Users page → module permissions, or via shell:
```bash
docker exec frontend-backend-1 python manage.py shell -c "
from users.models import User, UserModulePermission
u = User.objects.get(username='THE_USERNAME')
UserModulePermission.objects.update_or_create(user=u, module='grants',
  defaults={'is_enabled': True, 'actions': ['view','create','edit','delete']})  # coordinator: ['view']
print('grants enabled for', u.username)"
```

## Scope (every viewset)
Four gates: deny-by-default access + training/live isolation (`apply_training_filter`)
+ project-assignment gate (`filter_queryset_by_assigned_projects`) + org/subtree
scope. A viewer only ever sees grants for their own orgs and assigned projects.

## API — `/api/grants/`
- `GET /api/grants/` — list (scoped); `POST`/`PATCH`/`DELETE` (finance/admin).
- `GET /api/grants/summary/?project=` — per-org awarded/disbursed/spent/remaining/
  burn + grand total.
- `GET /api/grants/quarterly/?project=&fy=` — expenditure by FY quarter (Botswana
  FY, Q1 = Apr–Jun), grouped/rolled up by coordinator.
- `/api/grants/{budget-lines,disbursements,expenditures}/` — child records.

## UI — `/grants`
KPI cards, awarded-vs-spent chart, per-org summary table, **quarterly coordinator
rollup** table (FY selector), grants list, detail dialog (add disbursement /
expenditure / budget line, edit, delete), New Grant form, CSV export.

## To reach 100% — cost-per-result (pending 1 decision)
Show spend efficiency (money ÷ results). Two things are needed:
1. **Designate the "results" indicator** (e.g. *Individuals reached*) — grant spend
   is per-org but achieved is per-indicator, so a denominator must be chosen.
2. **Scope-match spend and achieved.** The certified achieved SSoT
   (`analysis.services.coordinator_rollups.compute_actuals_for_specs`) resolves a
   coordinator to its WHOLE subtree. So compute cost-per-result at the
   **coordinator-rollup level** — *subtree spend ÷ subtree achieved* — (and at the
   leaf/sub-grantee level where achieved = that org alone). Do NOT divide a
   coordinator's OWN grant spend by subtree achieved — that understates cost.

Until designated, show nothing (never display a misleading figure).

## Rollback images (per deploy)
`frontend-backend/frontend:rollback-pre-grants-20260812`,
`frontend-frontend:rollback-pre-grantsui-20260813`. Prod branch `main`.
