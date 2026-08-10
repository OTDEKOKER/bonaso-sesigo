"use client"

import React, { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authService } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import { setTrainingMode } from "@/lib/training-mode"

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

export default function TrainingLoginPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (authService.isAuthenticated()) {
      setTrainingMode()
      router.push("/training/dashboard")
    }
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    try {
      // Pass mode EXPLICITLY: the token must be training-stamped even on a
      // fresh login where the storage flag isn't set yet (set below only drives
      // the route guard). Fixes live-data-in-training incident 2026-08-10.
      await authService.login({ username: identifier.trim(), password, mode: 'training' })
      setTrainingMode()
      toast({
        title: "Signed in to Sesigo Training Mode",
        description: "Demo data only. Not for official reporting.",
      })
      router.push("/training/dashboard")
    } catch (err: unknown) {
      const errorMessage = getLoginErrorMessage(err)
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
      <section className="flex w-full max-w-[760px] flex-col overflow-y-auto border-[3px] border-amber-400 bg-[#004a27] px-4 py-5 text-white shadow-2xl sm:px-6 sm:py-6 md:px-8 md:py-8">
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="mx-auto flex w-full max-w-[420px] flex-col items-center text-center">
            <p className="text-[clamp(2.75rem,4vw,4rem)] font-bold tracking-wide leading-none">Sesigo</p>
            <p className="mt-2 text-[clamp(0.95rem,1.5vw,1.35rem)] font-medium text-white/70">Data Portal</p>
            <div
              className="mt-3 h-0 w-0 border-l-[clamp(44px,4vw,68px)] border-r-[clamp(44px,4vw,68px)] border-t-[clamp(78px,11vh,120px)] border-l-transparent border-r-transparent border-t-amber-400/90"
              aria-hidden="true"
            />
            <h1 className="mt-5 text-[clamp(2.5rem,4.4vw,4rem)] font-bold leading-none text-amber-400">
              Training Login
            </h1>
            <p className="mt-2 text-xs text-white/60 sm:text-sm">Powered by BONASO</p>
          </div>

          <div className="mx-auto mt-5 w-full max-w-[420px] rounded border border-amber-400 bg-amber-900/30 px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
              <p className="text-xs leading-snug text-amber-200">
                <span className="font-semibold">Sesigo Training Mode.</span>{" "}
                Demo data only. Not for official reporting. Training data may be automatically
                cleared after 7 days.
              </p>
            </div>
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
              className="mt-1 h-11 w-full rounded-none bg-amber-400 text-xl font-semibold text-[#004a27] hover:bg-amber-300 sm:h-12 sm:text-2xl"
            >
              {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
              Enter Training Mode
            </Button>
          </form>

          <div className="mx-auto mt-5 w-full max-w-[420px] text-center">
            <a
              href="/login"
              className="text-sm text-white/60 underline hover:text-white/90"
            >
              Sign in to Sesigo Live System instead
            </a>
          </div>
        </div>

        <p className="pt-4 text-center text-[11px] text-white/40 sm:text-xs">
          © 2026 Sesigo Data Portal. Powered by BONASO.
        </p>
      </section>
    </main>
  )
}
