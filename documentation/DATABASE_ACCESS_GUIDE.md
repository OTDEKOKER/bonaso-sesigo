# Database Access Guide

How to connect to and work with the BONASO / Sesigo production database safely.

> **Golden rule:** this is the **live production database** for a piloted, rolled-out
> system. Reads are free. Every **write** is an outward-facing change — take a backup
> first, wrap it in a transaction, and verify before you `COMMIT`. When in doubt, don't.

---

## 1. What runs where

| | Production | Training / sandbox |
|---|---|---|
| Engine | PostgreSQL **18.3**, **host-native** (systemd `postgresql`) | PostgreSQL 18 in Docker (`postgres:18-alpine`) |
| Listens on | `127.0.0.1:5432` **loopback only** | container network only (`training-db:5432`) |
| DB / user | `bonasov1` / `bonasov1` | `${TRAINING_DB_*}` from training env |
| Container | *none* — backend uses `network_mode: host` and dials loopback | `bonasov1-training-training-db-1` |
| Credentials | `backend/.env` → `DATABASE_URL` | `training/` env file |

**Key points**

- The production DB is **not** in a container. The `frontend-backend-1` container is
  host-networked and connects to Postgres over `127.0.0.1:5432`.
- Postgres is **bound to loopback only** — there is no remote access by design. You must
  be on the host (SSH in as `bonasoadmin`) to reach it. This is why the off-site backup
  design has the on-prem Pentium **pull** a dump over a restricted SSH key rather than
  connecting to Postgres directly.
- The `bonasov1-training-training-db-1` container is the **separate training DB**. It is
  disposable and holds no production data — never point production tooling at it, and
  never confuse the two.

---

## 2. Connect

### A. Direct `psql` (fastest for read-only inspection)

```bash
# Uses the exact production credentials from backend/.env — no password in your history
psql "$(grep -oP 'DATABASE_URL=\K.*' /home/bonasoadmin/BONASOV1/backend/.env)"
```

You should land on the `bonasov1=>` prompt. One-off query without an interactive shell:

```bash
psql "$(grep -oP 'DATABASE_URL=\K.*' /home/bonasoadmin/BONASOV1/backend/.env)" -c '\dt'
```

### B. Django `dbshell` (same psql, via the app container)

```bash
docker exec -it frontend-backend-1 python manage.py dbshell
```

### C. Django ORM shell (safest for app-level logic — respects models/validation)

```bash
docker exec -it frontend-backend-1 python manage.py shell
```

```python
from indicators.models import Indicator
Indicator.objects.count()
```

> Prefer **B/C** for anything that touches app logic (signals, `pre_save`
> canonicalization guards, derived targets, etc.). Raw SQL bypasses all of it.

### Training DB (only when you actually mean the sandbox)

```bash
docker exec -it bonasov1-training-training-db-1 \
  psql -U "$TRAINING_DB_USER" -d "$TRAINING_DB_NAME"
```

---

## 3. psql cheat sheet

```
\l                 list databases            \dn      list schemas
\dt                list tables               \du      list roles/users
\dt+               tables with sizes         \d name  describe a table (cols/idx/FKs)
\dt users_*        tables by app prefix      \di      list indexes
\x                 expanded rows (wide data) \timing  show query durations
\o file            send output to a file     \q       quit
```

Django tables are named `<app>_<model>` (lowercased). Useful prefixes here:

```sql
\dt users_*         -- users_user, ...
\dt indicators_*    -- indicator catalog (shared global catalog)
\dt aggregates_*    -- aggregate facts, uploads, reporting control
\dt organizations_* -- orgs / hierarchy
\dt projects_*      -- projects, assignments
```

Peek at data:

```sql
SELECT count(*) FROM aggregates_aggregatefact;
SELECT * FROM users_user ORDER BY id DESC LIMIT 5;
```

---

## 4. Writing safely (do this every time)

**Step 1 — take a backup first.** The nightly cron writes to `backend/backups/database/`,
but before an ad-hoc write make a fresh one:

```bash
cd /home/bonasoadmin/BONASOV1/backend
bash scripts/backup_database.sh        # verified, checksummed custom-format dump
ls -t backups/database/*.dump | head -1 # note the file you just created
```

**Step 2 — wrap the change in a transaction** so you can inspect before committing:

```sql
BEGIN;

UPDATE aggregates_aggregatefact SET ... WHERE ...;   -- check the "UPDATE n" row count

SELECT ... ;   -- verify the affected rows look right

COMMIT;        -- or ROLLBACK; to undo everything in this transaction
```

**Step 3 — verify integrity afterwards.** Two guards run nightly; you can run them on
demand after a write:

```bash
cd /home/bonasoadmin/BONASOV1/frontend
docker compose -f compose.server.yaml exec -T backend python manage.py check_project_consistency
```

### Optional: a read-only session to prevent accidents

If you only intend to look, block writes for the session:

```sql
SET default_transaction_read_only = on;   -- any INSERT/UPDATE/DELETE now errors
```

---

## 5. Hard rules (host is memory-fragile — audit O1)

- **NEVER run concurrent heavy DB jobs.** This host has run out of memory and been
  OOM-killed (`EXIT 137`) under concurrent heavy work. Run big imports, `pg_dump`,
  parity checks, and restores **one at a time**, and avoid launching them alongside the
  nightly crons (backup `02:00`, parity `01:30`, consistency `02:15`, project
  consistency `03:30`).
- **Never blanket-rename or delete indicators** — the indicator catalog is a **shared
  global** catalog. A change for one coordinator affects everyone.
- **Never `TRUNCATE`/`DROP` or unqualified `DELETE`/`UPDATE`** (no `WHERE`) on the live
  DB. Test the `WHERE` with a `SELECT` first.
- **Never expose Postgres beyond loopback** (`listen_addresses`, `pg_hba.conf`,
  firewall). Remote access is intentionally disabled.
- **Don't put the DB password in scripts, tickets, or committed files.** Read it from
  `backend/.env` (as the connect commands above do).

---

## 6. Backup, restore & disaster recovery

- Nightly backup: `backend/scripts/backup_database.sh` (cron `0 2 * * *`) →
  `backend/backups/database/`, checksummed custom-format dumps, `latest.dump` /
  `latest.json`.
- Supervised restore: `python manage.py restore_backup` (validate in web UI, apply via
  CLI). See **BACKUP_ADMIN_GUIDE.md**.
- Full DR procedure and restore drill: **SESIGO_DISASTER_RECOVERY_RUNBOOK.md** and
  **SESIGO_DR_DRILL_CHECKLIST.md**.
- Off-site replication setup: **OFFSITE_BACKUP_RUNBOOK.md**.

Quick restore-readiness check (safe, read-only):

```bash
pg_restore --list /home/bonasoadmin/BONASOV1/backend/backups/database/latest.dump >/dev/null \
  && echo "dump readable"
```

---

## 7. Quick reference

```bash
# Connect (read/inspect)
psql "$(grep -oP 'DATABASE_URL=\K.*' /home/bonasoadmin/BONASOV1/backend/.env)"

# App-level shell
docker exec -it frontend-backend-1 python manage.py dbshell
docker exec -it frontend-backend-1 python manage.py shell

# Backup before any write
cd /home/bonasoadmin/BONASOV1/backend && bash scripts/backup_database.sh

# Service status
systemctl status postgresql
ss -ltnp | grep 5432        # should show 127.0.0.1:5432 only
```
