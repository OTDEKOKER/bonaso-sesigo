/**
 * Centralized authentication / session timeout configuration.
 *
 * Single source of truth for every timeout in the auth + session lifecycle, so
 * the values stay consistent and can't drift apart across the context, the API
 * client and the idle-logout guard (production certification, Phase 3).
 *
 * Ordering invariant: the auth-load watchdog MUST be greater than a single
 * request/refresh leg so the per-request timeouts resolve first on a normal hang
 * and the watchdog only acts as a true backstop (e.g. when a 401 → refresh →
 * retry stacks two legs). Keep AUTH_REVALIDATE_TIMEOUT_MS > API_REQUEST_TIMEOUT_MS.
 */

/** Per-request hard cap inside `fetchWithAuth`. */
export const API_REQUEST_TIMEOUT_MS = 15_000;

/** Hard cap on the token-refresh request (it does not go through fetchWithAuth). */
export const REFRESH_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Backstop on the whole on-mount profile revalidation (cache adopt → /users/me,
 * incl. a possible 401 → refresh → retry). Set above the per-request timeouts so
 * those fire first on a single hang; this only bites the stacked/pathological case.
 */
export const AUTH_REVALIDATE_TIMEOUT_MS = 18_000;

/** Inactivity duration before automatic logout. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** How long before the idle logout the warning countdown is shown. */
export const IDLE_WARNING_MS = 60 * 1000;
