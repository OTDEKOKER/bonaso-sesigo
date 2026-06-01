const CACHE_VERSION = 'bonaso-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const API_CACHE = `${CACHE_VERSION}-api`;
const OFFLINE_PAGE = '/offline/';

const MUTATION_DB = 'bonaso-offline-db';
const MUTATION_STORE = 'mutation_queue';
const HISTORY_STORE = 'sync_history';
const MUTATION_DB_VERSION = 2;
const OFFLINE_SYNC_TAG = 'bonaso-sync-mutations';
let replayInFlight = null;

const SHELL_ASSETS = [
  '/',
  '/login/',
  '/dashboard/',
  OFFLINE_PAGE,
  '/favicon.ico',
  '/icon-dark-32x32.png',
  '/icon-light-32x32.png',
  '/apple-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        SHELL_ASSETS.map(async (asset) => {
          try {
            await cache.add(asset);
          } catch {
            // Ignore single-asset failures to keep installation resilient.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== API_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('network_and_cache_miss');
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const networkResponse = await networkPromise;
  return networkResponse || Response.error();
}

function openMutationDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) {
      reject(new Error('IndexedDB unavailable in service worker'));
      return;
    }

    const request = indexedDB.open(MUTATION_DB, MUTATION_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MUTATION_STORE)) {
        const store = db.createObjectStore(MUTATION_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        const historyStore = db.createObjectStore(HISTORY_STORE, { keyPath: 'id', autoIncrement: true });
        historyStore.createIndex('createdAt', 'createdAt', { unique: false });
        historyStore.createIndex('queueId', 'queueId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open mutation queue DB'));
  });
}

async function withMutationStore(storeName, mode, run) {
  const db = await openMutationDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);

    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error || new Error('Mutation queue transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Mutation queue transaction aborted'));

    run(store, resolve, reject);
  });
}

async function appendSyncHistory(entry) {
  try {
    await withMutationStore(HISTORY_STORE, 'readwrite', (store, resolve, reject) => {
      const request = store.add({
        ...entry,
        createdAt: Date.now(),
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to append sync history'));
    });
  } catch {
    // No-op.
  }
}

async function listQueuedMutations() {
  try {
    return await withMutationStore(MUTATION_STORE, 'readonly', (store, resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const items = request.result || [];
        items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        resolve(items);
      };
      request.onerror = () => reject(request.error || new Error('Failed to list queued mutations'));
    });
  } catch {
    return [];
  }
}

async function removeQueuedMutation(id) {
  try {
    await withMutationStore(MUTATION_STORE, 'readwrite', (store, resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to remove queued mutation'));
    });
  } catch {
    // No-op.
  }
}

async function countQueuedMutations() {
  try {
    return await withMutationStore(MUTATION_STORE, 'readonly', (store, resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error || new Error('Failed to count queued mutations'));
    });
  } catch {
    return 0;
  }
}

function isRetriableStatus(status) {
  return status >= 500 || [401, 403, 408, 425, 429].includes(status);
}

function normalizeHeaders(headersLike) {
  const headers = new Headers(headersLike || {});
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

async function notifyClients(payload) {
  try {
    const allClients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const client of allClients) {
      client.postMessage({ type: 'OFFLINE_SYNC_UPDATE', ...payload });
    }
  } catch {
    // No-op.
  }
}

async function replayQueuedMutations() {
  if (replayInFlight) {
    return replayInFlight;
  }

  replayInFlight = (async () => {
    const queue = await listQueuedMutations();
    let processed = 0;
    let historyUpdated = false;

    for (const item of queue) {
      if (!item?.id || !item?.url || !item?.method) continue;

      try {
        const response = await fetch(item.url, {
          method: item.method,
          headers: normalizeHeaders(item.headers),
          body: item.body,
        });

        if (response.ok) {
          await removeQueuedMutation(item.id);
          await appendSyncHistory({
            queueId: item.id,
            url: item.url,
            method: item.method,
            status: 'synced',
            httpStatus: response.status,
            message: 'Successfully synced in service worker',
          });
          processed += 1;
          historyUpdated = true;
          continue;
        }

        if (!isRetriableStatus(response.status)) {
          await removeQueuedMutation(item.id);
          await appendSyncHistory({
            queueId: item.id,
            url: item.url,
            method: item.method,
            status: 'dropped',
            httpStatus: response.status,
            message: 'Dropped after non-retriable response in service worker',
          });
          processed += 1;
          historyUpdated = true;
          continue;
        }

        await appendSyncHistory({
          queueId: item.id,
          url: item.url,
          method: item.method,
          status: 'failed',
          httpStatus: response.status,
          message: 'Retriable server error in service worker, will retry',
        });
        historyUpdated = true;
        break;
      } catch {
        await appendSyncHistory({
          queueId: item.id,
          url: item.url,
          method: item.method,
          status: 'failed',
          message: 'Network error during service worker replay, will retry',
        });
        historyUpdated = true;
        break;
      }
    }

    const pending = await countQueuedMutations();
    await notifyClients({ pending, processed, historyUpdated });
    return { pending, processed };
  })();

  try {
    return await replayInFlight;
  } finally {
    replayInFlight = null;
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === OFFLINE_SYNC_TAG) {
    event.waitUntil(replayQueuedMutations());
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SYNC_MUTATIONS') {
    const task = replayQueuedMutations();
    if (typeof event.waitUntil === 'function') {
      event.waitUntil(task);
    }
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isApiGet = isSameOrigin && url.pathname.startsWith('/api/');

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, SHELL_CACHE).catch(async () => {
        const cachedPage = await caches.match(request);
        if (cachedPage) return cachedPage;
        return (await caches.match(OFFLINE_PAGE)) || Response.error();
      }),
    );
    return;
  }

  if (isApiGet) {
    event.respondWith(
      networkFirst(request, API_CACHE).catch(
        () =>
          new Response(
            JSON.stringify({
              detail: 'Offline and no cached data available for this request.',
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      ),
    );
    return;
  }

  if (!isSameOrigin) return;

  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/_next/image/') ||
    /\.(?:css|js|mjs|png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/i.test(url.pathname);

  if (isStaticAsset) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});
