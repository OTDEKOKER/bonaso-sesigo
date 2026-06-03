/**
 * Local offline data store (DHIS2 Tracker Capture style).
 *
 * Persists the "offline package" downloaded from GET /api/offline/bootstrap/ in
 * IndexedDB so the app can render forms, project/indicator/org metadata and the
 * worker's assigned respondents with no network. Captured data still flows
 * through the existing offline mutation queue (lib/offline/mutation-queue.ts);
 * this store holds the *reference data* needed to capture it.
 *
 * The store is keyed by mode ("live" | "training") so a training download can
 * never overwrite the live package and vice-versa.
 */

import { api } from '@/lib/api/client';
import { isTrainingMode } from '@/lib/training-mode';

const DB_NAME = 'bonaso_offline_store';
const DB_VERSION = 1;
const STORE = 'packages';

export interface OfflinePackage {
  downloaded_at: string;
  mode: 'live' | 'training' | 'all';
  profile: Record<string, unknown>;
  organization: Record<string, unknown> | null;
  coordinator_organizations: Array<Record<string, unknown>>;
  sub_grantees: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  assignments: Array<Record<string, unknown>>;
  indicators: Array<Record<string, unknown>>;
  forms: Array<Record<string, unknown>>;
  target_groups: string[];
  districts: string[];
  localities: string[];
  respondents: Array<Record<string, unknown>>;
  counts: Record<string, number>;
}

interface StoredPackage {
  key: string; // "live" | "training"
  storedAt: number;
  pkg: OfflinePackage;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function currentKey(): 'live' | 'training' {
  return isTrainingMode() ? 'training' : 'live';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open offline store'));
  });
}

async function put(record: StoredPackage): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function get(key: string): Promise<StoredPackage | undefined> {
  const db = await openDb();
  const result = await new Promise<StoredPackage | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as StoredPackage | undefined);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return result;
}

/**
 * Download the offline package for the current mode and persist it locally.
 * Returns the package, or throws if offline / unauthenticated.
 */
export async function downloadOfflinePackage(): Promise<OfflinePackage> {
  const res = await api.get<OfflinePackage>('/offline/bootstrap/');
  const pkg = (res as { data?: OfflinePackage }).data ?? (res as unknown as OfflinePackage);
  if (isBrowser()) {
    await put({ key: currentKey(), storedAt: Date.now(), pkg });
  }
  return pkg;
}

/** Read the locally-stored package for the current mode (null if none). */
export async function getOfflinePackage(): Promise<OfflinePackage | null> {
  if (!isBrowser()) return null;
  try {
    const rec = await get(currentKey());
    return rec?.pkg ?? null;
  } catch {
    return null;
  }
}

/** When was the current-mode package last downloaded? (ms epoch or null) */
export async function getOfflinePackageAge(): Promise<number | null> {
  if (!isBrowser()) return null;
  try {
    const rec = await get(currentKey());
    return rec?.storedAt ?? null;
  } catch {
    return null;
  }
}

/** Remove stored packages (called on logout alongside the cache purge). */
export async function clearOfflinePackages(): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* best effort */
  }
}
