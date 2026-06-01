"use client"

import { useEffect } from "react"
import { scheduleMutationSync } from "@/lib/offline/mutation-queue"

const enableInDev = process.env.NEXT_PUBLIC_ENABLE_SW === "true"

type SyncUpdatePayload = {
  type?: string
  pending?: number
  processed?: number
  historyUpdated?: boolean
}

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return
    const shouldRegister = process.env.NODE_ENV === "production" || enableInDev

    if (!shouldRegister) {
      // In local dev, a stale SW can intercept Next route fetches and cause "Failed to fetch".
      // Proactively unregister SW + clear BONASO caches unless explicitly enabled.
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch(() => undefined)

      if ("caches" in window) {
        void caches
          .keys()
          .then((keys) =>
            Promise.all(
              keys
                .filter((key) => key.startsWith("bonaso-"))
                .map((key) => caches.delete(key)),
            ),
          )
          .catch(() => undefined)
      }

      return
    }

    const triggerSync = () => {
      void scheduleMutationSync()
    }

    let hasReloadedForSwUpdate = false
    const handleControllerChange = () => {
      if (hasReloadedForSwUpdate) return
      hasReloadedForSwUpdate = true
      window.location.reload()
    }

    const activateWaitingWorker = (registration: ServiceWorkerRegistration) => {
      registration.waiting?.postMessage({ type: "SKIP_WAITING" })
    }

    const handleUpdateFound = (registration: ServiceWorkerRegistration) => {
      const installingWorker = registration.installing
      if (!installingWorker) return
      installingWorker.addEventListener("statechange", () => {
        if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
          activateWaitingWorker(registration)
        }
      })
    }

    const handleMessage = (event: MessageEvent<SyncUpdatePayload>) => {
      if (event.data?.type !== "OFFLINE_SYNC_UPDATE") return
      window.dispatchEvent(
        new CustomEvent("bonaso:sync-state", {
          detail: {
            pending: event.data.pending ?? 0,
            processed: event.data.processed ?? 0,
            historyUpdated: !!event.data.historyUpdated,
          },
        }),
      )
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        registration.addEventListener("updatefound", () => handleUpdateFound(registration))
        activateWaitingWorker(registration)
        void registration.update()
        triggerSync()
      })
      .catch((error) => {
        console.error("Service worker registration failed", error)
      })

    window.addEventListener("online", triggerSync)
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange)
    navigator.serviceWorker.addEventListener("message", handleMessage)

    return () => {
      window.removeEventListener("online", triggerSync)
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange)
      navigator.serviceWorker.removeEventListener("message", handleMessage)
    }
  }, [])

  return null
}
