const DB_NAME = "bonaso-offline-db"
const DB_VERSION = 3
const STORE_NAME = "mutation_queue"
const HISTORY_STORE_NAME = "sync_history"
export const OFFLINE_SYNC_TAG = "bonaso-sync-mutations"

const DEFAULT_HISTORY_LIMIT = 50
const MAX_RETRY_ATTEMPTS = 8
const BASE_RETRY_DELAY_MS = 15_000
const MAX_RETRY_DELAY_MS = 10 * 60_000

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

type MutationMethod = "POST" | "PUT" | "PATCH" | "DELETE"
type SyncHistoryStatus = "queued" | "synced" | "failed" | "blocked"

interface QueuedMutation {
  id?: number
  url: string
  endpoint?: string
  method: MutationMethod
  headers: Record<string, string>
  body?: string
  idempotencyKey?: string
  retryCount: number
  nextRetryAt: number
  lastAttemptAt?: number
  lastHttpStatus?: number
  lastError?: string
  blockedReason?: string
  createdAt: number
}

export interface SyncHistoryEntry {
  id?: number
  queueId?: number
  url: string
  method: MutationMethod
  status: SyncHistoryStatus
  httpStatus?: number
  message?: string
  createdAt: number
}

let syncInFlight: Promise<{ processed: number; pending: number }> | null = null

function isBrowser(): boolean {
  return typeof window !== "undefined"
}

function emitSyncState(detail: { pending: number; processed?: number; historyUpdated?: boolean }) {
  if (!isBrowser()) return
  window.dispatchEvent(new CustomEvent("bonaso:sync-state", { detail }))
}

function canQueueOfflineMutation(endpoint: string, method: string): boolean {
  const normalizedMethod = method.toUpperCase()
  if (!QUEUEABLE_METHODS.has(normalizedMethod)) return false
  if (NON_QUEUEABLE_ENDPOINT_PREFIXES.some((prefix) => endpoint.startsWith(prefix))) return false
  if (NON_QUEUEABLE_ENDPOINT_PATTERNS.some((pattern) => pattern.test(endpoint))) return false
  return QUEUEABLE_ENDPOINT_PREFIXES.some((prefix) => endpoint.startsWith(prefix))
}

function extractFirstErrorMessage(payload: unknown): string | null {
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim()
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = extractFirstErrorMessage(item)
      if (nested) return nested
    }
    return null
  }

  if (!payload || typeof payload !== "object") return null
  const record = payload as Record<string, unknown>

  if (typeof record.detail === "string" && record.detail.trim()) return record.detail.trim()
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim()

  for (const value of Object.values(record)) {
    const nested = extractFirstErrorMessage(value)
    if (nested) return nested
  }
  return null
}

function normalizeQueuedMutation(input: Partial<QueuedMutation>): QueuedMutation {
  const createdAt = Number(input.createdAt || Date.now())
  const retryCount = Math.max(0, Number(input.retryCount || 0))
  const nextRetryAt = Number(input.nextRetryAt || createdAt)
  const method = String(input.method || "POST").toUpperCase() as MutationMethod

  return {
    ...input,
    url: String(input.url || ""),
    endpoint: typeof input.endpoint === "string" ? input.endpoint : undefined,
    method,
    headers: { ...(input.headers || {}) },
    body: typeof input.body === "string" ? input.body : undefined,
    idempotencyKey: typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined,
    retryCount,
    nextRetryAt,
    lastAttemptAt: input.lastAttemptAt ? Number(input.lastAttemptAt) : undefined,
    lastHttpStatus: input.lastHttpStatus ? Number(input.lastHttpStatus) : undefined,
    lastError: typeof input.lastError === "string" ? input.lastError : undefined,
    blockedReason: typeof input.blockedReason === "string" ? input.blockedReason : undefined,
    createdAt,
  }
}

function buildMutationEndpoint(item: QueuedMutation): string {
  if (item.endpoint) return item.endpoint
  if (!isBrowser()) return ""
  try {
    const parsed = new URL(item.url, window.location.origin)
    return parsed.pathname
  } catch {
    return ""
  }
}

function backoffDelayMs(nextAttempt: number): number {
  const exponent = Math.max(0, nextAttempt - 1)
  const uncapped = BASE_RETRY_DELAY_MS * Math.pow(2, exponent)
  const capped = Math.min(MAX_RETRY_DELAY_MS, uncapped)
  const jitter = Math.floor(capped * Math.random() * 0.25)
  return capped + jitter
}

function secondsUntil(timestamp: number): number {
  return Math.max(1, Math.round((timestamp - Date.now()) / 1000))
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser() || !("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available"))
      return
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      let queueStore: IDBObjectStore
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        queueStore = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true })
      } else {
        queueStore = request.transaction!.objectStore(STORE_NAME)
      }
      if (!queueStore.indexNames.contains("createdAt")) {
        queueStore.createIndex("createdAt", "createdAt", { unique: false })
      }
      if (!queueStore.indexNames.contains("nextRetryAt")) {
        queueStore.createIndex("nextRetryAt", "nextRetryAt", { unique: false })
      }

      let historyStore: IDBObjectStore
      if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) {
        historyStore = db.createObjectStore(HISTORY_STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        })
      } else {
        historyStore = request.transaction!.objectStore(HISTORY_STORE_NAME)
      }
      if (!historyStore.indexNames.contains("createdAt")) {
        historyStore.createIndex("createdAt", "createdAt", { unique: false })
      }
      if (!historyStore.indexNames.contains("queueId")) {
        historyStore.createIndex("queueId", "queueId", { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Failed to open offline queue database"))
  })
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void,
): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)

    tx.oncomplete = () => db.close()
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"))
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"))

    run(store, resolve, reject)
  })
}

function isRetriableStatus(status: number): boolean {
  return status >= 500 || [401, 403, 408, 425, 429].includes(status)
}

async function appendSyncHistory(entry: Omit<SyncHistoryEntry, "id" | "createdAt">): Promise<void> {
  await withStore<void>(HISTORY_STORE_NAME, "readwrite", (store, resolve, reject) => {
    const request = store.add({
      ...entry,
      createdAt: Date.now(),
    } as SyncHistoryEntry)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error || new Error("Failed to append sync history"))
  })
}

async function readResponseMessage(response: Response): Promise<string | null> {
  try {
    const contentType = response.headers.get("content-type") || ""
    if (contentType.includes("application/json")) {
      const payload = await response.clone().json()
      return extractFirstErrorMessage(payload)
    }
    const text = (await response.clone().text()).trim()
    if (!text) return null
    return text.slice(0, 240)
  } catch {
    return null
  }
}

async function updateQueuedMutation(
  id: number,
  updater: (current: QueuedMutation) => QueuedMutation,
): Promise<QueuedMutation | null> {
  return withStore<QueuedMutation | null>(STORE_NAME, "readwrite", (store, resolve, reject) => {
    const getRequest = store.get(id)
    getRequest.onerror = () => reject(getRequest.error || new Error("Failed to read queued mutation"))
    getRequest.onsuccess = () => {
      if (!getRequest.result) {
        resolve(null)
        return
      }
      const current = normalizeQueuedMutation(getRequest.result as Partial<QueuedMutation>)
      const next = updater(current)
      const putRequest = store.put(next)
      putRequest.onerror = () => reject(putRequest.error || new Error("Failed to update queued mutation"))
      putRequest.onsuccess = () => resolve(next)
    }
  })
}

async function markMutationBlocked(
  item: QueuedMutation,
  message: string,
  httpStatus?: number,
): Promise<void> {
  if (!item.id) return

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

async function scheduleMutationRetry(
  item: QueuedMutation,
  options?: {
    message?: string
    httpStatus?: number
    incrementAttempt?: boolean
    retryDelayMs?: number
  },
): Promise<void> {
  if (!item.id) return
  const now = Date.now()
  const incrementAttempt = options?.incrementAttempt !== false

  const updated = await updateQueuedMutation(item.id, (current) => {
    const nextRetryCount = incrementAttempt ? current.retryCount + 1 : current.retryCount
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
  const nextRetryInSeconds = secondsUntil(updated.nextRetryAt)
  const statusText =
    options?.message || `Sync retry scheduled in ${nextRetryInSeconds}s (attempt ${updated.retryCount}).`

  await appendSyncHistory({
    queueId: item.id,
    url: item.url,
    method: item.method,
    status: "failed",
    httpStatus: options?.httpStatus,
    message: statusText,
  })
}

export async function listSyncHistory(limit: number = DEFAULT_HISTORY_LIMIT): Promise<SyncHistoryEntry[]> {
  try {
    const history = await withStore<SyncHistoryEntry[]>(HISTORY_STORE_NAME, "readonly", (store, resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => resolve((request.result || []) as SyncHistoryEntry[])
      request.onerror = () => reject(request.error || new Error("Failed to read sync history"))
    })
    history.sort((a, b) => b.createdAt - a.createdAt)
    return history.slice(0, Math.max(1, limit))
  } catch {
    return []
  }
}

export async function clearSyncHistory(): Promise<void> {
  await withStore<void>(HISTORY_STORE_NAME, "readwrite", (store, resolve, reject) => {
    const request = store.clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error || new Error("Failed to clear sync history"))
  })

  const pending = await getQueuedMutationCount()
  emitSyncState({ pending, historyUpdated: true })
}

export async function enqueueMutation(mutation: Omit<QueuedMutation, "id" | "createdAt" | "retryCount" | "nextRetryAt">): Promise<number> {
  const createdAt = Date.now()
  const normalized = normalizeQueuedMutation({
    ...mutation,
    retryCount: 0,
    nextRetryAt: createdAt,
    createdAt,
  })

  const id = await withStore<number>(STORE_NAME, "readwrite", (store, resolve, reject) => {
    const request = store.add(normalized)
    request.onsuccess = () => resolve(Number(request.result))
    request.onerror = () => reject(request.error || new Error("Failed to enqueue mutation"))
  })

  await appendSyncHistory({
    queueId: id,
    url: normalized.url,
    method: normalized.method,
    status: "queued",
    message: "Queued while offline",
  })

  const pending = await getQueuedMutationCount()
  emitSyncState({ pending, historyUpdated: true })
  return id
}

export async function getQueuedMutationCount(): Promise<number> {
  try {
    return await withStore<number>(STORE_NAME, "readonly", (store, resolve, reject) => {
      const request = store.count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error("Failed to count queued mutations"))
    })
  } catch {
    return 0
  }
}

export async function clearQueuedMutations(): Promise<number> {
  let removed = 0

  await withStore<void>(STORE_NAME, "readwrite", (store, resolve, reject) => {
    const countRequest = store.count()
    countRequest.onerror = () => reject(countRequest.error || new Error("Failed to count queued mutations"))
    countRequest.onsuccess = () => {
      removed = Number(countRequest.result || 0)
      const clearRequest = store.clear()
      clearRequest.onsuccess = () => resolve()
      clearRequest.onerror = () => reject(clearRequest.error || new Error("Failed to clear queued mutations"))
    }
  })

  emitSyncState({ pending: 0, historyUpdated: false })
  return removed
}

async function getQueuedMutations(): Promise<QueuedMutation[]> {
  return withStore<QueuedMutation[]>(STORE_NAME, "readonly", (store, resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => {
      const items = ((request.result || []) as Partial<QueuedMutation>[]).map(normalizeQueuedMutation)
      items.sort((a, b) => a.createdAt - b.createdAt)
      resolve(items)
    }
    request.onerror = () => reject(request.error || new Error("Failed to read queued mutations"))
  })
}

async function removeQueuedMutation(id: number): Promise<void> {
  await withStore<void>(STORE_NAME, "readwrite", (store, resolve, reject) => {
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error || new Error("Failed to remove queued mutation"))
  })
}

function withCurrentAuthHeader(headers: Record<string, string>): Headers {
  const merged = new Headers(headers)
  if (!merged.has("Content-Type")) {
    merged.set("Content-Type", "application/json")
  }
  if (isBrowser()) {
    const accessToken = localStorage.getItem("access_token")
    if (accessToken) {
      merged.set("Authorization", `Bearer ${accessToken}`)
    }
  }
  return merged
}

async function notifyPendingCount(processed?: number, historyUpdated: boolean = false) {
  const pending = await getQueuedMutationCount()
  emitSyncState({ pending, processed, historyUpdated })
}

export async function processQueuedMutations(): Promise<{ processed: number; pending: number }> {
  if (syncInFlight) return syncInFlight

  syncInFlight = (async () => {
    if (!isBrowser()) return { processed: 0, pending: 0 }
    if (!navigator.onLine) {
      const pending = await getQueuedMutationCount()
      return { processed: 0, pending }
    }

    const queue = await getQueuedMutations()
    let processed = 0
    let historyUpdated = false
    const now = Date.now()

    for (const item of queue) {
      if (!item.id) continue
      if (item.blockedReason) continue
      if (item.nextRetryAt > now) continue

      const endpoint = buildMutationEndpoint(item)
      if (!canQueueOfflineMutation(endpoint, item.method)) {
        await markMutationBlocked(item, "Blocked from replay: unsupported offline mutation scope.")
        processed += 1
        historyUpdated = true
        continue
      }

      try {
        const response = await fetch(item.url, {
          method: item.method,
          headers: withCurrentAuthHeader(item.headers),
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
            message: "Successfully synced",
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

        const hasAccessToken = Boolean(localStorage.getItem("access_token"))
        if (response.status === 401 && !hasAccessToken) {
          await scheduleMutationRetry(item, {
            message: "Login required before queued records can sync.",
            httpStatus: response.status,
            incrementAttempt: false,
            retryDelayMs: 60_000,
          })
          historyUpdated = true
          break
        }

        if (item.retryCount >= MAX_RETRY_ATTEMPTS) {
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
        if (item.retryCount >= MAX_RETRY_ATTEMPTS) {
          await markMutationBlocked(
            item,
            `Retry limit reached after ${item.retryCount} attempts due to repeated network failures.`,
          )
          processed += 1
          historyUpdated = true
          continue
        }

        await scheduleMutationRetry(item, {
          message: "Network error during replay; will retry automatically.",
          incrementAttempt: true,
        })
        historyUpdated = true
        break
      }
    }

    await notifyPendingCount(processed, historyUpdated)
    return { processed, pending: await getQueuedMutationCount() }
  })()

  try {
    return await syncInFlight
  } finally {
    syncInFlight = null
  }
}

export async function scheduleMutationSync(): Promise<void> {
  if (!isBrowser()) return
  if (navigator.onLine) {
    await processQueuedMutations()
  } else {
    await notifyPendingCount(undefined, false)
  }
}
