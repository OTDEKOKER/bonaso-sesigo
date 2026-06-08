# LOGIN SECURITY REPORT (P2 / audit SEC-1)

## Problem
Authentication endpoints had no brute-force / credential-stuffing protection.
Only the public `event_checkin` scope was throttled; the login, token-refresh and
password-reset endpoints accepted unlimited attempts. Live test pre-fix: 8 rapid
bad logins → 8×401, never a 429.

## Fix
DRF `ScopedRateThrottle` applied to the three auth surfaces.

### Rates (`backend/core/settings.py`, env-overridable)
| Scope | Endpoint | Default | Env override |
|---|---|---|---|
| `login` | `POST /api/users/request-token/` | **10/min/IP** | `THROTTLE_LOGIN` |
| `token_refresh` | `POST /api/users/token/refresh/` | **30/min/IP** | `THROTTLE_TOKEN_REFRESH` |
| `password_reset` | `POST /api/users/admin-reset-password/` | **5/hour** | `THROTTLE_PASSWORD_RESET` |

### Views (`backend/users/views.py`)
`CookieTokenObtainPairView`, `CookieTokenRefreshView`, `AdminResetPasswordView`
each set `throttle_classes = [ScopedRateThrottle]` + their `throttle_scope`.

### Correct client-IP attribution (critical)
The backend runs behind nginx on loopback, so `REMOTE_ADDR` is always
`127.0.0.1`. Without correction every client would share one throttle bucket
(one attacker could lock out everyone). Fixed with `REST_FRAMEWORK['NUM_PROXIES'] = 1`
(env `NUM_PROXIES`) so DRF reads the real client IP from the nginx-appended
`X-Forwarded-For` entry — and a spoofed XFF cannot bypass it.

### Worker-shared cache (critical)
Throttle counters must be shared across the 3 gunicorn workers, otherwise the
effective limit is 3×. Added a filesystem cache
(`CACHES['default'] = FileBasedCache @ /tmp/bonaso_cache`), shared by all workers
in the backend container, no Redis/DB-table needed. Override with
`CACHE_BACKEND`/`CACHE_LOCATION` for a Redis deployment.

## Tests (`backend/users/tests_throttle.py`)
| Test | Asserts |
|---|---|
| `test_repeated_failed_logins_eventually_return_429` | 401s then **429** within the window |
| `test_successful_login_within_limit_is_unaffected` | normal login still returns 200 + token |
| `test_throttle_bucket_is_per_client_ip` | one IP blocked (429) while a different IP still logs in (200) |

**Result:** `Ran 3 tests ... OK`. (Drives the genuinely-configured 10/min rate;
DRF binds throttle rates/cache at import, so the suite exercises the real limit.)

## Risk
Before: **High** (unthrottled login on a public rollout).
After: **Resolved** — successful logins unaffected; abusive bursts return 429,
attributed per real client IP, shared across workers.
