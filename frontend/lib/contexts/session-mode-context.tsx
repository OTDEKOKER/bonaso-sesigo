"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useProjects } from "@/lib/hooks/use-api"
import { isTrainingMode as readTrainingMode } from "@/lib/training-mode"
import type { Project } from "@/lib/types"

interface SessionModeContextValue {
  isTrainingMode: boolean
  trainingProject: Project | null
  trainingProjectId: string | null
}

const SessionModeContext = createContext<SessionModeContextValue>({
  isTrainingMode: false,
  trainingProject: null,
  trainingProjectId: null,
})

export function SessionModeProvider({
  children,
  forceTraining = false,
}: {
  children: ReactNode
  forceTraining?: boolean
}) {
  const [sessionTrainingMode, setSessionTrainingMode] = useState(false)
  const { data: projectsData } = useProjects()

  useEffect(() => {
    if (typeof window !== "undefined") {
      setSessionTrainingMode(readTrainingMode())
    }
  }, [])

  const isTrainingMode = forceTraining || sessionTrainingMode

  const projects: Project[] =
    (projectsData as { results?: Project[] })?.results ?? []

  const trainingProject = projects.find((p) => p.is_training) ?? null
  const trainingProjectId = trainingProject ? String(trainingProject.id) : null

  return (
    <SessionModeContext.Provider value={{ isTrainingMode, trainingProject, trainingProjectId }}>
      {children}
    </SessionModeContext.Provider>
  )
}

export function useSessionMode() {
  return useContext(SessionModeContext)
}
