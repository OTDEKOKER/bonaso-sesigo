# SESIGO Infrastructure & Security Hardening — Apply / Verify / Rollback Runbook

Audit WS3. **Everything here is STAGED in the repo and NOT yet applied to the
live edge or containers.** Apply only after review, during a low-traffic window.
Each step is independently reversible.

Artefacts staged:
- `documentation/edge/sesigo-security-headers.conf` — edge security headers.
- `documentation/edge/sesigo-ratelimit.conf` — auth rate-limit zone (http context).
- `documentation/edge/sesigo.org.bw.hardened.conf` — full proposed site config.
- `documentation/edge/sesigo-www-redirect.conf` — www redirect (DNS/TLS-gated; do not apply yet).
- `frontend/compose.server.yaml` — container healthchecks + log rotation.
- `backend/core/health_views.py` + `/api/health/` — unauthenticated liveness/readiness probe.

---

## Part A — nginx security headers + rate limiting (edge)

These require an `nginx -t` + `systemctl reload nginx`. A reload is graceful (no
dropped connections). **No container restart is involved.**

### A1. Back up the current config
```bash
sudo cp /etc/nginx/sites-available/sesigo.org.bw \
        /etc/nginx/sites-available/sesigo.org.bw.bak.$(date +%Y%m%d_%H%M%S)
```

### A2. Install the snippets
```bash
sudo install -d /etc/nginx/snippets
sudo cp documentation/edge/sesigo-security-headers.conf /etc/nginx/snippets/
sudo cp documentation/edge/sesigo-ratelimit.conf        /etc/nginx/conf.d/
```

### A3. Apply the hardened site config
Option 1 (recommended): copy the reviewed hardened file over the live one:
```bash
sudo cp documentation/edge/sesigo.org.bw.hardened.conf /etc/nginx/sites-available/sesigo.org.bw
```
Option 2 (minimal): keep the live file and only add, inside the `listen 443` block,
`include /etc/nginx/snippets/sesigo-security-headers.conf;` plus the `limit_req`
lines on the two auth locations (see the hardened file for the exact lines).

### A4. Test BEFORE reloading (this catches every syntax/cert error)
```bash
sudo nginx -t
```
If `nginx -t` fails, fix or restore from the A1 backup; do NOT reload.

### A5. Reload
```bash
sudo systemctl reload nginx
```

### A6. Verify
```bash
curl -sSI https://sesigo.org.bw/            | grep -iE 'strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy'
curl -sSI https://sesigo.org.bw/api/health/ | grep -iE 'x-frame|x-content-type'   # single copy, not duplicated
# Rate limit backstop (should eventually 429 well ABOVE normal use, ~>30/min):
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code} " \
  -X POST https://sesigo.org.bw/api/users/request-token/ -d '{}' -H 'Content-Type: application/json'; done; echo
```
Confirm each header appears exactly ONCE and the app + login still work.

### A7. Rollback (if anything misbehaves)
```bash
sudo cp /etc/nginx/sites-available/sesigo.org.bw.bak.<timestamp> /etc/nginx/sites-available/sesigo.org.bw
sudo rm -f /etc/nginx/conf.d/sesigo-ratelimit.conf
sudo nginx -t && sudo systemctl reload nginx
```

---

## Part B — container healthchecks + log rotation

These take effect only when the containers are **recreated** with the updated
`compose.server.yaml` (a gated action — do it as part of the next planned deploy,
see the release procedure). No config here changes application behaviour.

### B1. What changes
- `backend`: healthcheck curls `/api/health/` (needs the backend image rebuilt so
  the endpoint exists); `unhealthy` shows in `docker ps` if Postgres is unreachable.
- `frontend`: healthcheck confirms Next.js is answering on :13000.
- both: json-file logging capped at 5 × 20 MB (bounds disk growth).

### B2. Apply (during the planned deploy)
```bash
cd /home/bonasoadmin/BONASOV1/frontend
docker compose -f compose.server.yaml build          # backend must rebuild for /api/health/
docker compose -f compose.server.yaml up -d           # recreates with healthcheck+logging
docker inspect --format '{{.State.Health.Status}}' frontend-backend-1
docker inspect --format '{{.State.Health.Status}}' frontend-frontend-1
```

### B3. Verify
```bash
curl -fsS http://127.0.0.1:18000/api/health/    # {"status":"ok","database":true}
docker ps --format 'table {{.Names}}\t{{.Status}}'   # STATUS shows (healthy)
```

### B4. Rollback
Healthcheck/logging are additive metadata; to revert, redeploy the previous image
tags (`rollback_confgate_20260724`) per the standard rollback procedure, or remove
the `healthcheck:`/`logging:` blocks and `up -d` again.

> Note: a healthcheck reports status but does not by itself restart an unhealthy
> container. `restart: unless-stopped` recovers a process that exits; for
> auto-restart-on-unhealthy add an autoheal sidecar (documented as a follow-up).

---

## Part C — www hostname (DO NOT apply yet)

`documentation/edge/sesigo-www-redirect.conf` is ready but blocked on two external
prerequisites, per the safety rule "do not enable a domain not correctly configured
in DNS and TLS":
1. a `www` DNS record at the registrar, and
2. the TLS certificate expanded to include the `www` SAN
   (`sudo certbot --expand -d sesigo.org.bw -d www.sesigo.org.bw`).
Only after BOTH exist, append that file's server blocks and reload.
