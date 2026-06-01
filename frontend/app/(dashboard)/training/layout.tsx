"use client"

import { SessionModeProvider } from "@/lib/contexts/session-mode-context"

export default function TrainingLayout({ children }: { children: React.ReactNode }) {
  return <SessionModeProvider forceTraining>{children}</SessionModeProvider>
}
