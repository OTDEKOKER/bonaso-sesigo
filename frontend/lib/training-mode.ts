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
