# SESIGO Assessment Remediation — 2026-07-31

Follow-up to the 2026-07-31 read-only production assessment. Tracks the fix status
of every non-offsite-backup finding.

## Done (verified)

### Recovery is now tested (was: never drill-tested)
Restored the nightly dump `bonasov1_db_20260731_000001.dump` (7.4 MB, custom
format) into a throwaway database on the live Postgres 18 cluster:
- Restore time: **36 s**, `pg_restore` exit 0.
- Row counts **exactly matched live**: facts 890,413 / aggregates 18,607 / orgs 105.
- Scratch DB dropped; live `bonasov1` never touched.
**Conclusion:** the nightly backup is complete and restorable. Re-run quarterly.

### Duplicate-named indicators — intentional, no action
The 6 duplicate indicator names each span **3–4 different projects** (per-project
indicator instances), i.e. the same metric legitimately defined in multiple
funder frameworks — not true duplicates. No merge required.

### Approved aggregates with null reviewer/creator — documented, no mutation
839 approved aggregates have `created_by_id IS NULL` (and no reviewer). All are
pre-launch **bulk imports/migrations** (NAHPA/BONEPWA/EOY loads), not workflow
bypasses. Left as-is deliberately: back-filling `created_by`/`reviewed_by` would
**fabricate** audit attribution. Treat "null creator" as "pre-launch import".

### nginx config now version-controlled
`deploy/nginx/sesigo.org.bw.conf` is the source-of-truth copy of the live site
(previously only in `/etc/nginx`). Includes the HSTS + X-Frame-Options hardening.

## Staged — needs sudo (run when convenient)

### 1. nginx security headers (HSTS + X-Frame-Options)
The frontend surface lacked `Strict-Transport-Security` and `X-Frame-Options`.
Apply the version-controlled hardened config:
```
bash deploy/nginx/apply-security-headers.sh
```
Backup + validate + auto-rollback + reload + header/regression verification are
built in. `X-Frame-Options: DENY` does not affect `/cso-mapping` embedding Kobo.

### 2. Enable pg_stat_statements (query observability)
Requires a Postgres **restart** (brief DB outage) — schedule a maintenance window.
```
# as postgres/root:
sudo -u postgres psql -c "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';"
sudo systemctl restart postgresql            # brief outage; backend will reconnect
sudo -u postgres psql -d bonasov1 -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
# then: SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 20;
```

### 3. Backend CSP config drift (cosmetic; report-only)
The frontend was rebuilt with `frame-src …kobotoolbox`; the backend container still
runs the older report-only CSP. Harmless, but to sync compose↔running, recreate the
backend during a quiet window (brief /api blip):
```
docker compose -f frontend/compose.server.yaml --project-directory frontend up -d --no-deps backend
```

## Owner / decision items (not code)

- **Kobo end-to-end test** — submit one real response via `/cso-mapping/questionnaire`,
  confirm it lands in the Kobo project, verify Annex 2/3/4 branching, then delete it.
  Gate this before distributing the survey link.
- **Support email** — confirm `info@bonaso.org` is the correct, monitored address.
- **Merge `feature/cso-mapping-2026-07-30`** — currently pushed-only by prior choice.
  Merge into the deploy branch to make the survey permanent in the deploy line.
- **H1 Offsite backup** — set `BONASO_OFFSITE_SSH_DEST`/`S3`/`RCLONE` (tracked separately).
- **H2 Host RAM** — capacity item; keep heavy jobs serialized until vRAM is added.
