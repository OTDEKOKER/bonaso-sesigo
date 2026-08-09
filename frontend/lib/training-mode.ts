/**
 * Sesigo Training Mode marker.
 *
 * The mode is persisted in BOTH localStorage (shared across tabs and survives a
 * refresh) and sessionStorage (kept for backward compatibility with existing
 * reads). Using localStorage means opening the app in a new tab while logged in
 * through Training Mode keeps the user in Training Mode instead of silently
 * dropping them into the Live System.
 *
 * Note: the URL remains the source of truth for which data a page requests
 * (see isTrainingModeRoute in lib/api/client.ts). This marker drives the route
 * guard and login redirects so the user is consistently kept on /training/*.
 */
const KEY = "sesigo_mode";
const TRAINING = "training";

export function isTrainingMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      localStorage.getItem(KEY) === TRAINING ||
      sessionStorage.getItem(KEY) === TRAINING
    );
  } catch {
    return false;
  }
}

export function setTrainingMode(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, TRAINING);
    sessionStorage.setItem(KEY, TRAINING);
  } catch {
    /* storage unavailable; ignore */
  }
}

export function clearTrainingMode(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable; ignore */
  }
}

/**
 * Routes that are NOT training-scoped. These modules (orgs, users, indicators,
 * settings, etc.) hold global/shared data with no training mirror under
 * /training/*. In Training Mode the sidebar links to them on their live path,
 * and the dashboard training-session guard must NOT rewrite them to /training/*
 * (doing so 404s — there is no /training/clients page). This list is the single
 * source of truth shared by the sidebar (toTrainingHref) and the layout guard.
 */
export const SHARED_ROUTE_PREFIXES = [
  "/organizations",
  "/users",
  "/indicators",
  "/settings",
  "/system-status",
  "/clients",
  "/social",
  "/messages",
  "/announcements",
  "/search",
  "/training",
  // CSO Mapping is a live-only module (real submissions + locations); it has no
  // training mirror, so its dashboard routes stay on their live path in Training
  // Mode instead of being rewritten to a non-existent /training/* page.
  "/cso-mapping-submissions",
  "/cso-mapping-map",
  "/cso-mapping-form-editor",
] as const;

/** True when `path` is (or is under) a shared, non-training-scoped route. */
export function isSharedLiveRoute(path: string): boolean {
  return SHARED_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}
