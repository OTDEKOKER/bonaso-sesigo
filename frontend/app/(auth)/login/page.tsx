"use client"

import React, { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authService } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import { isTrainingMode, setTrainingMode, clearTrainingMode } from "@/lib/training-mode"

type Mode = "live" | "training"

function getLoginErrorMessage(error: unknown) {
  const rawMessage =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "").trim()
      : ""

  if (rawMessage === "No active account found with the given credentials") {
    return "Invalid username/email or password. If this keeps happening, the account may be inactive."
  }

  return rawMessage || "Invalid username or password. Please try again."
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")

  // Default to training mode if the user arrived from /training
  const initialMode: Mode =
    searchParams.get("mode") === "training" ? "training" : "live"
  const [mode, setMode] = useState<Mode>(initialMode)

  useEffect(() => {
    if (authService.isAuthenticated()) {
      if (mode === "training") {
        setTrainingMode()
        router.push("/training/dashboard")
      } else {
        const isTraining = isTrainingMode()
        router.push(isTraining ? "/training/dashboard" : "/dashboard")
      }
    }
  }, [router, mode])

  // If we were redirected here by the inactivity auto-logout, explain why.
  // Read in an effect (sessionStorage is client-only) to stay hydration-safe.
  useEffect(() => {
    try {
      if (sessionStorage.getItem("inactivity_logout") === "1") {
        sessionStorage.removeItem("inactivity_logout")
        setError("You were signed out due to inactivity. Please sign in again.")
      }
    } catch {
      /* sessionStorage unavailable — skip the notice */
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    const applyModeAndRedirect = (offline: boolean) => {
      if (mode === "training") {
        setTrainingMode()
      } else {
        clearTrainingMode()
      }
      toast({
        title: offline ? "Signed in offline" : "Welcome!",
        description: offline
          ? "No internet detected — restored your offline session. Data will sync when you reconnect."
          : mode === "training"
            ? "Signed in to Sesigo Training Mode."
            : "Signed in to Sesigo Live System.",
      })
      router.push(mode === "training" ? "/training/dashboard" : "/dashboard")
    }

    try {
      await authService.login({ username: identifier.trim(), password })
      applyModeAndRedirect(false)
    } catch (err: unknown) {
      // Offline-first fallback: if we are offline (or the network failed),
      // try to restore a previously-saved offline session for this device.
      const looksOffline =
        (typeof navigator !== "undefined" && !navigator.onLine) ||
        getLoginErrorMessage(err).toLowerCase().includes("network")
      if (looksOffline) {
        try {
          const restored = await authService.offlineLogin({
            username: identifier.trim(),
            password,
          })
          if (restored) {
            applyModeAndRedirect(true)
            return
          }
        } catch {
          /* fall through to the normal error */
        }
      }
      const errorMessage = looksOffline
        ? "You appear to be offline and no saved offline session matched. Connect to the internet to sign in the first time on this device."
        : getLoginErrorMessage(err)
      setError(errorMessage)
      toast({
        title: "Login Failed",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="flex h-[100dvh] items-stretch justify-center overflow-hidden bg-[#005a2f] p-1.5 sm:p-3 md:p-4">
      <section className="flex w-full max-w-[760px] flex-col overflow-y-auto border-[3px] border-[#4bb978] bg-[#004a27] px-4 py-5 text-white shadow-2xl sm:px-6 sm:py-6 md:px-8 md:py-8">
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="mx-auto flex w-full max-w-[420px] flex-col items-center text-center">
            <p className="text-[clamp(2.75rem,4vw,4rem)] font-bold tracking-wide leading-none">Sesigo</p>
            <p className="mt-2 text-[clamp(0.95rem,1.5vw,1.35rem)] font-medium text-white/70">Data Portal</p>
            <div
              className="mt-3 h-0 w-0 border-l-[clamp(44px,4vw,68px)] border-r-[clamp(44px,4vw,68px)] border-t-[clamp(78px,11vh,120px)] border-l-transparent border-r-transparent border-t-white/95"
              aria-hidden="true"
            />
            <h1 className="mt-5 text-[clamp(2.5rem,4.4vw,4rem)] font-bold leading-none">
              {mode === "training" ? "Training Login" : "Welcome!"}
            </h1>
            <p className="mt-2 text-xs text-white/60 sm:text-sm">Powered by BONASO</p>
          </div>

          <div className="mx-auto mt-5 w-full max-w-[420px]">
            <div className="flex overflow-hidden border border-white/30">
              <button
                type="button"
                onClick={() => setMode("live")}
                className={
                  "flex-1 px-3 py-2 text-xs font-semibold leading-tight transition-colors sm:text-sm md:text-base " +
                  (mode === "live"
                    ? "bg-white text-[#004a27]"
                    : "bg-transparent text-white/70 hover:text-white")
                }
              >
                Sesigo Live System
              </button>
              <button
                type="button"
                onClick={() => setMode("training")}
                className={
                  "flex-1 px-3 py-2 text-xs font-semibold leading-tight transition-colors sm:text-sm md:text-base " +
                  (mode === "training"
                    ? "bg-amber-400 text-[#004a27]"
                    : "bg-transparent text-white/70 hover:text-white")
                }
              >
                Sesigo Training Mode
              </button>
            </div>
            {mode === "training" && (
              <p className="mt-2 text-center text-xs text-amber-300">
                Demo data only. Not for official reporting. Training data may be automatically
                cleared after 7 days.
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="mx-auto mt-5 w-full max-w-[420px] space-y-4 sm:space-y-5">
            {error ? (
              <div className="rounded bg-red-100/95 px-3 py-2 text-sm font-medium text-red-900">
                {error}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label
                htmlFor="username"
                className="block text-center text-[clamp(2rem,3.2vw,3rem)] font-semibold leading-none text-white"
              >
                Username or Email
              </Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                placeholder="Enter your username or email"
                className="h-11 rounded-none border-0 bg-[#d7dde7] text-base text-black placeholder:text-slate-600 sm:h-12 sm:text-lg"
              />
              <p className="text-center text-sm leading-snug text-white/80">
                Sign in with either your username or email address.
              </p>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="password"
                className="block text-center text-[clamp(2rem,3.2vw,3rem)] font-semibold leading-none text-white"
              >
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11 rounded-none border-0 bg-[#d7dde7] text-base text-black placeholder:text-slate-600 sm:h-12 sm:text-lg"
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className={
                "mt-1 h-11 w-full rounded-none text-xl font-semibold hover:opacity-90 sm:h-12 sm:text-2xl " +
                (mode === "training"
                  ? "bg-amber-400 text-[#004a27] hover:bg-amber-300"
                  : "bg-white text-[#024025] hover:bg-white/90")
              }
            >
              {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
              {mode === "training" ? "Enter Training Mode" : "Login"}
            </Button>
          </form>
        </div>

        <p className="pt-4 text-center text-[11px] text-white/40 sm:text-xs">
          © 2026 Sesigo Data Portal. Powered by BONASO.
        </p>
      </section>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
