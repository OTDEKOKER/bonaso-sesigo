/**
 * Offline login (DHIS2 Tracker Capture style).
 *
 * A field worker must be able to open the app with no internet and keep
 * capturing. We never store the password. On a successful ONLINE login we store:
 *   - a PBKDF2-SHA256 verifier of the password (salted, 210k iterations), and
 *   - the JWT access/refresh tokens, encrypted with an AES-GCM key that is
 *     itself derived from the password (so the tokens are unreadable without it).
 *
 * Offline, the worker re-enters their password: we re-derive the key, verify it
 * against the stored verifier, and decrypt the tokens to restore the session.
 * On reconnect the app refreshes the token and replays the offline queue.
 *
 * Security notes:
 *   - Only a salted hash + encrypted tokens live on the device; the password
 *     and plaintext tokens never persist.
 *   - This is gated to the user's own device; pair it with device lock / MDM.
 *   - Cleared on logout (see clearOfflineCredential, wired into clearAuthTokens).
 */

const DB_NAME = 'bonaso_offline_auth';
const DB_VERSION = 1;
const STORE = 'credential';
const RECORD_KEY = 'current';
const PBKDF2_ITERATIONS = 210_000;

interface StoredCredential {
  key: string;
  username: string;
  salt: number[];
  verifier: number[]; // PBKDF2 bits used purely to verify the password
  iv: number[];
  cipher: number[]; // AES-GCM encrypted JSON { access, refresh, profile }
  createdAt: number;
}

export interface RestoredSession {
  access: string;
  refresh: string;
  profile: Record<string, unknown> | null;
}

function isSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'indexedDB' in window &&
    typeof crypto !== 'undefined' &&
    !!crypto.subtle
  );
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
    req.onerror = () => reject(req.error || new Error('offline-auth db open failed'));
  });
}

async function dbPut(rec: StoredCredential): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function dbGet(): Promise<StoredCredential | undefined> {
  const db = await openDb();
  const out = await new Promise<StoredCredential | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(RECORD_KEY);
    r.onsuccess = () => resolve(r.result as StoredCredential | undefined);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return out;
}

async function dbClear(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function buf(arr: number[]): Uint8Array {
  return new Uint8Array(arr);
}

async function deriveKeyMaterial(password: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ]);
}

async function deriveVerifier(material: CryptoKey, salt: Uint8Array): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    256,
  );
  return new Uint8Array(bits);
}

async function deriveAesKey(material: CryptoKey, salt: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Persist an offline credential after a successful online login.
 * Call with the password the user just authenticated with + the issued tokens.
 */
export async function saveOfflineCredential(
  username: string,
  password: string,
  tokens: { access: string; refresh: string; profile?: Record<string, unknown> | null },
): Promise<void> {
  if (!isSupported()) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await deriveKeyMaterial(password);
  const verifier = await deriveVerifier(material, salt);
  const aesKey = await deriveAesKey(material, salt);
  const payload = new TextEncoder().encode(
    JSON.stringify({ access: tokens.access, refresh: tokens.refresh, profile: tokens.profile ?? null }),
  );
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, aesKey, payload as BufferSource),
  );
  await dbPut({
    key: RECORD_KEY,
    username,
    salt: Array.from(salt),
    verifier: Array.from(verifier),
    iv: Array.from(iv),
    cipher: Array.from(cipher),
    createdAt: Date.now(),
  });
}

/** Is an offline credential available for offline login on this device? */
export async function hasOfflineCredential(): Promise<boolean> {
  if (!isSupported()) return false;
  try {
    return Boolean(await dbGet());
  } catch {
    return false;
  }
}

export async function getOfflineUsername(): Promise<string | null> {
  if (!isSupported()) return null;
  try {
    return (await dbGet())?.username ?? null;
  } catch {
    return null;
  }
}

/**
 * Attempt an offline login. Verifies the password against the stored verifier
 * and, on success, decrypts and returns the saved tokens to restore the session.
 * Returns null on wrong password / no credential.
 */
export async function offlineLogin(username: string, password: string): Promise<RestoredSession | null> {
  if (!isSupported()) return null;
  const rec = await dbGet();
  if (!rec || rec.username !== username) return null;

  const material = await deriveKeyMaterial(password);
  const salt = buf(rec.salt);
  const verifier = await deriveVerifier(material, salt);
  if (!timingSafeEqual(verifier, buf(rec.verifier))) return null;

  try {
    const aesKey = await deriveAesKey(material, salt);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(rec.iv) as BufferSource },
      aesKey,
      buf(rec.cipher) as BufferSource,
    );
    const json = JSON.parse(new TextDecoder().decode(plain));
    return { access: json.access, refresh: json.refresh, profile: json.profile ?? null };
  } catch {
    return null;
  }
}

/** Remove the stored offline credential (logout / "forget this device"). */
export async function clearOfflineCredential(): Promise<void> {
  if (!isSupported()) return;
  try {
    await dbClear();
  } catch {
    /* best effort */
  }
}
