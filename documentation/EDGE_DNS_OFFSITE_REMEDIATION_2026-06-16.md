# Edge / DNS / Off-site Backup Remediation (2026-06-16)

These are the non-code rollout conditions. Each item below has the diagnostic
evidence captured on 2026-06-16 and the exact action required.

---

## B) Public edge redirects to `:445` — UPSTREAM device, NOT app NGINX

### Evidence

Host NGINX (`/etc/nginx/sites-enabled/sesigo.org.bw`) is correct:

```
listen 80;  server_name sesigo.org.bw;
return 301 https://$host$request_uri;     # -> https://sesigo.org.bw/  (NO port)
listen 443 ssl http2;                     # proxies to 127.0.0.1:18000 (api/admin/static/media) and 127.0.0.1:13000 (frontend)
```

But the public response adds `:445`:

```
$ curl -I http://sesigo.org.bw
HTTP/1.1 301 Moved Permanently
Location: https://sesigo.org.bw:445/

$ curl -I http://38.51.241.67 -H "Host: sesigo.org.bw"
HTTP/1.1 301 Moved Permanently
Location: https://sesigo.org.bw:445/
```

The host's own NGINX never emits `:445` (it uses `$host` with no port). The
`:445` is therefore injected by an **upstream firewall / NAT / reverse-proxy /
load-balancer (e.g. pfSense)** sitting in front of this host. (Confirmed further
by the known NAT-hairpin behaviour: requests from the host to its own public IP
are intercepted by that same upstream device.)

### Exact instruction for the network / hosting team

1. Remove the rule that rewrites/redirects public HTTPS to port **445**.
2. Forward public **80 → 192.168.152.1:80** and **443 → 192.168.152.1:443**
   (the host running NGINX), preserving the original `Host` header.
3. Do **not** serve any alternate site (PHP / pfSense admin UI) on the public
   80/443 for `sesigo.org.bw`.
4. Verify from an external network:
   `curl -I http://sesigo.org.bw` → `Location: https://sesigo.org.bw/` (no port),
   then `curl -I https://sesigo.org.bw` → `200`.

---

## C) `www.sesigo.org.bw` DNS

### Evidence

```
$ dig +short sesigo.org.bw        -> 38.51.241.67     (correct)
$ dig +short www.sesigo.org.bw    -> (empty / no record)
```

### Required state

| Name | Type | Value |
|---|---|---|
| `sesigo.org.bw` | A | `38.51.241.67` (already correct) |
| `www.sesigo.org.bw` | CNAME | `sesigo.org.bw.`  (or A → `38.51.241.67`) |

Add the `www` record at the DNS registrar. After it resolves, ensure the host
NGINX `server_name` includes `www.sesigo.org.bw` (or 301s www → apex) and that
the TLS certificate covers both names.

---

## A) Off-site backup

### Current state

* Nightly local backups are **healthy**: cron `0 2 * * *`, dump verified with
  `pg_restore --list` (`verify_status: pg_restore_list_ok`), sha256 + asset
  tarball recorded, 30-day retention.
* `scripts/backup_database.sh` fully implements off-site replication
  (S3 / rclone / scp) but **no target env var is set**, so every run logs
  `offsite_status: not_configured` → LOCAL-ONLY.

### Activation (requires the operator's chosen destination + credentials)

Set **one** of these in the server's private `backend/.env` (placeholders are in
`backend/.env.production.example`; never commit real secrets):

```
BONASO_OFFSITE_S3_URI=s3://bonaso-backups/db          # needs aws CLI installed
# or
BONASO_OFFSITE_RCLONE_REMOTE=b2:bonaso-backups/db     # needs rclone configured
# or
BONASO_OFFSITE_SSH_DEST=backup@host:/srv/bonaso       # needs key-based ssh
```

Note: this host currently has only `scp` available (no `aws`/`rclone`), so the
SSH target is the zero-extra-install option.

### Verify one push

```
cd /home/bonasoadmin/BONASOV1/backend
set -a && source .env && set +a
bash scripts/backup_database.sh
tail -n 20 backups/database/backup.log     # expect: "Off-site status: scp_ok/s3_ok/rclone_ok"
cat backups/database/latest.json            # expect: "offsite_status" != "not_configured"
# confirm the dump now exists at the destination (aws s3 ls / rclone ls / ssh ls)
```

### Restore from an off-site backup

1. Retrieve the dump + manifest from the off-site target to a working dir.
2. Verify integrity:
   `sha256sum bonasov1_db_*.dump` must match `sha256` in the matching manifest.
   `pg_restore --list bonasov1_db_*.dump` must succeed.
3. Restore into a **fresh** database (never overwrite a running prod DB blindly):
   ```
   createdb bonaso_restore
   pg_restore --no-owner --clean --if-exists -d bonaso_restore bonasov1_db_*.dump
   ```
4. Restore assets: `tar xzf bonasov1_assets_*.tar.gz -C <app-root>` (media/, uploads/).
5. Point the app at the restored DB only after smoke-testing it.

See also `docs/SESIGO_DISASTER_RECOVERY_RUNBOOK.md` and
`docs/OFFSITE_BACKUP_RUNBOOK.md`.
