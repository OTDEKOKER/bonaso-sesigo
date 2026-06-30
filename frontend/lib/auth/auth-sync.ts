/**
 * Cross-tab auth synchronisation.
 *
 * localStorage tokens are already shared across tabs of the same origin, but the
 * in-memory React auth state is not. So when one tab logs out (manually, via the
 * idle timeout, or on session expiry) the other tabs keep showing the dashboard
 * until they happen to make a request. This broadcasts the transition so every
 * tab reacts immediately.
 *
 * Uses BroadcastChannel where available (does not echo to the sender), falling
 * back to a localStorage `storage` event (which also only fires in OTHER tabs).
 * Exactly one mechanism is used per environment, so a handler never double-fires.
 */

export type AuthSyncEvent = 'logout' | 'login';

const CHANNEL_NAME = 'bonaso-auth-sync';
const FALLBACK_KEY = 'auth_sync_event';

function supportsBroadcastChannel(): boolean {
  return typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined';
}

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (!supportsBroadcastChannel()) return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      channel = null;
    }
  }
  return channel;
}

/** Notify other tabs that the auth state changed. No-op on the server. */
export function broadcastAuthEvent(event: AuthSyncEvent): void {
  if (typeof window === 'undefined') return;
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage({ event, at: Date.now() });
    } catch {
      /* channel closed — best effort */
    }
    return;
  }
  // Fallback: a value change fires `storage` in other tabs only. Stamp the time
  // so repeated identical events still register as a change.
  try {
    window.localStorage.setItem(FALLBACK_KEY, JSON.stringify({ event, at: Date.now() }));
  } catch {
    /* storage unavailable — best effort */
  }
}

/** Subscribe to auth events from other tabs. Returns an unsubscribe function. */
export function subscribeAuthEvents(handler: (event: AuthSyncEvent) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const ch = getChannel();
  if (ch) {
    const onMessage = (e: MessageEvent) => {
      const ev = (e?.data as { event?: AuthSyncEvent } | null)?.event;
      if (ev === 'logout' || ev === 'login') handler(ev);
    };
    ch.addEventListener('message', onMessage);
    return () => ch.removeEventListener('message', onMessage);
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key !== FALLBACK_KEY || !e.newValue) return;
    try {
      const ev = (JSON.parse(e.newValue) as { event?: AuthSyncEvent }).event;
      if (ev === 'logout' || ev === 'login') handler(ev);
    } catch {
      /* ignore corrupt payload */
    }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
