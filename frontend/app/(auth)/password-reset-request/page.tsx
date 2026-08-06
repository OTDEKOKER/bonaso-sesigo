"use client"

import React, { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authService } from "@/lib/api"

/**
 * Public "request a password reset" page. Because outbound email is not
 * configured, resets are admin-approved: the user submits their username/email
 * and an optional note; an administrator reviews the request and sets a new
 * password. The server never reveals whether the account exists, so this page
 * always shows the same generic confirmation.
 */
export default function PasswordResetRequestPage() {
  const [identifier, setIdentifier] = useState("")
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSubmitting(true)
    try {
      const res = await authService.requestPasswordReset({ identifier: identifier.trim(), note: note.trim() })
      setDone(res.detail)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit your request. Please try again.")
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#0b2318] p-3 sm:p-4">
      <section className="w-full max-w-[460px] rounded-2xl border border-white/10 bg-[#0e1f16] px-6 py-8 text-white shadow-2xl shadow-black/40">
        <div className="flex flex-col items-center text-center">
          <Image
            src="/bonaso-logo.png"
            alt="BONASO"
            width={284}
            height={372}
            priority
            className="h-12 w-auto"
          />
          <h1 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">Request a password reset</h1>
          <p className="mt-1.5 text-xs uppercase tracking-wide text-white/40">Sesigo Data Portal</p>
        </div>

        {done ? (
          <div className="mt-6 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            <p className="text-sm leading-6 text-white/80">{done}</p>
            <Link
              href="/login"
              className="mt-2 text-sm font-semibold text-emerald-300 underline-offset-2 hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <p className="text-sm leading-6 text-white/60">
              Enter the username or email you sign in with. An administrator will review your request
              and reset your password.
            </p>

            {error ? (
              <div className="rounded-lg bg-red-100/95 px-3 py-2 text-sm font-medium text-red-900" role="alert">
                {error}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="identifier" className="block text-xs font-semibold uppercase tracking-wide text-white/60">
                Username or Email
              </Label>
              <Input
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                placeholder="Enter your username or email"
                className="h-11 rounded-lg border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/40 focus-visible:ring-emerald-400/50"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="note" className="block text-xs font-semibold uppercase tracking-wide text-white/60">
                Note <span className="normal-case text-white/40">(optional)</span>
              </Label>
              <textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Anything that helps the administrator verify it's you"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
              />
            </div>

            <Button
              type="submit"
              disabled={submitting}
              className="h-11 w-full rounded-lg bg-emerald-400 text-base font-semibold tracking-tight text-[#04140d] hover:bg-emerald-300"
            >
              {submitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
              Submit request
            </Button>

            <Link
              href="/login"
              className="block text-center text-xs font-medium text-white/50 underline-offset-2 hover:text-white hover:underline"
            >
              Back to sign in
            </Link>
          </form>
        )}
      </section>
    </main>
  )
}
