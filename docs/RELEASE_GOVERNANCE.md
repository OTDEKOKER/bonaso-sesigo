# SESIGO / BONASO — Release Governance

*Adopted 2026-06-24. Goal: there is never any uncertainty about what code is in production.*

## Branch model

| Branch | Purpose | Rule |
|---|---|---|
| `main` | **Production** — always equals what is deployed LIVE. | Only ever fast-forwarded to a verified, deployed commit. Tag each release. |
| `develop` | Integration — the next release is assembled and tested here. | Currently `data-quality-excellence-2026-06-23` plays this role; rename to `develop` when convenient. |
| `feature/*` | One change/feature in progress. | Branch from `develop`, PR back into `develop`. |
| `hotfix-*` | Urgent production fix off `main`. | Branch from `main`, deploy, then fast-forward `main` + merge back to `develop`. |

**Invariant:** the SHA at `main` == the SHA built into the running images. Verify with the fingerprint check below.

## Deploy procedure (verified — used for the 2026-06-24 parity deploy)

> ⚠️ `manage.py` on the host connects to the **LIVE** Postgres (via `backend/.env`). Never run `migrate`/`shell` writes against it from a non-production checkout. Read-only ops (`showmigrations`, fingerprints) are safe. Tests use an isolated `test_*` DB via `--keepdb`.

1. **Pre-flight:** run the test suite on the release branch (`--keepdb`); `manage.py check`; `makemigrations --check` (generate migrations manually if it would hit the live DB inconsistently).
2. **Identify the live baseline** (so a hotfix targets the right commit):
   ```sh
   docker compose -f frontend/compose.server.yaml exec -T backend md5sum /app/system_status/checks.py
   # compare to: git show <branch>:backend/system_status/checks.py | md5sum
   ```
3. **Backup + tag** (always):
   ```sh
   docker compose -f frontend/compose.server.yaml exec -T backend sh -c \
     'pg_dump "$(grep ^DATABASE_URL= /app/.env | cut -d= -f2-)" -Fc -f /app/backups/predeploy_<label>_<ts>.dump'
   git tag rollback_<ts> <current-live-commit>
   ```
4. **Check out the release commit** in the host tree (stash any unrelated WIP first).
5. **Build + recreate** (the entrypoint runs `migrate --noinput` on start):
   ```sh
   cd frontend
   docker compose -f compose.server.yaml build backend     # and/or frontend if FE changed
   docker compose -f compose.server.yaml up -d --no-deps --force-recreate backend
   ```
6. **Verify:** container `Up`; `showmigrations` shows the new migrations `[X]`; smoke-test the changed behaviour; check `/api` responds.
7. **Tag the release:** `git tag live-backend-<date> <commit>` and **fast-forward `main`**:
   ```sh
   git branch -f main <released-commit> && git push origin main --tags
   ```

## Rollback procedure

1. `git checkout rollback_<ts>` (the tag created in step 3).
2. Rebuild + force-recreate the backend (and frontend if it was changed).
3. Additive migrations applied by the new release are generally safe to leave (unused by old code). For a destructive migration, restore the predeploy dump:
   ```sh
   # validate on web / apply on CLI — see SESIGO_DISASTER_RECOVERY_RUNBOOK.md
   pg_restore --clean --if-exists -d "$DATABASE_URL" backups/predeploy_<label>_<ts>.dump
   ```

## Known gotchas (recorded from real deploys)
- **Cross-app migration deps:** a migration auto-generated on a branch can pin a dependency to a migration that isn't present on the deploy baseline (e.g. `aggregates/0007 → projects/0020`), causing `NodeNotFoundError` / `InconsistentMigrationHistory`. Pin to the lowest sufficient ancestor that exists LIVE.
- **Branches were local-only:** always `git push` after committing — offsite code backup. (Offsite DB backup must also be activated — see backup runbook.)
- **`--force-recreate` is required** for code changes to take effect (`--build` alone reused the old container in the past).

## Release checklist (copy per release)
- [ ] Tests green on release branch · `check` clean · migrations consistent
- [ ] Predeploy `pg_dump` taken · `rollback_<ts>` tag created
- [ ] Build + `--force-recreate` · migrations `[X]` · smoke test passed
- [ ] `live-backend-<date>` tag · `main` fast-forwarded + pushed
- [ ] Merge the released commit back into `develop`
