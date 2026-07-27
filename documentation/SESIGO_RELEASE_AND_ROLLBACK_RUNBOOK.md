# SESIGO Release & Rollback Runbook

Safe, repeatable procedure for deploying a change and backing it out. Deploy only
after review; never deploy with failing tests or a red gate. Run during a
low-traffic window. **Deployment uses Docker Compose v2 (`docker compose`), not
v1 (`docker-compose`)** — the host has both.

Repo: `/home/bonasoadmin/BONASOV1` · Compose: `frontend/compose.server.yaml`
(host-networked backend `:18000` + frontend `:13000`, nginx terminates TLS).

---

## Pre-flight facts to record (every deploy)
```bash
cd /home/bonasoadmin/BONASOV1
git rev-parse --short HEAD                         # commit being deployed
git status --porcelain                             # should be clean (or intended)
docker images | grep -E 'frontend-(back|front)end' # current image ids (rollback point)
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```
Write down the **current** `frontend-backend:latest` and `frontend-frontend:latest`
image ids — that is your rollback point.

---

## Release procedure (gated — each gate must pass before the next)

1. **Database & service health.** Confirm a recent backup exists
   (`BACKUP_ADMIN_GUIDE.md`) and services are healthy:
   ```bash
   curl -fsS http://127.0.0.1:18000/api/health/     # {"status":"ok","database":true}
   free -h                                           # confirm RAM headroom before a build
   ```
   If free RAM is low, stop non-essential processes first (the host is memory-
   constrained; a Next build can OOM otherwise).

2. **Git status.** Working tree clean; on the intended commit; changelog/PR reviewed.

3. **Tests (backend).** Isolated SQLite, never the prod DB:
   ```bash
   cd backend
   env DATABASE_URL='' USE_POSTGRES=False DB_SSL_REQUIRE=False \
       DJANGO_SECRET_KEY=ci DEBUG=False venv/bin/python manage.py test
   env ... DEBUG=True venv/bin/python manage.py makemigrations --check --dry-run
   env ... venv/bin/python manage.py check
   ```
   All tests OK, no missing migrations, system check clean.

4. **Frontend build & checks.** Do this with RAM headroom (see step 1):
   ```bash
   cd ../frontend
   npx tsc --noEmit          # 0 errors
   npm run lint
   npm run test              # vitest
   npm run build             # production build MUST succeed before deploy
   ```

5. **Backend checks in the image context** (optional but recommended): build the
   backend image and run `manage.py check --deploy` inside it.

6. **Migration review.** List what will apply and read each new migration:
   ```bash
   docker compose -f compose.server.yaml run --rm backend python manage.py showmigrations | grep '\[ \]'
   ```
   Confirm every pending migration is **additive/reversible** — no column drops,
   no destructive data migrations. If a data migration is required, it must be
   reversible and backed up first.

7. **Build images.**
   ```bash
   cd frontend
   docker compose -f compose.server.yaml build
   ```

8. **Tag a rollback point, then restart in a controlled way.**
   ```bash
   docker tag frontend-backend:latest  frontend-backend:rollback_$(date +%Y%m%d_%H%M)
   docker tag frontend-frontend:latest frontend-frontend:rollback_$(date +%Y%m%d_%H%M)
   docker compose -f compose.server.yaml up -d      # recreates with new images
   ```
   Migrations run on container start via the entrypoint; watch the logs.

9. **Health checks.**
   ```bash
   docker ps --format 'table {{.Names}}\t{{.Status}}'      # (healthy)
   curl -fsS http://127.0.0.1:18000/api/health/
   docker inspect --format '{{.State.Health.Status}}' frontend-backend-1
   ```

10. **Smoke tests (through the edge).**
    ```bash
    curl -sSI https://sesigo.org.bw/                       # app loads
    curl -sS  https://sesigo.org.bw/api/health/            # ok
    ```
    Then in a browser: log in (live), open Dashboard, open Aggregates review
    queue, open Support, open a Funder Report. Confirm the change under test.

11. **Log review.**
    ```bash
    docker compose -f compose.server.yaml logs --tail=200 backend  | grep -iE 'error|traceback' || echo clean
    docker compose -f compose.server.yaml logs --tail=200 frontend | grep -iE 'error' || echo clean
    ```

12. **Announce done.** Record the deployed commit + new image ids.

### Deploy-abort conditions (do NOT proceed / roll back)
- Any failing test, missing migration, or a non-reversible/destructive migration.
- `/api/health/` not returning ok, or a container stuck not-healthy.
- Errors/tracebacks in logs after start, or a failed smoke test.
- RAM exhaustion during build (free the host and retry, don't force it).

---

## Rollback procedure

Fastest, safest rollback is to re-point the running services at the previous
images (no rebuild):

```bash
cd /home/bonasoadmin/BONASOV1/frontend
docker tag frontend-backend:rollback_<stamp>  frontend-backend:latest
docker tag frontend-frontend:rollback_<stamp> frontend-frontend:latest
docker compose -f compose.server.yaml up -d
curl -fsS http://127.0.0.1:18000/api/health/
```

- **If a migration must be undone:** restore from the pre-deploy backup using the
  supervised restore flow (`recovery`/`restore_backup` + `BACKUP_ADMIN_GUIDE.md`).
  Never hand-edit production tables. Only reverse a migration if it is genuinely
  reversible and you have a backup.
- **nginx/edge changes** roll back independently — see
  `SESIGO_INFRA_SECURITY_HARDENING_RUNBOOK.md` (restore the `.bak` site file,
  `nginx -t`, `systemctl reload nginx`).

Known-good rollback images currently on the host include
`frontend-backend:rollback_confgate_20260724` (`b1f1072f`) and
`frontend-frontend:rollback_confgate_20260724` (`b681d222`).
