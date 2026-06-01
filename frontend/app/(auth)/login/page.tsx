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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    try {
      await authService.login({ username: identifier.trim(), password })
      if (mode === "training") {
        setTrainingMode()
      } else {
        clearTrainingMode()
      }
      toast({
        title: "Welcome!",
        description:
          mode === "training"
            ? "Signed in to Sesigo Training Mode."
            : "Signed in to Sesigo Live System.",
      })
      router.push(mode === "training" ? "/training/dashboard" : "/dashboard")
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
    <main className="flex min-h-screen items-center justify-center bg-[#005a2f] p-6">
      <section className="w-full max-w-[620px] border-4 border-[#4bb978] bg-[#004a27] px-10 py-12 text-white shadow-2xl">
        <div className="mx-auto mb-6 flex w-full max-w-[320px] flex-col items-center">
          <p className="text-4xl font-bold tracking-wide">Sesigo</p>
          <p className="mt-1 text-sm font-medium text-white/70">Data Portal</p>
          <div
            className="mt-3 h-0 w-0 border-l-[68px] border-r-[68px] border-t-[120px] border-l-transparent border-r-transparent border-t-white/95"
            aria-hidden="true"
          />
          <h1 className="mt-8 text-4xl font-bold">
            {mode === "training" ? "Training Login" : "Welcome!"}
          </h1>
          <p className="mt-1 text-xs text-white/60">Powered by BONASO</p>
        </div>

        {/* Mode selector */}
        <div className="mx-auto mb-6 w-full max-w-[320px]">
          <div className="flex overflow-hidden rounded-none border border-white/30">
            <button
              type="button"
              onClick={() => setMode("live")}
              className={
                "flex-1 py-2 text-sm font-semibold transition-colors " +
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
                "flex-1 py-2 text-sm font-semibold transition-colors " +
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

        <form onSubmit={handleSubmit} className="mx-auto w-full max-w-[320px] space-y-5">
          {error ? (
            <div className="rounded bg-red-100/95 px-3 py-2 text-sm font-medium text-red-900">
              {error}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="username" className="block text-center text-3xl font-semibold text-white">
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
              className="h-12 rounded-none border-0 bg-[#d7dde7] text-lg text-black placeholder:text-slate-600"
            />
            <p className="text-center text-sm text-white/80">
              Sign in with either your username or email address.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="block text-center text-3xl font-semibold text-white">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-12 rounded-none border-0 bg-[#d7dde7] text-lg text-black placeholder:text-slate-600"
            />
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className={
              "mt-2 h-12 w-full rounded-none text-2xl font-semibold hover:opacity-90 " +
              (mode === "training"
                ? "bg-amber-400 text-[#004a27] hover:bg-amber-300"
                : "bg-white text-[#024025] hover:bg-white/90")
            }
          >
            {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
            {mode === "training" ? "Enter Training Mode" : "Login"}
          </Button>
        </form>

        <p className="mt-8 text-center text-xs text-white/40">
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
