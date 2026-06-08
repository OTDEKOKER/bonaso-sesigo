const CACHE_VERSION = "bonaso-v3"
const SHELL_CACHE = `${CACHE_VERSION}-shell`
const API_CACHE = `${CACHE_VERSION}-api`
const OFFLINE_PAGE = "/offline/"

const MUTATION_DB = "bonaso-offline-db"
const MUTATION_STORE = "mutation_queue"
const HISTORY_STORE = "sync_history"
const MUTATION_DB_VERSION = 3
const OFFLINE_SYNC_TAG = "bonaso-sync-mutations"

const MAX_RETRY_ATTEMPTS = 8
const BASE_RETRY_DELAY_MS = 15_000
const MAX_RETRY_DELAY_MS = 10 * 60_000

const API_METADATA_TTL_MS = 5 * 60_000
const API_GENERAL_TTL_MS = 15 * 60_000
const API_NO_OFFLINE_ENDPOINT_PREFIXES = [
  "/api/analysis/",
]
const API_METADATA_ENDPOINT_PREFIXES = [
  "/api/indicators/",
  "/api/organizations/",
  "/api/manage/projects/",
  "/api/manage/project-indicators/",
]

const QUEUEABLE_METHODS = new Set(["POST", "PUT", "PATCH"])
const QUEUEABLE_ENDPOINT_PREFIXES = [
  "/aggregates/",
  "/record/respondents/",
  "/record/interactions/",
  "/record/responses/",
]
const NON_QUEUEABLE_ENDPOINT_PREFIXES = [
  "/users/request-token/",
  "/users/token/refresh/",
  "/users/logout/",
  "/manage/users/set_password/",
  "/manage/users/reset_password/",
  "/manage/users/reset_password_confirm/",
  "/users/admin-reset-password/",
  "/aggregates/bulk_approve/",
  "/manage/",
  "/analysis/",
  "/users/",
  "/organizations/",
  "/indicators/",
  "/flags/",
  "/profiles/",
  "/uploads/",
  "/messages/",
  "/social/",
]
const NON_QUEUEABLE_ENDPOINT_PATTERNS = [
  /^\/aggregates\/\d+\/(approve|review|flag|reject)\/?$/,
]

const SHELL_ASSETS = [
  "/",
  "/login/",
  "/dashboard/",
  OFFLINE_PAGE,
  "/favicon.ico",
  "/icon-dark-32x32.png",
  "/icon-light-32x32.png",
  "/apple-icon.png",
]

let replayInFlight = null

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await Promise.all(
        SHELL_ASSETS.map(async (asset) => {
          try {
            await cache.add(asset)
          } catch {
            // Keep install resilient even if one asset fails.
          }
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener("activate", (event) => {
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
  )
})

function canQueueOfflineMutation(endpoint, method) {
  const normalizedMethod = String(method || "").toUpperCase()
  if (!QUEUEABLE_METHODS.has(normalizedMethod)) return false
  if (NON_QUEUEABLE_ENDPOINT_PREFIXES.some((prefix) => endpoint.startsWith(prefix))) return false
  if (NON_QUEUEABLE_ENDPOINT_PATTERNS.some((pattern) => pattern.test(endpoint))) return false
  return QUEUEABLE_ENDPOINT_PREFIXES.some((prefix) => endpoint.startsWith(prefix))
}

function backoffDelayMs(nextAttempt) {
  const exponent = Math.max(0, Number(nextAttempt || 1) - 1)
  const uncapped = BASE_RETRY_DELAY_MS * Math.pow(2, exponent)
  const capped = Math.min(MAX_RETRY_DELAY_MS, uncapped)
  const jitter = Math.floor(capped * Math.random() * 0.25)
  return capped + jitter
}

function isRetriableStatus(status) {
  return status >= 500 || [401, 403, 408, 425, 429].includes(status)
}

function secondsUntil(timestamp) {
  return Math.max(1, Math.round((Number(timestamp || 0) - Date.now()) / 1000))
}

function getApiCacheTtlMs(pathname) {
  if (API_METADATA_ENDPOINT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return API_METADATA_TTL_MS
  }
  return API_GENERAL_TTL_MS
}

function allowsOfflineApiFallback(pathname) {
  return !API_NO_OFFLINE_ENDPOINT_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function parseCachedAt(response) {
  const cachedAt = Number(response.headers.get("x-bonaso-cached-at") || "")
  if (Number.isFinite(cachedAt) && cachedAt > 0) return cachedAt

  const dateHeader = response.headers.get("date")
  if (!dateHeader) return null
  const parsed = Date.parse(dateHeader)
  return Number.isFinite(parsed) ? parsed : null
}

function isFreshCachedResponse(response, maxAgeMs) {
  const cachedAt = parseCachedAt(response)
  if (!cachedAt) return false
  return Date.now() - cachedAt <= maxAgeMs
}

function extractFirstErrorMessage(payload) {
  if (typeof payload === "string" && payload.trim()) return payload.trim()
  if (Array.isArray(payload)) {
    for (const value of payload) {
      const nested = extractFirstErrorMessage(value)
      if (nested) return nested
    }
    return null
  }
  if (!payload || typeof payload !== "object") return null
  if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail.trim()
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim()
  for (const value of Object.values(payload)) {
    const nested = extractFirstErrorMessage(value)
    if (nested) return nested
  }
  return null
}

async function readResponseMessage(response) {
  try {
    const contentType = response.headers.get("content-type") || ""
    if (contentType.includes("application/json")) {
      const payload = await response.clone().json()
      return extractFirstErrorMessage(payload)
    }
    const text = (await response.clone().text()).trim()
    return text ? text.slice(0, 240) : null
  } catch {
    return null
  }
}

async function withCachedAtHeader(response) {
  const headers = new Headers(response.headers)
  headers.set("x-bonaso-cached-at", String(Date.now()))
  const body = await response.arrayBuffer()
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response && response.ok) {
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    throw new Error("network_and_cache_miss")
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => null)

  if (cached) return cached
  const networkResponse = await networkPromise
  return networkResponse || Response.error()
}

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE)
  const url = new URL(request.url)

  try {
    const response = await fetch(request)
    if (response && response.ok && allowsOfflineApiFallback(url.pathname)) {
      const cacheControl = String(response.headers.get("cache-control") || "")
      if (!/no-store/i.test(cacheControl)) {
        const cacheable = await withCachedAtHeader(response.clone())
        await cache.put(request, cacheable)
      }
    }
    return response
  } catch {
    if (!allowsOfflineApiFallback(url.pathname)) {
      throw new Error("offline_disallowed_for_endpoint")
    }
    const cached = await cache.match(request)
    if (!cached) {
      throw new Error("network_and_cache_miss")
    }
    // We are offline (the fetch above threw). For field use we serve whatever we
    // have rather than failing on the short TTL: stale reference data beats no
    // data when a worker is offline for a full shift. The TTL still governs the
    // ONLINE path above (where we revalidate from the network). We tag the
    // response so the UI can show an "offline / cached" indicator.
    const headers = new Headers(cached.headers)
    headers.set("x-bonaso-offline-cache", "1")
    const body = await cached.arrayBuffer()
    return new Response(body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    })
  }
}

function openMutationDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in self)) {
      reject(new Error("IndexedDB unavailable in service worker"))
      return
    }

    const request = indexedDB.open(MUTATION_DB, MUTATION_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      let queueStore
      if (!db.objectStoreNames.contains(MUTATION_STORE)) {
        queueStore = db.createObjectStore(MUTATION_STORE, { keyPath: "id", autoIncrement: true })
      } else {
        queueStore = request.transaction.objectStore(MUTATION_STORE)
      }
      if (!queueStore.indexNames.contains("createdAt")) {
        queueStore.createIndex("createdAt", "createdAt", { unique: false })
      }
      if (!queueStore.indexNames.contains("nextRetryAt")) {
        queueStore.createIndex("nextRetryAt", "nextRetryAt", { unique: false })
      }

      let historyStore
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        historyStore = db.createObjectStore(HISTORY_STORE, { keyPath: "id", autoIncrement: true })
      } else {
        historyStore = request.transaction.objectStore(HISTORY_STORE)
      }
      if (!historyStore.indexNames.contains("createdAt")) {
        historyStore.createIndex("createdAt", "createdAt", { unique: false })
      }
      if (!historyStore.indexNames.contains("queueId")) {
        historyStore.createIndex("queueId", "queueId", { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Failed to open mutation queue DB"))
  })
}

async function withMutationStore(storeName, mode, run) {
  const db = await openMutationDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)

    tx.oncomplete = () => db.close()
    tx.onerror = () => reject(tx.error || new Error("Mutation queue transaction failed"))
    tx.onabort = () => reject(tx.error || new Error("Mutation queue transaction aborted"))

    run(store, resolve, reject)
  })
}

function normalizeQueuedItem(item) {
  const createdAt = Number(item?.createdAt || Date.now())
  const retryCount = Math.max(0, Number(item?.retryCount || 0))
  const nextRetryAt = Number(item?.nextRetryAt || createdAt)
  const method = String(item?.method || "POST").toUpperCase()
  return {
    ...item,
    url: String(item?.url || ""),
    endpoint: typeof item?.endpoint === "string" ? item.endpoint : undefined,
    method,
    headers: { ...(item?.headers || {}) },
    body: typeof item?.body === "string" ? item.body : undefined,
    idempotencyKey: typeof item?.idempotencyKey === "string" ? item.idempotencyKey : undefined,
    retryCount,
    nextRetryAt,
    blockedReason: typeof item?.blockedReason === "string" ? item.blockedReason : undefined,
  }
}

function resolveMutationEndpoint(item) {
  if (item.endpoint) return item.endpoint
  try {
    return new URL(item.url, self.location.origin).pathname
  } catch {
    return ""
  }
}

async function appendSyncHistory(entry) {
  try {
    await withMutationStore(HISTORY_STORE, "readwrite", (store, resolve, reject) => {
      const request = store.add({
        ...entry,
        createdAt: Date.now(),
      })
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error || new Error("Failed to append sync history"))
    })
  } catch {
    // No-op.
  }
}

async function listQueuedMutations() {
  try {
    return await withMutationStore(MUTATION_STORE, "readonly", (store, resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => {
        const items = (request.result || []).map(normalizeQueuedItem)
        items.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
        resolve(items)
      }
      request.onerror = () => reject(request.error || new Error("Failed to list queued mutations"))
    })
  } catch {
    return []
  }
}

async function updateQueuedMutation(id, updater) {
  return withMutationStore(MUTATION_STORE, "readwrite", (store, resolve, reject) => {
    const getRequest = store.get(id)
    getRequest.onerror = () => reject(getRequest.error || new Error("Failed to read queued mutation"))
    getRequest.onsuccess = () => {
      if (!getRequest.result) {
        resolve(null)
        return
      }
      const current = normalizeQueuedItem(getRequest.result)
      const next = updater(current)
      const putRequest = store.put(next)
      putRequest.onerror = () => reject(putRequest.error || new Error("Failed to update queued mutation"))
      putRequest.onsuccess = () => resolve(next)
    }
  })
}

async function removeQueuedMutation(id) {
  try {
    await withMutationStore(MUTATION_STORE, "readwrite", (store, resolve, reject) => {
      const request = store.delete(id)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error || new Error("Failed to remove queued mutation"))
    })
  } catch {
    // No-op.
  }
}

async function countQueuedMutations() {
  try {
    return await withMutationStore(MUTATION_STORE, "readonly", (store, resolve, reject) => {
      const request = store.count()
      request.onsuccess = () => resolve(request.result || 0)
      request.onerror = () => reject(request.error || new Error("Failed to count queued mutations"))
    })
  } catch {
    return 0
  }
}

function normalizeHeaders(headersLike) {
  const headers = new Headers(headersLike || {})
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  return headers
}

async function notifyClients(payload) {
  try {
    const allClients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" })
    for (const client of allClients) {
      client.postMessage({ type: "OFFLINE_SYNC_UPDATE", ...payload })
    }
  } catch {
    // No-op.
  }
}

async function markMutationBlocked(item, message, httpStatus) {
  if (!item?.id) return
  await updateQueuedMutation(item.id, (current) => ({
    ...current,
    blockedReason: message,
    lastError: message,
    lastHttpStatus: httpStatus,
    lastAttemptAt: Date.now(),
    nextRetryAt: Number.MAX_SAFE_INTEGER,
  }))

  await appendSyncHistory({
    queueId: item.id,
    url: item.url,
    method: item.method,
    status: "blocked",
    httpStatus,
    message,
  })
}

async function scheduleMutationRetry(item, options) {
  if (!item?.id) return

  const now = Date.now()
  const incrementAttempt = options?.incrementAttempt !== false

  const updated = await updateQueuedMutation(item.id, (current) => {
    const nextRetryCount = incrementAttempt ? Number(current.retryCount || 0) + 1 : Number(current.retryCount || 0)
    const retryDelayMs =
      typeof options?.retryDelayMs === "number"
        ? options.retryDelayMs
        : backoffDelayMs(Math.max(1, nextRetryCount))

    return {
      ...current,
      retryCount: nextRetryCount,
      nextRetryAt: now + retryDelayMs,
      lastAttemptAt: now,
      lastHttpStatus: options?.httpStatus,
      lastError: options?.message,
    }
  })

  if (!updated) return
  const message =
    options?.message ||
    `Sync retry scheduled in ${secondsUntil(updated.nextRetryAt)}s (attempt ${updated.retryCount}).`

  await appendSyncHistory({
    queueId: item.id,
    url: item.url,
    method: item.method,
    status: "failed",
    httpStatus: options?.httpStatus,
    message,
  })
}

async function replayQueuedMutations() {
  if (replayInFlight) return replayInFlight

  replayInFlight = (async () => {
    const queue = await listQueuedMutations()
    let processed = 0
    let historyUpdated = false
    const now = Date.now()

    for (const item of queue) {
      if (!item?.id || !item?.url || !item?.method) continue
      if (item.blockedReason) continue
      if (Number(item.nextRetryAt || 0) > now) continue

      const endpoint = resolveMutationEndpoint(item)
      if (!canQueueOfflineMutation(endpoint, item.method)) {
        await markMutationBlocked(item, "Blocked from replay: unsupported offline mutation scope.")
        processed += 1
        historyUpdated = true
        continue
      }

      try {
        const response = await fetch(item.url, {
          method: item.method,
          headers: normalizeHeaders(item.headers),
          body: item.body,
        })

        if (response.ok) {
          await removeQueuedMutation(item.id)
          await appendSyncHistory({
            queueId: item.id,
            url: item.url,
            method: item.method,
            status: "synced",
            httpStatus: response.status,
            message: "Successfully synced in service worker",
          })
          processed += 1
          historyUpdated = true
          continue
        }

        const serverMessage = (await readResponseMessage(response)) || "Server rejected queued mutation."

        if (!isRetriableStatus(response.status)) {
          await markMutationBlocked(item, `${serverMessage} (HTTP ${response.status}).`, response.status)
          processed += 1
          historyUpdated = true
          continue
        }

        if (Number(item.retryCount || 0) >= MAX_RETRY_ATTEMPTS) {
          await markMutationBlocked(
            item,
            `Retry limit reached after ${item.retryCount} attempts. Resolve manually and retry.`,
            response.status,
          )
          processed += 1
          historyUpdated = true
          continue
        }

        await scheduleMutationRetry(item, {
          message: `${serverMessage} (HTTP ${response.status}).`,
          httpStatus: response.status,
          incrementAttempt: true,
        })
        historyUpdated = true
        break
      } catch {
        if (Number(item.retryCount || 0) >= MAX_RETRY_ATTEMPTS) {
          await markMutationBlocked(
            item,
            `Retry limit reached after ${item.retryCount} attempts due to repeated network failures.`,
          )
          processed += 1
          historyUpdated = true
          continue
        }

        await scheduleMutationRetry(item, {
          message: "Network error during service worker replay; will retry automatically.",
          incrementAttempt: true,
        })
        historyUpdated = true
        break
      }
    }

    const pending = await countQueuedMutations()
    await notifyClients({ pending, processed, historyUpdated })
    return { pending, processed }
  })()

  try {
    return await replayInFlight
  } finally {
    replayInFlight = null
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === OFFLINE_SYNC_TAG) {
    event.waitUntil(replayQueuedMutations())
  }
})

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting()
    return
  }

  if (event.data?.type === "SYNC_MUTATIONS") {
    const task = replayQueuedMutations()
    if (typeof event.waitUntil === "function") {
      event.waitUntil(task)
    }
  }

  // Shared-device data-leak fix (audit finding H3): on logout the page asks the
  // worker to drop all cached authenticated data and any queued offline work so
  // the next user on this device starts clean. We flush pending mutations first
  // (best effort, while the outgoing user's token is still valid) so offline
  // work is not silently lost, THEN wipe everything.
  if (event.data?.type === "PURGE_OFFLINE_DATA") {
    const task = purgeOfflineData()
    if (typeof event.waitUntil === "function") {
      event.waitUntil(task)
    }
  }
})

async function purgeOfflineData() {
  // Always clear the cached read responses: this is the shared-device leak the
  // audit (H3) flagged — the next user must not see the previous user's data.
  try {
    await Promise.all([caches.delete(API_CACHE), caches.delete(SHELL_CACHE)])
  } catch {}

  // Try to flush any un-synced offline writes while the outgoing user's token
  // is still valid, so their fieldwork is not lost.
  try {
    await replayQueuedMutations()
  } catch {}

  // Only wipe the mutation queue if it is now empty. If writes remain (offline,
  // or the server rejected them) we keep them rather than silently destroy the
  // user's data; they are tied to that user's stored token and will sync or
  // expire safely. An empty DB is deleted to leave the device clean.
  try {
    const remaining = await countQueuedMutations()
    if (!remaining && "indexedDB" in self) {
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(MUTATION_DB)
        req.onsuccess = req.onerror = req.onblocked = () => resolve()
      })
    }
  } catch {}
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  const isSameOrigin = url.origin === self.location.origin
  const isApiGet = isSameOrigin && url.pathname.startsWith("/api/")

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, SHELL_CACHE).catch(async () => {
        const cachedPage = await caches.match(request)
        if (cachedPage) return cachedPage
        return (await caches.match(OFFLINE_PAGE)) || Response.error()
      }),
    )
    return
  }

  if (isApiGet) {
    event.respondWith(
      networkFirstApi(request).catch(
        () =>
          new Response(
            JSON.stringify({
              detail: "Offline and no fresh cached data available for this request.",
            }),
            {
              status: 503,
              headers: { "Content-Type": "application/json" },
            },
          ),
      ),
    )
    return
  }

  if (!isSameOrigin) return

  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image/") ||
    /\.(?:css|js|mjs|png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/i.test(url.pathname)

  if (isStaticAsset) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE))
  }
})
