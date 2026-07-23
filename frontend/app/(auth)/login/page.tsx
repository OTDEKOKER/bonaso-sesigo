"use client"

import React, { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { GraduationCap, Loader2, ShieldCheck } from "lucide-react"
import Image from "next/image"
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

  const queryMode = searchParams.get("mode")
  const initialMode: Mode | null =
    queryMode === "training" ? "training" : queryMode === "live" ? "live" : null
  const [mode, setMode] = useState<Mode | null>(initialMode)

  useEffect(() => {
    if (authService.isAuthenticated()) {
      const isTraining = mode === "training" || (mode === null && isTrainingMode())
      router.push(isTraining ? "/training/dashboard" : "/dashboard")
    }
  }, [router, mode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mode) return
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
    <main className="flex h-[100dvh] items-stretch justify-center overflow-hidden bg-[#0b2318] p-1.5 sm:p-3 md:p-4">
      <section className="flex w-full max-w-[760px] flex-col overflow-y-auto rounded-2xl border border-white/10 bg-[#0e1f16] px-4 py-5 text-white shadow-2xl shadow-black/40 sm:px-6 sm:py-6 md:px-8 md:py-8">
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="mx-auto flex w-full max-w-[420px] flex-col items-center text-center">
            <p className="text-4xl font-extrabold leading-none tracking-tight sm:text-5xl">Sesigo</p>
            <p className="mt-2 text-xs font-medium uppercase tracking-[0.25em] text-white/45 sm:text-sm">
              Data Portal
            </p>
            <Image
              src="/BonLog.png"
              alt="Sesigo logo"
              width={80}
              height={80}
              className="mt-4 h-16 w-16 sm:h-20 sm:w-20"
              priority
            />
            <h1 className="mt-5 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              {mode === "training" ? "Training Login" : "Welcome!"}
            </h1>
            <p className="mt-2 text-xs uppercase tracking-wide text-white/40">Powered by BONASO</p>
          </div>

          {mode === null ? (
            // ---- STEP 1: no mode chosen yet — show the two selection cards ----
            <div className="mx-auto mt-8 w-full max-w-[560px] rounded-2xl border border-emerald-700/30 bg-emerald-900/40 p-5 sm:p-6">
              <p className="mb-5 text-center text-xs font-semibold uppercase tracking-[0.15em] text-white/50">
                Select how you&apos;d like to continue
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setMode("live")}
                  className="group relative flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-6 py-8 text-center transition-all duration-200 hover:-translate-y-1 hover:border-emerald-400/50 hover:bg-emerald-400/10 hover:shadow-[0_0_30px_-14px_rgba(52,211,153,0.5)]"
                >
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10 transition-colors group-hover:bg-emerald-400/10 group-hover:ring-emerald-400/30">
                    <ShieldCheck className="h-8 w-8 text-white transition-colors group-hover:text-emerald-300" />
                  </span>
                  <div>
                    <p className="text-base font-semibold tracking-tight text-white">Sesigo Live System</p>
                    <p className="mt-1 text-xs text-white/55">Official production data</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setMode("training")}
                  className="group relative flex flex-col items-center gap-4 rounded-2xl border border-amber-400/25 bg-amber-400/5 px-6 py-8 text-center transition-all duration-200 hover:-translate-y-1 hover:border-amber-400/50 hover:bg-amber-400/10 hover:shadow-[0_0_30px_-14px_rgba(251,191,36,0.5)]"
                >
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-400/10 ring-1 ring-amber-300/30 transition-colors group-hover:bg-amber-400/20">
                    <GraduationCap className="h-8 w-8 text-amber-300" />
                  </span>
                  <div>
                    <p className="text-base font-semibold tracking-tight text-white">Sesigo Training Mode</p>
                    <p className="mt-1 text-xs text-white/55">Demo data, safe to explore</p>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            // ---- STEP 2: mode chosen — show which mode, a way to change it, then the form ----
            <>
              <div className="mx-auto mt-6 w-full max-w-[420px]">
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2.5">
                  <span className="text-sm font-semibold tracking-tight">
                    {mode === "training" ? "Sesigo Training Mode" : "Sesigo Live System"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMode(null)}
                    className="text-xs font-medium uppercase tracking-wide text-white/50 underline-offset-2 hover:text-white hover:underline"
                  >
                    Change
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
                  <div className="rounded-lg bg-red-100/95 px-3 py-2 text-sm font-medium text-red-900">
                    {error}
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label
                    htmlFor="username"
                    className="block text-xs font-semibold uppercase tracking-wide text-white/60"
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
                    className="h-11 rounded-lg border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/40 focus-visible:ring-emerald-400/50 sm:h-12 sm:text-base"
                  />
                  <p className="text-xs leading-snug text-white/45">
                    Sign in with either your username or email address.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="password"
                    className="block text-xs font-semibold uppercase tracking-wide text-white/60"
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
                    className="h-11 rounded-lg border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/40 focus-visible:ring-emerald-400/50 sm:h-12 sm:text-base"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  className={
                    "mt-1 h-11 w-full rounded-lg text-base font-semibold tracking-tight hover:opacity-90 sm:h-12 sm:text-lg " +
                    (mode === "training"
                      ? "bg-amber-400 text-[#1a1305] hover:bg-amber-300"
                      : "bg-emerald-400 text-[#04140d] hover:bg-emerald-300")
                  }
                >
                  {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                  {mode === "training" ? "Enter Training Mode" : "Login"}
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="pt-4 text-center text-[11px] text-white/40">
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